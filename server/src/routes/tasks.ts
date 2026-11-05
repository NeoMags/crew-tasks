import { z } from 'zod';
import { deliver, insertNotifications, type App, type Deps, type SessionUser } from '../context.js';
import { tx, type Client, type Queryable } from '../db.js';
import { badRequest, body, conflict, forbidden, HttpError, notFound, parseUuid } from '../http.js';
import type { Outbox } from '../notify.js';
import { onCommentNotes, onCreatedNotes, onUpdatedNotes, type TaskLike } from '../notifyLogic.js';
import { loadActivity, loadComments, loadTask, tasksAssignedTo, tasksCreatedBy } from '../queries.js';
import {
  allowedStatuses,
  canEditDetails,
  canWorkOn,
  clampProgress,
  extractMentions,
  LIMITS,
  nextDueDate,
  progressForStatus,
} from '../shared/logic.js';
import { PRIORITIES, RECURRENCES, STATUS_LABEL, TASK_STATUSES, type ActivityType, type Role } from '../shared/types.js';

const MAX_ASSIGNEES = 20;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel functions accept ~4.5 MB request bodies
const UPLOAD_TYPES = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf)$/;

const taskInput = z
  .object({
    title: z.string().trim().min(1, 'Title is required.').max(LIMITS.taskTitle),
    description: z.string().trim().max(LIMITS.taskDescription).default(''),
    assigneeIds: z.array(z.string().min(1).max(100)).max(MAX_ASSIGNEES).default([]),
    priority: z.enum(PRIORITIES).default('medium'),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
    recurrence: z.enum(RECURRENCES).default('none'),
    requiresApproval: z.boolean().default(false),
  })
  .refine((t) => t.recurrence === 'none' || t.dueAt, { message: 'Recurring tasks need a due date.', path: ['dueAt'] });

const createInput = z.intersection(
  taskInput,
  z.object({
    groupId: z.string().uuid(),
    checklist: z.array(z.string().trim().max(LIMITS.checklistItem)).max(LIMITS.checklistItems).default([]),
  }),
);

interface LockedTask {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  created_by: string;
  status: (typeof TASK_STATUSES)[number];
  blocked_reason: string;
  requires_approval: boolean;
  progress: number;
  due_at: string | null;
  recurrence: (typeof RECURRENCES)[number];
  next_task_id: string | null;
  assignee_ids: string[];
  role: Role | null;
}

/** Loads (and row-locks) a task plus the caller's role in its group. 404 if not a member. */
async function lockTask(db: Client, taskId: string, userId: string): Promise<LockedTask> {
  const { rows } = await db.query<LockedTask>(
    `select t.id, t.group_id, g.name as group_name, t.title, t.created_by, t.status, t.blocked_reason,
            t.requires_approval, t.progress, t.due_at, t.recurrence, t.next_task_id, gm.role,
            coalesce((select array_agg(a.user_id) from task_assignees a where a.task_id = t.id), '{}') as assignee_ids
       from tasks t
       join groups g on g.id = t.group_id
       left join group_members gm on gm.group_id = t.group_id and gm.user_id = $2
      where t.id = $1
      for update of t`,
    [taskId, userId],
  );
  const t = rows[0];
  if (!t || !t.role) throw notFound('Task not found.');
  return t;
}

const perm = (t: LockedTask) => ({ createdBy: t.created_by, assigneeIds: t.assignee_ids, requiresApproval: t.requires_approval });
const groupOf = (t: LockedTask, uid: string) => ({ members: { [uid]: { name: '', role: t.role as Role } } });

function taskLike(t: LockedTask, patch: Partial<TaskLike> = {}): TaskLike {
  return {
    title: t.title,
    groupName: t.group_name,
    assigneeIds: t.assignee_ids,
    createdBy: t.created_by,
    status: t.status,
    blockedReason: t.blocked_reason,
    ...patch,
  };
}

async function logActivity(db: Queryable, taskId: string, actorId: string, type: ActivityType, message: string) {
  await db.query('insert into activity (task_id, actor_id, type, message) values ($1, $2, $3, left($4, 600))', [
    taskId,
    actorId,
    type,
    message,
  ]);
}

async function memberNames(db: Queryable, groupId: string): Promise<Record<string, { name: string }>> {
  const { rows } = await db.query<{ user_id: string; name: string }>(
    'select m.user_id, u.name from group_members m join "user" u on u.id = m.user_id where m.group_id = $1',
    [groupId],
  );
  return Object.fromEntries(rows.map((r) => [r.user_id, { name: r.name }]));
}

