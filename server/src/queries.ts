/**
 * Read models. Every query is scoped to groups the requesting user belongs to —
 * that membership join IS the read authorization.
 */
import type { Queryable } from './db.js';
import type { Activity, Comment, Group, Role, Task } from './shared/types.js';

const isMember = (taskAlias: string, userParam: string) =>
  `exists (select 1 from group_members gm where gm.group_id = ${taskAlias}.group_id and gm.user_id = ${userParam})`;

export async function loadGroups(db: Queryable, userId: string, groupId?: string): Promise<Group[]> {
  const { rows } = await db.query(
    `select g.id, g.name, g.description, g.owner_id, g.invite_code, g.invite_expires_at, g.created_at, g.updated_at,
            json_agg(json_build_object('id', m.user_id, 'name', u.name, 'role', m.role) order by m.joined_at) as members
       from groups g
       join group_members me on me.group_id = g.id and me.user_id = $1
       join group_members m on m.group_id = g.id
       join "user" u on u.id = m.user_id
      where ($2::uuid is null or g.id = $2)
      group by g.id
      order by lower(g.name)`,
    [userId, groupId ?? null],
  );
  return rows.map((r) => {
    const members = r.members as { id: string; name: string; role: Role }[];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.owner_id,
      memberIds: members.map((m) => m.id),
      members: Object.fromEntries(members.map((m) => [m.id, { name: m.name, role: m.role }])),
      inviteCode: r.invite_code,
      inviteExpiresAt: r.invite_expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function loadGroup(db: Queryable, userId: string, groupId: string): Promise<Group | null> {
  return (await loadGroups(db, userId, groupId))[0] ?? null;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

const TASK_SELECT = `
  select t.*, g.name as group_name, cu.name as created_by_name,
    coalesce((select array_agg(a.user_id order by a.user_id) from task_assignees a where a.task_id = t.id), '{}') as assignee_ids,
    coalesce((select json_agg(json_build_object(
                'id', c.id, 'text', c.text, 'done', c.done, 'doneBy', c.done_by,
                'doneByName', du.name, 'doneAt', c.done_at) order by c.position, c.created_at)
              from checklist_items c left join "user" du on du.id = c.done_by
             where c.task_id = t.id), '[]') as checklist,
    coalesce((select json_agg(json_build_object(
                'id', at.id, 'name', at.name, 'url', at.url, 'contentType', at.content_type,
                'sizeBytes', at.size_bytes, 'uploadedBy', at.uploaded_by,
                'uploadedByName', coalesce(uu.name, 'Former member'), 'uploadedAt', at.uploaded_at) order by at.uploaded_at)
              from attachments at left join "user" uu on uu.id = at.uploaded_by
             where at.task_id = t.id), '[]') as attachments
    from tasks t
    join groups g on g.id = t.group_id
    join "user" cu on cu.id = t.created_by`;

type Row = Record<string, unknown>;

function toTask(r: Row): Task {
  const checklist = (r.checklist as Row[]).map((c) => ({ ...c, doneAt: iso(c.doneAt) })) as unknown as Task['checklist'];
  const attachments = (r.attachments as Row[]).map((a) => ({ ...a, uploadedAt: iso(a.uploadedAt) })) as unknown as Task['attachments'];
  return {
    id: r.id as string,
    groupId: r.group_id as string,
    groupName: r.group_name as string,
    title: r.title as string,
    description: r.description as string,
    assigneeIds: r.assignee_ids as string[],
    createdBy: r.created_by as string,
    createdByName: r.created_by_name as string,
    status: r.status as Task['status'],
    blockedReason: r.blocked_reason as string,
    requiresApproval: r.requires_approval as boolean,
    priority: r.priority as Task['priority'],
    progress: Number(r.progress),
    dueAt: (r.due_at as string | null) ?? null,
    recurrence: r.recurrence as Task['recurrence'],
    checklist,
    attachments,
    nextTaskId: (r.next_task_id as string | null) ?? null,
    recurredFrom: (r.recurred_from as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

// Lists cap at the most recently updated 500 to keep responses small.
const LIST_LIMIT = 500;

export async function tasksAssignedTo(db: Queryable, userId: string): Promise<Task[]> {
  const { rows } = await db.query(
    `${TASK_SELECT}
      where ${isMember('t', '$1')}
        and exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = $1)
      order by t.updated_at desc limit ${LIST_LIMIT}`,
    [userId],
  );
  return rows.map(toTask);
}

export async function tasksCreatedBy(db: Queryable, userId: string): Promise<Task[]> {
  const { rows } = await db.query(
    `${TASK_SELECT} where t.created_by = $1 and ${isMember('t', '$1')}
      order by t.updated_at desc limit ${LIST_LIMIT}`,
    [userId],
  );
  return rows.map(toTask);
}

export async function tasksInGroup(db: Queryable, userId: string, groupId: string): Promise<Task[]> {
  const { rows } = await db.query(
    `${TASK_SELECT} where t.group_id = $2 and ${isMember('t', '$1')}
      order by t.updated_at desc limit ${LIST_LIMIT}`,
    [userId, groupId],
  );
  return rows.map(toTask);
}

export async function loadTask(db: Queryable, userId: string, taskId: string): Promise<Task | null> {
  const { rows } = await db.query(`${TASK_SELECT} where t.id = $2 and ${isMember('t', '$1')}`, [userId, taskId]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function loadComments(db: Queryable, taskId: string): Promise<Comment[]> {
  const { rows } = await db.query(
    `select c.id, c.author_id, coalesce(u.name, 'Former member') as author_name, c.text, c.mentions, c.created_at
       from comments c left join "user" u on u.id = c.author_id
      where c.task_id = $1 order by c.created_at asc limit 200`,
    [taskId],
  );
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    text: r.text,
    mentions: r.mentions,
    createdAt: r.created_at,
  }));
}

export async function loadActivity(db: Queryable, taskId: string): Promise<Activity[]> {
  const { rows } = await db.query(
    `select a.id, a.actor_id, coalesce(u.name, 'Former member') as actor_name, a.type, a.message, a.created_at
       from activity a left join "user" u on u.id = a.actor_id
      where a.task_id = $1 order by a.created_at desc, a.id desc limit 50`,
    [taskId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    actorId: r.actor_id,
    actorName: r.actor_name,
    type: r.type,
    message: r.message,
    createdAt: r.created_at,
  }));
}
