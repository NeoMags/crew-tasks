import type { Deps } from './context.js';
import { insertNotifications, sendPush, type Outbox } from './notify.js';
import { overdueNote } from './notifyLogic.js';

/**
 * Announces tasks that just became overdue, at most once per due date (overdue_notified),
 * and safe to run concurrently: rows are claimed with FOR UPDATE SKIP LOCKED.
 */
export async function runOverdueScan(deps: Deps, limit = 200): Promise<number> {
  const client = await deps.pool.connect();
  const outboxes: Outbox[] = [];
  try {
    await client.query('begin');
    const { rows } = await client.query<{
      id: string;
      title: string;
      created_by: string;
      group_name: string;
      assignee_ids: string[];
    }>(
      `with due as (
         select id from tasks
          where overdue_notified = false and status <> 'done' and due_at is not null and due_at <= now()
          order by due_at
          limit $1
          for update skip locked)
       update tasks t set overdue_notified = true
         from due, groups g
        where t.id = due.id and g.id = t.group_id
       returning t.id, t.title, t.created_by, g.name as group_name,
         coalesce((select array_agg(a.user_id) from task_assignees a where a.task_id = t.id), '{}') as assignee_ids`,
      [limit],
    );
    for (const r of rows) {
      const note = overdueNote({
        title: r.title,
        groupName: r.group_name,
        assigneeIds: r.assignee_ids,
        createdBy: r.created_by,
        status: 'todo',
      });
      if (!note) continue;
      const out = { taskId: r.id, notes: [note] };
      await insertNotifications(client, out);
      outboxes.push(out);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  for (const out of outboxes) await sendPush(deps.pool, deps.env, out, deps.fetch).catch(() => {});
  return outboxes.length;
}

/**
 * Free-tier friendly scheduling: Vercel Hobby cron runs only daily, so normal API traffic
 * also triggers a scan, at most once every `everyMinutes` across all instances.
 */
export async function maybeRunOverdueScan(deps: Deps, everyMinutes = 10): Promise<void> {
  const { rowCount } = await deps.pool.query(
    `insert into app_meta (key, value, updated_at) values ('overdue_scan', '', now())
     on conflict (key) do update set updated_at = now()
       where app_meta.updated_at < now() - make_interval(mins => $1)`,
    [everyMinutes],
  );
  if (rowCount) await runOverdueScan(deps);
}
