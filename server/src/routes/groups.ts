import { z } from 'zod';
import type { App, Deps } from '../context.js';
import { tx, type Client } from '../db.js';
import { badRequest, body, conflict, forbidden, HttpError, notFound, parseUuid, pgCode } from '../http.js';
import { loadGroup, loadGroups, tasksInGroup } from '../queries.js';
import { generateInviteCode, INVITE_TTL_DAYS, isValidInviteCode, LIMITS, normalizeInviteCode } from '../shared/logic.js';
import type { Role } from '../shared/types.js';

const MAX_MEMBERS = 50;

const groupInput = z.object({
  name: z.string().trim().min(1, 'Group name is required.').max(LIMITS.groupName),
  description: z.string().trim().max(LIMITS.groupDescription).default(''),
});

async function roleIn(db: Pick<Client, 'query'>, groupId: string, userId: string, lock = false): Promise<Role | null> {
  const { rows } = await db.query<{ role: Role }>(
    `select role from group_members where group_id = $1 and user_id = $2${lock ? ' for update' : ''}`,
    [groupId, userId],
  );
  return rows[0]?.role ?? null;
}

const isAdminRole = (r: Role | null) => r === 'owner' || r === 'admin';

/** Retries on the (rare) invite-code collision. */
async function withFreshCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(generateInviteCode());
    } catch (e) {
      if (pgCode(e) !== '23505' || attempt >= 4) throw e;
    }
  }
}