const namesOf = (members: Record<string, { name: string }>, uids: string[]) =>
  uids.map((u) => members[u]?.name ?? 'someone').join(', ');

async function setAssignees(db: Queryable, taskId: string, uids: string[]) {
  await db.query('delete from task_assignees where task_id = $1 and not (user_id = any($2::text[]))', [taskId, uids]);
  if (uids.length) {
    await db.query(
      'insert into task_assignees (task_id, user_id) select $1, unnest($2::text[]) on conflict do nothing',
      [taskId, uids],
    );
  }
}

export function registerTaskRoutes(app: App, deps: Deps) {
  const { pool } = deps;

  /** Commit, then push whatever the transaction queued. */
  async function mutate<T>(fn: (db: Client, out: Outbox) => Promise<T>, taskId: string | null = null): Promise<T> {
    const out: Outbox = { taskId, notes: [] };
    const result = await tx(pool, async (db) => {
      const r = await fn(db, out);
      await insertNotifications(db, out);
      return r;
    });
    deliver(deps, out);
    return result;
  }

  async function taskOr404(userId: string, taskId: string) {
    const t = await loadTask(pool, userId, taskId);
    if (!t) throw notFound('Task not found.');
    return t;
  }

  // ---------- lists ----------

  app.get('/api/tasks', async (c) => {
    const user = c.get('user');
    const scope = c.req.query('scope') ?? 'assigned';
    if (scope === 'assigned') return c.json(await tasksAssignedTo(pool, user.id));
    if (scope === 'created') return c.json(await tasksCreatedBy(pool, user.id));
    throw badRequest('scope must be "assigned" or "created".');
  });

  app.get('/api/tasks/:id', async (c) => c.json(await taskOr404(c.get('user').id, parseUuid(c.req.param('id'), 'task'))));

  // ---------- create / edit / delete ----------

  app.post('/api/tasks', async (c) => {
    const user = c.get('user');
    const input = await body(c, createInput);
    const taskId = await mutate(async (db, out) => {
      const members = await memberNames(db, input.groupId);
      if (!members[user.id]) throw notFound('Group not found.');
      const assignees = [...new Set(input.assigneeIds)];
      const outsiders = assignees.filter((u) => !members[u]);
      if (outsiders.length) throw badRequest('Tasks can only be assigned to group members.');

      const { rows } = await db.query<{ id: string; group_name: string }>(
        `insert into tasks (group_id, title, description, created_by, requires_approval, priority, due_at, recurrence, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $4)
         returning id, (select name from groups where id = $1) as group_name`,
        [input.groupId, input.title, input.description, user.id, input.requiresApproval, input.priority, input.dueAt, input.recurrence],
      );
      const id = rows[0]!.id;
      await setAssignees(db, id, assignees);
      const items = input.checklist.filter(Boolean);
      if (items.length) {
        await db.query(
          `insert into checklist_items (task_id, text, position)
           select $1, t.text, t.ord::int from unnest($2::text[]) with ordinality as t(text, ord)`,
          [id, items],
        );
      }
      await logActivity(
        db,
        id,
        user.id,
        'created',
        assignees.length ? `created the task and assigned ${namesOf(members, assignees)}` : 'created the task',
      );
      out.taskId = id;
      out.notes = onCreatedNotes(
        { title: input.title, groupName: rows[0]!.group_name, assigneeIds: assignees, createdBy: user.id, status: 'todo' },
        user.name,
      );
      return id;
    });
    return c.json(await taskOr404(user.id, taskId), 201);
  });

  app.patch('/api/tasks/:id', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const input = await body(c, taskInput);
    await mutate(async (db, out) => {
      const t = await lockTask(db, taskId, user.id);
      if (!canEditDetails(perm(t), groupOf(t, user.id), user.id)) {
        throw forbidden('Only the person who assigned this task or a group admin can edit it.');
      }
      const members = await memberNames(db, t.group_id);
      const assignees = [...new Set(input.assigneeIds)];
      if (assignees.some((u) => !members[u])) throw badRequest('Tasks can only be assigned to group members.');

      const dueChanged = (input.dueAt ? Date.parse(input.dueAt) : null) !== (t.due_at ? Date.parse(t.due_at) : null);
      await db.query(
        `update tasks set title = $2, description = $3, priority = $4, due_at = $5, recurrence = $6,
                requires_approval = $7, overdue_notified = case when $8 then false else overdue_notified end,
                updated_by = $9, updated_at = now()
          where id = $1`,
        [taskId, input.title, input.description, input.priority, input.dueAt, input.recurrence, input.requiresApproval, dueChanged, user.id],
      );
      await setAssignees(db, taskId, assignees);

      const added = assignees.filter((u) => !t.assignee_ids.includes(u));
      const removed = t.assignee_ids.filter((u) => !assignees.includes(u));
      if (added.length || removed.length) {
        const parts = [
          added.length ? `assigned ${namesOf(members, added)}` : '',
          removed.length ? `unassigned ${namesOf(members, removed)}` : '',
        ].filter(Boolean);
        await logActivity(db, taskId, user.id, 'assigned', parts.join('; '));
      }
      await logActivity(db, taskId, user.id, 'edited', dueChanged ? 'edited the task (due date changed)' : 'edited the task');
      out.notes = onUpdatedNotes(
        taskLike(t),
        taskLike(t, { title: input.title, assigneeIds: assignees, updatedBy: user.id }),
        user.name,
      );
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  app.delete('/api/tasks/:id', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const pathnames = await tx(pool, async (db) => {
      const t = await lockTask(db, taskId, user.id);
      if (!canEditDetails(perm(t), groupOf(t, user.id), user.id)) {
        throw forbidden('Only the person who assigned this task or a group admin can delete it.');
      }
      const files = await db.query<{ pathname: string }>('select pathname from attachments where task_id = $1', [taskId]);
      await db.query('delete from tasks where id = $1', [taskId]);
      return files.rows.map((r) => r.pathname);
    });
    if (deps.storage && pathnames.length) deps.background(deps.storage.delete(pathnames).catch(() => {}));
    return c.json({ ok: true });
  });

  // ---------- status / progress / claim ----------

  app.post('/api/tasks/:id/status', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const input = await body(
      c,
      z.object({ status: z.enum(TASK_STATUSES), blockedReason: z.string().trim().max(LIMITS.blockedReason).default('') }),
    );
    await mutate(async (db, out) => {
      const t = await lockTask(db, taskId, user.id);
      const allowed = allowedStatuses(perm(t), groupOf(t, user.id), user.id);
      if (!allowed.length) throw forbidden('Only assignees, the assigner or an admin can change the status.');
      if (!allowed.includes(input.status)) {
        throw forbidden('This task needs approval: move it to "In review" and the assigner will mark it done.');
      }
      const reason = input.status === 'blocked' ? input.blockedReason : '';
      if (t.status === input.status && t.blocked_reason === reason) return; // no-op (idempotent retries)

      await db.query(
        `update tasks set status = $2, progress = $3, blocked_reason = $4,
                completed_at = case when $2 = 'done' then now() else null end,
                updated_by = $5, updated_at = now()
          where id = $1`,
        [taskId, input.status, progressForStatus(input.status, t.progress), reason, user.id],
      );

      // Completing a repeating task creates the next occurrence exactly once (next_task_id guards retries).
      let spawned = false;
      if (input.status === 'done' && t.recurrence !== 'none' && !t.next_task_id) {
        const nextDue = nextDueDate(t.due_at ? new Date(t.due_at) : new Date(), t.recurrence);
        if (nextDue) {
          const { rows } = await db.query<{ id: string }>(
            `insert into tasks (group_id, title, description, created_by, requires_approval, priority, due_at,
                                recurrence, recurred_from, updated_by)
             select group_id, title, description, created_by, requires_approval, priority, $2, recurrence, id, $3
               from tasks where id = $1
             returning id`,
            [taskId, nextDue.toISOString(), user.id],
          );
          const nextId = rows[0]!.id;
          // Carry over assignees who are still in the group, and reset the checklist.
          await db.query(
            `insert into task_assignees (task_id, user_id)
             select $2, a.user_id from task_assignees a
               join group_members gm on gm.group_id = $3 and gm.user_id = a.user_id
              where a.task_id = $1`,
            [taskId, nextId, t.group_id],
          );
          await db.query(
            'insert into checklist_items (task_id, text, position) select $2, text, position from checklist_items where task_id = $1',
            [taskId, nextId],
          );
          await db.query('update tasks set next_task_id = $2 where id = $1', [taskId, nextId]);
          await logActivity(db, nextId, user.id, 'recurred', 'created this occurrence of a repeating task');
          spawned = true;
        }
      }
      await logActivity(
        db,
        taskId,
        user.id,
        'status',
        `changed status to ${STATUS_LABEL[input.status]}${reason ? ` — ${reason}` : ''}${spawned ? ' (next occurrence created)' : ''}`,
      );
      out.notes = onUpdatedNotes(
        taskLike(t, { updatedBy: user.id }),
        taskLike(t, { status: input.status, blockedReason: reason, updatedBy: user.id }),
        user.name,
      );
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  app.post('/api/tasks/:id/progress', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const { progress } = await body(c, z.object({ progress: z.number().int().min(0).max(100) }));
    await mutate(async (db) => {
      const t = await lockTask(db, taskId, user.id);
      if (!canWorkOn(perm(t), groupOf(t, user.id), user.id)) throw forbidden('Only assignees can update progress.');
      if (t.status === 'done') throw conflict('This task is already done.');
      const value = clampProgress(progress);
      await db.query('update tasks set progress = $2, updated_by = $3, updated_at = now() where id = $1', [taskId, value, user.id]);
      await logActivity(db, taskId, user.id, 'progress', `updated progress to ${value}%`);
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  app.post('/api/tasks/:id/claim', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    await mutate(async (db, out) => {
      const t = await lockTask(db, taskId, user.id);
      if (t.assignee_ids.length) throw conflict('Someone already picked this up.');
      await setAssignees(db, taskId, [user.id]);
      await db.query('update tasks set updated_by = $2, updated_at = now() where id = $1', [taskId, user.id]);
      await logActivity(db, taskId, user.id, 'assigned', 'picked up this task');
      out.notes = t.created_by !== user.id ? [{ uids: [t.created_by], title: `${user.name} picked up a task`, body: t.title }] : [];
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  // ---------- "what's needed" checklist ----------

  app.post('/api/tasks/:id/checklist', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const { text } = await body(c, z.object({ text: z.string().trim().min(1).max(LIMITS.checklistItem) }));
    await mutate(async (db) => {
      await lockTask(db, taskId, user.id);
      const { rows } = await db.query<{ n: number; pos: number }>(
        'select count(*)::int as n, coalesce(max(position), 0)::int as pos from checklist_items where task_id = $1',
        [taskId],
      );
      if (rows[0]!.n >= LIMITS.checklistItems) throw conflict(`Max ${LIMITS.checklistItems} items.`);
      await db.query('insert into checklist_items (task_id, text, position) values ($1, $2, $3)', [taskId, text, rows[0]!.pos + 1]);
      await db.query('update tasks set updated_by = $2, updated_at = now() where id = $1', [taskId, user.id]);
      await logActivity(db, taskId, user.id, 'checklist', `added needed item “${text}”`);
    }, taskId);
    return c.json(await taskOr404(user.id, taskId), 201);
  });

  app.post('/api/tasks/:id/checklist/:itemId/toggle', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const itemId = parseUuid(c.req.param('itemId'), 'item');
    await mutate(async (db) => {
      await lockTask(db, taskId, user.id);
      const { rows } = await db.query<{ text: string; done: boolean }>(
        `update checklist_items set done = not done,
                done_by = case when done then null else $3 end,
                done_at = case when done then null else now() end
          where id = $2 and task_id = $1 returning text, done`,
        [taskId, itemId, user.id],
      );
      if (!rows[0]) throw notFound('Item not found.');
      await db.query('update tasks set updated_by = $2, updated_at = now() where id = $1', [taskId, user.id]);
      await logActivity(db, taskId, user.id, 'checklist', `${rows[0].done ? 'furnished' : 'reopened'} “${rows[0].text}”`);
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  app.delete('/api/tasks/:id/checklist/:itemId', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const itemId = parseUuid(c.req.param('itemId'), 'item');
    await mutate(async (db) => {
      await lockTask(db, taskId, user.id);
      const { rows } = await db.query<{ text: string }>(
        'delete from checklist_items where id = $2 and task_id = $1 returning text',
        [taskId, itemId],
      );
      if (!rows[0]) throw notFound('Item not found.');
      await db.query('update tasks set updated_by = $2, updated_at = now() where id = $1', [taskId, user.id]);
      await logActivity(db, taskId, user.id, 'checklist', `removed needed item “${rows[0].text}”`);
    }, taskId);
    return c.json(await taskOr404(user.id, taskId));
  });

  // ---------- comments & activity ----------

  app.get('/api/tasks/:id/comments', async (c) => {
    const taskId = parseUuid(c.req.param('id'), 'task');
    await taskOr404(c.get('user').id, taskId);
    return c.json(await loadComments(pool, taskId));
  });

  app.post('/api/tasks/:id/comments', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const { text } = await body(c, z.object({ text: z.string().trim().min(1).max(LIMITS.comment) }));
    await mutate(async (db, out) => {
      const t = await lockTask(db, taskId, user.id);
      const members = await memberNames(db, t.group_id);
      // Mentions are computed here from member names — never trusted from the client.
      const mentions = extractMentions(text, members).filter((u) => u !== user.id);
      await db.query('insert into comments (task_id, author_id, text, mentions) values ($1, $2, $3, $4)', [
        taskId,
        user.id,
        text,
        mentions,
      ]);
      out.notes = onCommentNotes(taskLike(t), { authorId: user.id, authorName: user.name, text, mentions }, Object.keys(members));
    }, taskId);
    return c.json(await loadComments(pool, taskId), 201);
  });

  app.get('/api/tasks/:id/activity', async (c) => {
    const taskId = parseUuid(c.req.param('id'), 'task');
    await taskOr404(c.get('user').id, taskId);
    return c.json(await loadActivity(pool, taskId));
  });

  // ---------- attachments ----------

  app.post('/api/tasks/:id/attachments', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    if (!deps.storage) throw new HttpError(501, 'Attachments are not enabled on this server.');
    const task = await taskOr404(user.id, taskId);
    if (task.attachments.length >= LIMITS.attachments) throw conflict(`Max ${LIMITS.attachments} attachments per task.`);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Send the file as multipart field "file".');
    if (!UPLOAD_TYPES.test(file.type)) throw new HttpError(415, 'Only photos and PDFs can be attached.');
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'File is larger than 4 MB.');
    const safeName = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';

    const stored = await deps.storage.put(`tasks/${taskId}/${safeName}`, file, file.type);
    try {
      await mutate(async (db) => {
        await lockTask(db, taskId, user.id);
        const { rows } = await db.query<{ n: number }>('select count(*)::int as n from attachments where task_id = $1', [taskId]);
        if (rows[0]!.n >= LIMITS.attachments) throw conflict(`Max ${LIMITS.attachments} attachments per task.`);
        await db.query(
          `insert into attachments (task_id, name, url, pathname, content_type, size_bytes, uploaded_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [taskId, safeName, stored.url, stored.pathname, file.type, file.size, user.id],
        );
        await db.query('update tasks set updated_by = $2, updated_at = now() where id = $1', [taskId, user.id]);
        await logActivity(db, taskId, user.id, 'attachment', `attached “${safeName}”`);
      }, taskId);
    } catch (e) {
      await deps.storage.delete([stored.pathname]).catch(() => {}); // don't leave an orphaned file
      throw e;
    }
    return c.json(await taskOr404(user.id, taskId), 201);
  });

  app.delete('/api/tasks/:id/attachments/:aid', async (c) => {
    const user = c.get('user');
    const taskId = parseUuid(c.req.param('id'), 'task');
    const aid = parseUuid(c.req.param('aid'), 'attachment');
    const pathname = await mutate(async (db) => {
      const t = await lockTask(db, taskId, user.id);
      const { rows } = await db.query<{ pathname: string; name: string; uploaded_by: string | null }>(
        'select pathname, name, uploaded_by from attachments where id = $2 and task_id = $1',
        [taskId, aid],
      );
      const a = rows[0];
      if (!a) throw notFound('Attachment not found.');
      if (a.uploaded_by !== user.id && !canEditDetails(perm(t), groupOf(t, user.id), user.id)) {
        throw forbidden('Only the uploader, the assigner or an admin can remove this file.');
      }
      await db.query('delete from attachments where id = $1', [aid]);
      await logActivity(db, taskId, user.id, 'attachment', `removed “${a.name}”`);
      return a.pathname;
    }, taskId);
    if (deps.storage) deps.background(deps.storage.delete([pathname]).catch(() => {}));
    return c.json(await taskOr404(user.id, taskId));
  });
}

export type { SessionUser };
