import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Transaction,
  type WriteBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { AppUser } from './auth';
import { fbDb, fbStorage } from './firebase';
import { clampProgress, extractMentions, LIMITS, nextDueDate, progressForStatus, trimTo } from './logic';
import {
  STATUS_LABEL,
  type Activity,
  type ActivityType,
  type Attachment,
  type ChecklistItem,
  type Comment,
  type Group,
  type Priority,
  type Recurrence,
  type Task,
  type TaskStatus,
} from './types';

const tasksCol = () => collection(fbDb(), 'tasks');
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function toTask(id: string, data: Record<string, unknown>): Task {
  const d = data as Partial<Task>;
  return {
    id,
    groupId: d.groupId ?? '',
    groupName: d.groupName ?? '',
    title: d.title ?? '',
    description: d.description ?? '',
    assigneeIds: d.assigneeIds ?? [],
    createdBy: d.createdBy ?? '',
    createdByName: d.createdByName ?? '',
    status: d.status ?? 'todo',
    blockedReason: d.blockedReason ?? '',
    requiresApproval: d.requiresApproval ?? false,
    priority: d.priority ?? 'medium',
    progress: d.progress ?? 0,
    dueAt: d.dueAt ?? null,
    recurrence: d.recurrence ?? 'none',
    checklist: d.checklist ?? [],
    attachments: d.attachments ?? [],
    nextTaskId: d.nextTaskId ?? null,
    recurredFrom: d.recurredFrom ?? null,
    overdueNotified: d.overdueNotified ?? false,
    updatedBy: d.updatedBy ?? '',
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
    completedAt: d.completedAt ?? null,
  };
}

// ---------- Subscriptions ----------

type Unsub = () => void;
type OnErr = (e: Error) => void;

export function subscribeGroupTasks(groupId: string, onData: (t: Task[]) => void, onError: OnErr): Unsub {
  return onSnapshot(
    query(tasksCol(), where('groupId', '==', groupId)),
    (s) => onData(s.docs.map((d) => toTask(d.id, d.data()))),
    onError,
  );
}

export function subscribeAssignedTasks(uid: string, onData: (t: Task[]) => void, onError: OnErr): Unsub {
  return onSnapshot(
    query(tasksCol(), where('assigneeIds', 'array-contains', uid)),
    (s) => onData(s.docs.map((d) => toTask(d.id, d.data()))),
    onError,
  );
}

export function subscribeCreatedTasks(uid: string, onData: (t: Task[]) => void, onError: OnErr): Unsub {
  return onSnapshot(
    query(tasksCol(), where('createdBy', '==', uid)),
    (s) => onData(s.docs.map((d) => toTask(d.id, d.data()))),
    onError,
  );
}

export function subscribeTask(id: string, onData: (t: Task | null) => void, onError: OnErr): Unsub {
  return onSnapshot(doc(tasksCol(), id), (s) => onData(s.exists() ? toTask(s.id, s.data()) : null), onError);
}

export function subscribeComments(taskId: string, onData: (c: Comment[]) => void, onError: OnErr): Unsub {
  return onSnapshot(
    query(collection(fbDb(), 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'), limit(200)),
    (s) => onData(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) }))),
    onError,
  );
}

export function subscribeActivity(taskId: string, onData: (a: Activity[]) => void, onError: OnErr): Unsub {
  return onSnapshot(
    query(collection(fbDb(), 'tasks', taskId, 'activity'), orderBy('createdAt', 'desc'), limit(50)),
    (s) => onData(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Activity, 'id'>) }))),
    onError,
  );
}

// ---------- Helpers ----------

function activityRef(taskId: string): DocumentReference {
  return doc(collection(fbDb(), 'tasks', taskId, 'activity'));
}

function logActivity(
  w: Pick<WriteBatch, 'set'> | Pick<Transaction, 'set'>,
  taskId: string,
  user: AppUser,
  type: ActivityType,
  message: string,
) {
  (w as Pick<WriteBatch, 'set'>).set(activityRef(taskId), {
    actorId: user.uid,
    actorName: user.displayName,
    type,
    message,
    createdAt: serverTimestamp(),
  });
}

