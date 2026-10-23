/**
 * Crew Tasks Cloud Functions (2nd gen). Requires the Firebase Blaze plan.
 *
 *  - Push notifications (FCM) for: new task, (re)assignment, status change, comments/@mentions, overdue.
 *  - Clean-up: comments/activity/files when a task is deleted.
 *  - Consistency: group rename → tasks.groupName; removed members → unassigned from open tasks.
 *
 * All functions are idempotent or safe to retry: notifications are best-effort, and the overdue
 * scan flips `overdueNotified` in a transaction so a task is announced at most once per due date.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { logger, setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/firestore';
import { onSchedule } from 'firebase-functions/scheduler';
import { onCommentNotes, onCreatedNotes, onUpdatedNotes, overdueNote, type Note, type TaskLike } from './notifyLogic';

initializeApp();
const db = getFirestore();

// Must match your Firestore location (README recommends asia-south1 / Mumbai). Override in functions/.env.
const REGION = process.env.FUNCTIONS_REGION || 'asia-south1';
setGlobalOptions({ region: REGION, maxInstances: 5 });

// ---------- push helpers ----------

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

async function tokensFor(uids: string[]): Promise<{ token: string; ref: DocumentReference }[]> {
  const out: { token: string; ref: DocumentReference }[] = [];
  await Promise.all(
    [...new Set(uids)].map(async (uid) => {
      const snap = await db.collection('users').doc(uid).collection('devices').get();
      snap.forEach((d) => {
        const token = d.get('token');
        if (typeof token === 'string' && token) out.push({ token, ref: d.ref });
      });
    }),
  );
  return out;
}

async function send(note: Note, taskId: string): Promise<void> {
  if (!note.uids.length) return;
  const devices = await tokensFor(note.uids);
  if (!devices.length) return;
  for (let i = 0; i < devices.length; i += 500) {
    const chunk = devices.slice(i, i + 500);
    const res = await getMessaging().sendEachForMulticast({
      tokens: chunk.map((d) => d.token),
      notification: { title: note.title.slice(0, 120), body: note.body.slice(0, 240) },
      data: { url: `/task/${taskId}`, taskId },
      android: { priority: 'high', notification: { channelId: 'default', tag: taskId } },
    });
    // Prune tokens FCM says are dead so we stop sending to uninstalled apps.
    await Promise.all(
      res.responses.map((r, idx) => {
        const code = r.error?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) return chunk[idx]!.ref.delete().catch(() => undefined);
        if (r.error) logger.warn('FCM send failed', { code, taskId });
        return undefined;
      }),
    );
  }
}

async function sendAll(notes: Note[], taskId: string) {
  await Promise.all(notes.map((n) => send(n, taskId).catch((e) => logger.error('notify failed', { taskId, e: String(e) }))));
}

async function memberName(groupId: string, uid: string | undefined): Promise<string> {
  if (!uid) return 'Someone';
  const g = await db.collection('groups').doc(groupId).get();
  return (g.get(`members.${uid}.name`) as string | undefined) ?? 'Someone';
}

// ---------- task events ----------

export const onTaskCreated = onDocumentCreated('tasks/{taskId}', async (event) => {
  const task = event.data?.data() as (TaskLike & { groupId: string; createdByName: string; recurredFrom?: string | null }) | undefined;
  if (!task) return;
  // Recurring copies are created when the previous one is completed; don't announce them as "new".
  if (task.recurredFrom) return;
  await sendAll(onCreatedNotes(task, task.createdByName || 'Someone'), event.params.taskId);
});

export const onTaskUpdated = onDocumentUpdated('tasks/{taskId}', async (event) => {
  const before = event.data?.before.data() as (TaskLike & { groupId: string }) | undefined;
  const after = event.data?.after.data() as (TaskLike & { groupId: string }) | undefined;
  if (!before || !after) return;
  const statusChanged = before.status !== after.status || before.blockedReason !== after.blockedReason;
  const assigneesChanged = after.assigneeIds.some((u) => !before.assigneeIds.includes(u));
  if (!statusChanged && !assigneesChanged) return; // e.g. checklist ticks, progress, our own overdue flag
  const actorName = await memberName(after.groupId, after.updatedBy);
  await sendAll(onUpdatedNotes(before, after, actorName), event.params.taskId);
});

export const onCommentCreated = onDocumentCreated('tasks/{taskId}/comments/{commentId}', async (event) => {
  const comment = event.data?.data() as { authorId: string; authorName: string; text: string; mentions?: string[] } | undefined;
  if (!comment) return;
  const taskSnap = await db.collection('tasks').doc(event.params.taskId).get();
  const task = taskSnap.data() as (TaskLike & { groupId: string }) | undefined;
  if (!task) return;
  const group = await db.collection('groups').doc(task.groupId).get();
  const memberIds = (group.get('memberIds') as string[] | undefined) ?? [];
  await sendAll(onCommentNotes(task, { ...comment, mentions: comment.mentions ?? [] }, memberIds), event.params.taskId);
});

export const onTaskDeleted = onDocumentDeleted('tasks/{taskId}', async (event) => {
  const taskId = event.params.taskId;
  const ref = db.collection('tasks').doc(taskId);
  await Promise.all([
    db.recursiveDelete(ref.collection('comments')),
    db.recursiveDelete(ref.collection('activity')),
    getStorage()
      .bucket()
      .deleteFiles({ prefix: `tasks/${taskId}/` })
      .catch((e) => logger.warn('attachment cleanup failed', { taskId, e: String(e) })),
  ]);
});

// ---------- group consistency ----------

export const onGroupUpdated = onDocumentUpdated('groups/{groupId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const groupId = event.params.groupId;
  const removed = (before.memberIds as string[]).filter((u) => !(after.memberIds as string[]).includes(u));
  if (before.name === after.name && removed.length === 0) return;

  const tasks = await db.collection('tasks').where('groupId', '==', groupId).get();
  const writer = db.bulkWriter();
  tasks.forEach((t) => {
    const patch: Record<string, unknown> = {};
    if (before.name !== after.name) patch.groupName = after.name;
    const assignees = (t.get('assigneeIds') as string[]) ?? [];
    if (removed.some((u) => assignees.includes(u)) && t.get('status') !== 'done') {
      patch.assigneeIds = assignees.filter((u) => !removed.includes(u));
    }
    if (Object.keys(patch).length) writer.update(t.ref, patch);
  });
  await writer.close();
});

export const onGroupDeleted = onDocumentDeleted('groups/{groupId}', async (event) => {
  // The app deletes tasks first; this catches anything left behind (e.g. deleted from the console).
  const tasks = await db.collection('tasks').where('groupId', '==', event.params.groupId).get();
  const writer = db.bulkWriter();
  tasks.forEach((t) => writer.delete(t.ref));
  await writer.close();
});

// ---------- overdue scan ----------

export const overdueScan = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const snap = await db
    .collection('tasks')
    .where('overdueNotified', '==', false)
    .where('dueAt', '<=', Timestamp.now())
    .limit(300)
    .get();

  for (const doc of snap.docs) {
    // Claim the notification in a transaction so overlapping runs can't double-send.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.get('overdueNotified') === true) return null;
      tx.update(doc.ref, { overdueNotified: true });
      return fresh.data() as TaskLike;
    });
    if (claimed && claimed.status !== 'done') {
      const note = overdueNote(claimed);
      if (note) await sendAll([note], doc.id);
    }
  }
  if (snap.size) logger.info('overdue scan', { checked: snap.size });
});