export function registerGroupRoutes(app: App, deps: Deps) {
  const { pool } = deps;

  app.get('/api/groups', async (c) => c.json(await loadGroups(pool, c.get('user').id)));

  app.post('/api/groups', async (c) => {
    const user = c.get('user');
    const input = await body(c, groupInput);
    const groupId = await withFreshCode((code) =>
      tx(pool, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into groups (name, description, owner_id, invite_code, invite_expires_at)
           values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id`,
          [input.name, input.description, user.id, code, INVITE_TTL_DAYS],
        );
        await db.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'owner')`, [rows[0]!.id, user.id]);
        return rows[0]!.id;
      }),
    );
    return c.json(await loadGroup(pool, user.id, groupId), 201);
  });

  app.get('/api/groups/:id', async (c) => {
    const group = await loadGroup(pool, c.get('user').id, parseUuid(c.req.param('id'), 'group'));
    if (!group) throw notFound('Group not found.');
    return c.json(group);
  });

  app.get('/api/groups/:id/tasks', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    if (!(await roleIn(pool, groupId, user.id))) throw notFound('Group not found.');
    return c.json(await tasksInGroup(pool, user.id, groupId));
  });

  app.patch('/api/groups/:id', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    const input = await body(c, groupInput);
    const role = await roleIn(pool, groupId, user.id);
    if (!role) throw notFound('Group not found.');
    if (!isAdminRole(role)) throw forbidden('Only admins can edit the group.');
    await pool.query('update groups set name = $2, description = $3, updated_at = now() where id = $1', [
      groupId,
      input.name,
      input.description,
    ]);
    return c.json(await loadGroup(pool, user.id, groupId));
  });

  app.delete('/api/groups/:id', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    const pathnames = await tx(pool, async (db) => {
      const role = await roleIn(db, groupId, user.id, true);
      if (!role) throw notFound('Group not found.');
      if (role !== 'owner') throw forbidden('Only the owner can delete the group.');
      const files = await db.query<{ pathname: string }>(
        'select a.pathname from attachments a join tasks t on t.id = a.task_id where t.group_id = $1',
        [groupId],
      );
      await db.query('delete from groups where id = $1', [groupId]); // cascades to members, tasks, …
      return files.rows.map((r) => r.pathname);
    });
    if (deps.storage && pathnames.length) deps.background(deps.storage.delete(pathnames).catch(() => {}));
    return c.json({ ok: true });
  });

  app.post('/api/groups/join', async (c) => {
    const user = c.get('user');
    const { code: raw } = await body(c, z.object({ code: z.string().max(20) }));
    const code = normalizeInviteCode(raw);
    if (!isValidInviteCode(code)) throw badRequest('Invite codes are 6 letters/numbers.');
    const groupId = await tx(pool, async (db) => {
      const { rows } = await db.query<{ id: string; expired: boolean }>(
        `select id, invite_expires_at < now() as expired from groups where invite_code = $1 for update`,
        [code],
      );
      const g = rows[0];
      if (!g) throw notFound('Invite code not found.');
      if (await roleIn(db, g.id, user.id)) return g.id; // already a member: idempotent
      if (g.expired) throw new HttpError(410, 'This invite has expired. Ask for a new code.');
      const count = await db.query<{ n: number }>('select count(*)::int as n from group_members where group_id = $1', [g.id]);
      if (count.rows[0]!.n >= MAX_MEMBERS) throw conflict(`Groups are limited to ${MAX_MEMBERS} members.`);
      await db.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'member') on conflict do nothing`, [
        g.id,
        user.id,
      ]);
      await db.query('update groups set updated_at = now() where id = $1', [g.id]);
      return g.id;
    });
    return c.json(await loadGroup(pool, user.id, groupId));
  });

  app.post('/api/groups/:id/invite', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    const role = await roleIn(pool, groupId, user.id);
    if (!role) throw notFound('Group not found.');
    if (!isAdminRole(role)) throw forbidden('Only admins can reset the invite code.');
    await withFreshCode((code) =>
      pool.query(
        `update groups set invite_code = $2, invite_expires_at = now() + make_interval(days => $3), updated_at = now()
          where id = $1`,
        [groupId, code, INVITE_TTL_DAYS],
      ),
    );
    return c.json(await loadGroup(pool, user.id, groupId));
  });

  app.patch('/api/groups/:id/members/:uid', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    const target = c.req.param('uid');
    const { role } = await body(c, z.object({ role: z.enum(['admin', 'member']) }));
    await tx(pool, async (db) => {
      const mine = await roleIn(db, groupId, user.id);
      if (!mine) throw notFound('Group not found.');
      if (mine !== 'owner') throw forbidden('Only the owner can change roles.');
      const theirs = await roleIn(db, groupId, target, true);
      if (!theirs) throw notFound('Member not found.');
      if (theirs === 'owner') throw forbidden("The owner's role can't be changed.");
      await db.query('update group_members set role = $3 where group_id = $1 and user_id = $2', [groupId, target, role]);
    });
    return c.json(await loadGroup(pool, user.id, groupId));
  });

  /** Leave (yourself) or remove someone (admins). The owner can't be removed. */
  app.delete('/api/groups/:id/members/:uid', async (c) => {
    const user = c.get('user');
    const groupId = parseUuid(c.req.param('id'), 'group');
    const target = c.req.param('uid');
    await tx(pool, async (db) => {
      const mine = await roleIn(db, groupId, user.id);
      if (!mine) throw notFound('Group not found.');
      const theirs = await roleIn(db, groupId, target, true);
      if (!theirs) throw notFound('Member not found.');
      if (theirs === 'owner') throw forbidden('The owner cannot leave. Delete the group instead.');
      if (target !== user.id && !isAdminRole(mine)) throw forbidden('Only admins can remove members.');
      await db.query('delete from group_members where group_id = $1 and user_id = $2', [groupId, target]);
      // Unassign them from this group's open tasks so nothing is left with an absent owner.
      await db.query(
        `delete from task_assignees a using tasks t
          where a.task_id = t.id and t.group_id = $1 and a.user_id = $2 and t.status <> 'done'`,
        [groupId, target],
      );
      await db.query('update groups set updated_at = now() where id = $1', [groupId]);
    });
    return c.json({ ok: true });
  });
}

export { roleIn, isAdminRole };