function namesOf(group: Group, uids: string[]): string {
  return uids.map((u) => group.members[u]?.name ?? 'someone').join(', ');
}

// ---------- Create / edit ----------

export interface TaskInput {
  title: string;
  description: string;
  assigneeIds: string[];
  priority: Priority;
  dueAt: Date | null;
  recurrence: Recurrence;
  requiresApproval: boolean;
  checklist: string[]; // only used on create
}

function validate(input: TaskInput, group: Group): { title: string; description: string; assigneeIds: string[] } {
  const title = trimTo(input.title, LIMITS.taskTitle);
  if (!title) throw new Error('Title is required.');
  const assigneeIds = [...new Set(input.assigneeIds)].filter((u) => group.memberIds.includes(u));
  if (input.recurrence !== 'none' && !input.dueAt) throw new Error('Recurring tasks need a due date.');
  return { title, description: trimTo(input.description, LIMITS.taskDescription), assigneeIds };
}

export async function createTask(user: AppUser, group: Group, input: TaskInput): Promise<string> {
  const { title, description, assigneeIds } = validate(input, group);
  const checklist: ChecklistItem[] = input.checklist
    .map((t) => trimTo(t, LIMITS.checklistItem))
    .filter(Boolean)
    .slice(0, LIMITS.checklistItems)
    .map((text) => ({ id: newId(), text, done: false, doneBy: null, doneByName: null, doneAt: null }));

  const ref = doc(tasksCol());
  const batch = writeBatch(fbDb());
  batch.set(ref, {
    groupId: group.id,
    groupName: group.name,
    title,
    description,
    assigneeIds,
    createdBy: user.uid,
    createdByName: user.displayName,
    status: 'todo',
    blockedReason: '',
    requiresApproval: input.requiresApproval,
    priority: input.priority,
    progress: 0,
    dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : null,
    recurrence: input.recurrence,
    checklist,
    attachments: [],
    nextTaskId: null,
    recurredFrom: null,
    overdueNotified: false,
    updatedBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
  logActivity(
    batch,
    ref.id,
    user,
    'created',
    assigneeIds.length ? `created the task and assigned ${namesOf(group, assigneeIds)}` : 'created the task',
  );
  await batch.commit();
  return ref.id;
}

export async function updateTaskDetails(user: AppUser, group: Group, task: Task, input: TaskInput) {
  const { title, description, assigneeIds } = validate(input, group);
  const newDue = input.dueAt ? Timestamp.fromDate(input.dueAt) : null;
  const dueChanged = (newDue?.toMillis() ?? null) !== (task.dueAt?.toMillis() ?? null);
  const batch = writeBatch(fbDb());
  batch.update(doc(tasksCol(), task.id), {
    title,
    description,
    assigneeIds,
    priority: input.priority,
    dueAt: newDue,
    recurrence: input.recurrence,
    requiresApproval: input.requiresApproval,
    ...(dueChanged ? { overdueNotified: false } : {}),
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
  const added = assigneeIds.filter((u) => !task.assigneeIds.includes(u));
  const removed = task.assigneeIds.filter((u) => !assigneeIds.includes(u));
  if (added.length || removed.length) {
    const parts = [
      added.length ? `assigned ${namesOf(group, added)}` : '',
      removed.length ? `unassigned ${namesOf(group, removed)}` : '',
    ].filter(Boolean);
    logActivity(batch, task.id, user, 'assigned', parts.join('; '));
  }
  logActivity(batch, task.id, user, 'edited', dueChanged ? 'edited the task (due date changed)' : 'edited the task');
  await batch.commit();
}

export async function deleteTask(taskId: string) {
  const batch = writeBatch(fbDb());
  batch.delete(doc(tasksCol(), taskId));
  await batch.commit();
}

// ---------- Work: status / progress ----------

/**
 * Changes status. When a recurring task is completed, the next occurrence is created
 * in the same transaction; `nextTaskId` makes this idempotent (completing twice
 * never creates two copies).
 */
export async function setStatus(user: AppUser, taskId: string, status: TaskStatus, blockedReason = '') {
  await runTransaction(fbDb(), async (tx) => {
    const ref = doc(tasksCol(), taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Task no longer exists.');
    const task = toTask(snap.id, snap.data());
    if (task.status === status && status !== 'blocked') return;

    const patch: Record<string, unknown> = {
      status,
      progress: progressForStatus(status, task.progress),
      blockedReason: status === 'blocked' ? trimTo(blockedReason, LIMITS.blockedReason) : '',
      completedAt: status === 'done' ? serverTimestamp() : null,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    };

    let spawned = false;
    if (status === 'done' && task.recurrence !== 'none' && !task.nextTaskId) {
      const base = task.dueAt?.toDate() ?? new Date();
      const nextDue = nextDueDate(base, task.recurrence);
      // Drop assignees who have since left the group (rules require assignees to be members).
      const groupSnap = await tx.get(doc(fbDb(), 'groups', task.groupId));
      const memberIds: string[] = groupSnap.exists() ? (groupSnap.data().memberIds as string[]) : [];
      if (nextDue && groupSnap.exists()) {
        const nextRef = doc(tasksCol());
        tx.set(nextRef, {
          groupId: task.groupId,
          groupName: task.groupName,
          title: task.title,
          description: task.description,
          assigneeIds: task.assigneeIds.filter((u) => memberIds.includes(u)),
          // The original assigner stays the owner of every occurrence (rules verify via recurredFrom).
          createdBy: task.createdBy,
          createdByName: task.createdByName,
          recurredFrom: task.id,
          status: 'todo',
          blockedReason: '',
          requiresApproval: task.requiresApproval,
          priority: task.priority,
          progress: 0,
          dueAt: Timestamp.fromDate(nextDue),
          recurrence: task.recurrence,
          checklist: task.checklist.map((c) => ({ ...c, id: newId(), done: false, doneBy: null, doneByName: null, doneAt: null })),
          attachments: [],
          nextTaskId: null,
          overdueNotified: false,
          updatedBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: null,
        });
        logActivity(tx, nextRef.id, user, 'recurred', 'created this occurrence of a repeating task');
        patch.nextTaskId = nextRef.id;
        spawned = true;
      }
    }

    tx.update(ref, patch);
    const reason = status === 'blocked' && patch.blockedReason ? ` — ${patch.blockedReason}` : '';
    logActivity(
      tx,
      taskId,
      user,
      'status',
      `changed status to ${STATUS_LABEL[status]}${reason}${spawned ? ' (next occurrence created)' : ''}`,
    );
  });
}

/** Pick up an unassigned task. */
export async function claimTask(user: AppUser, taskId: string) {
  await runTransaction(fbDb(), async (tx) => {
    const ref = doc(tasksCol(), taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Task no longer exists.');
    if ((snap.data().assigneeIds as string[]).length > 0) throw new Error('Someone already picked this up.');
    tx.update(ref, { assigneeIds: [user.uid], updatedBy: user.uid, updatedAt: serverTimestamp() });
    logActivity(tx, taskId, user, 'assigned', 'picked up this task');
  });
}

export async function setProgress(user: AppUser, taskId: string, value: number) {
  const progress = clampProgress(value);
  const batch = writeBatch(fbDb());
  batch.update(doc(tasksCol(), taskId), { progress, updatedBy: user.uid, updatedAt: serverTimestamp() });
  logActivity(batch, taskId, user, 'progress', `updated progress to ${progress}%`);
  await batch.commit();
}

// ---------- "What's needed" checklist ----------

async function mutateChecklist(
  user: AppUser,
  taskId: string,
  mutate: (items: ChecklistItem[]) => { items: ChecklistItem[]; message: string } | null,
) {
  await runTransaction(fbDb(), async (tx) => {
    const ref = doc(tasksCol(), taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Task no longer exists.');
    const result = mutate(toTask(snap.id, snap.data()).checklist);
    if (!result) return;
    tx.update(ref, { checklist: result.items, updatedBy: user.uid, updatedAt: serverTimestamp() });
    logActivity(tx, taskId, user, 'checklist', result.message);
  });
}

export function toggleChecklistItem(user: AppUser, taskId: string, itemId: string) {
  return mutateChecklist(user, taskId, (items) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    const done = !item.done;
    return {
      items: items.map((i) =>
        i.id === itemId
          ? { ...i, done, doneBy: done ? user.uid : null, doneByName: done ? user.displayName : null, doneAt: done ? Date.now() : null }
          : i,
      ),
      message: `${done ? 'furnished' : 'reopened'} “${item.text}”`,
    };
  });
}

export function addChecklistItem(user: AppUser, taskId: string, text: string) {
  const clean = trimTo(text, LIMITS.checklistItem);
  if (!clean) return Promise.resolve();
  return mutateChecklist(user, taskId, (items) => {
    if (items.length >= LIMITS.checklistItems) throw new Error(`Max ${LIMITS.checklistItems} items.`);
    return {
      items: [...items, { id: newId(), text: clean, done: false, doneBy: null, doneByName: null, doneAt: null }],
      message: `added needed item “${clean}”`,
    };
  });
}

export function removeChecklistItem(user: AppUser, taskId: string, itemId: string) {
  return mutateChecklist(user, taskId, (items) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    return { items: items.filter((i) => i.id !== itemId), message: `removed needed item “${item.text}”` };
  });
}

// ---------- Comments ----------

export async function addComment(user: AppUser, group: Group, taskId: string, text: string) {
  const clean = trimTo(text, LIMITS.comment);
  if (!clean) return;
  await addDoc(collection(fbDb(), 'tasks', taskId, 'comments'), {
    authorId: user.uid,
    authorName: user.displayName,
    text: clean,
    mentions: extractMentions(clean, group.members).filter((u) => u !== user.uid),
    createdAt: serverTimestamp(),
  });
}

// ---------- Attachments (proof of work) ----------

async function uriToBlob(uri: string): Promise<Blob> {
  // XHR is the most reliable way to get a Blob from a local file URI in React Native.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('Could not read the selected file.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

export async function uploadAttachment(
  user: AppUser,
  task: Task,
  file: { uri: string; name: string; mimeType: string; size?: number },
) {
  if (task.attachments.length >= LIMITS.attachments) throw new Error(`Max ${LIMITS.attachments} attachments per task.`);
  if (file.size && file.size > LIMITS.attachmentBytes) throw new Error('File is larger than 10 MB.');
  const id = newId();
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
  const path = `tasks/${task.id}/${id}-${safeName}`;
  const blob = await uriToBlob(file.uri);
  if (blob.size > LIMITS.attachmentBytes) throw new Error('File is larger than 10 MB.');
  const objRef = storageRef(fbStorage(), path);
  await uploadBytes(objRef, blob, { contentType: file.mimeType });
  const url = await getDownloadURL(objRef);
  const attachment: Attachment = {
    id,
    name: safeName,
    url,
    path,
    contentType: file.mimeType,
    uploadedBy: user.uid,
    uploadedByName: user.displayName,
    uploadedAt: Date.now(),
  };
  try {
    await runTransaction(fbDb(), async (tx) => {
      const ref = doc(tasksCol(), task.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Task no longer exists.');
      const current = toTask(snap.id, snap.data()).attachments;
      if (current.length >= LIMITS.attachments) throw new Error(`Max ${LIMITS.attachments} attachments per task.`);
      tx.update(ref, { attachments: [...current, attachment], updatedBy: user.uid, updatedAt: serverTimestamp() });
      logActivity(tx, task.id, user, 'attachment', `attached “${safeName}”`);
    });
  } catch (e) {
    await deleteObject(objRef).catch(() => {}); // don't leave an orphaned file
    throw e;
  }
}

export async function removeAttachment(user: AppUser, taskId: string, attachment: Attachment) {
  await runTransaction(fbDb(), async (tx) => {
    const ref = doc(tasksCol(), taskId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const current = toTask(snap.id, snap.data()).attachments;
    tx.update(ref, {
      attachments: current.filter((a) => a.id !== attachment.id),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    logActivity(tx, taskId, user, 'attachment', `removed “${attachment.name}”`);
  });
  await deleteObject(storageRef(fbStorage(), attachment.path)).catch(() => {});
}

export function dueMs(t: Pick<Task, 'dueAt'>): number | null {
  return t.dueAt ? t.dueAt.toMillis() : null;
}

export function createdMs(t: Pick<Task, 'createdAt'>): number {
  return t.createdAt ? t.createdAt.toMillis() : Date.now();
}
