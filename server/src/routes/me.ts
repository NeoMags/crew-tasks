import { z } from 'zod';
import type { App, Deps } from '../context.js';
import { body } from '../http.js';
import { LIMITS } from '../shared/logic.js';
import type { AppNotification } from '../shared/types.js';

export function registerMeRoutes(app: App, deps: Deps) {
  const { pool, auth } = deps;

  app.get('/api/me', (c) => c.json(c.get('user')));

  app.patch('/api/me', async (c) => {
    const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(LIMITS.displayName) }));
    await auth.api.updateUser({ body: { name }, headers: c.req.raw.headers });
    return c.json({ ...c.get('user'), name });
  });

  // Expo push tokens. A token moves to whoever signed in last on that phone.
  app.post('/api/devices', async (c) => {
    const { token, platform } = await body(
      c,
      z.object({ token: z.string().min(10).max(4096), platform: z.string().max(20).default('android') }),
    );
    await pool.query(
      `insert into devices (token, user_id, platform) values ($1, $2, $3)
       on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()`,
      [token, c.get('user').id, platform],
    );
    return c.json({ ok: true });
  });

  app.delete('/api/devices', async (c) => {
    const { token } = await body(c, z.object({ token: z.string().min(1).max(4096) }));
    await pool.query('delete from devices where token = $1 and user_id = $2', [token, c.get('user').id]);
    return c.json({ ok: true });
  });

  // In-app inbox
  app.get('/api/notifications', async (c) => {
    const uid = c.get('user').id;
    const [items, unread] = await Promise.all([
      pool.query(
        `select id, task_id, title, body, read_at, created_at from notifications
          where user_id = $1 order by created_at desc, id desc limit 50`,
        [uid],
      ),
      pool.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [uid]),
    ]);
    const list: AppNotification[] = items.rows.map((r) => ({
      id: String(r.id),
      taskId: r.task_id,
      title: r.title,
      body: r.body,
      read: r.read_at != null,
      createdAt: r.created_at,
    }));
    return c.json({ items: list, unread: unread.rows[0]!.n });
  });

  app.post('/api/notifications/read', async (c) => {
    const { ids } = await body(c, z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(200).optional() }));
    await pool.query(
      `update notifications set read_at = now()
        where user_id = $1 and read_at is null and ($2::bigint[] is null or id = any($2::bigint[]))`,
      [c.get('user').id, ids ?? null],
    );
    return c.json({ ok: true });
  });
}
