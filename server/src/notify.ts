/**
 * Notifications: rows in the in-app inbox (written inside the caller's transaction)
 * and best-effort Expo push (sent after commit, never inside a transaction).
 */
import type { Pool, Queryable } from './db.js';
import type { Env } from './env.js';
import type { Note } from './notifyLogic.js';

export interface Outbox {
  taskId: string | null;
  notes: Note[];
}

export async function insertNotifications(db: Queryable, out: Outbox): Promise<void> {
  const rows = out.notes.flatMap((n) => [...new Set(n.uids)].map((uid) => ({ uid, title: n.title, body: n.body })));
  if (!rows.length) return;
  await db.query(
    `insert into notifications (user_id, task_id, title, body)
     select r.uid, $1::uuid, left(r.title, 160), left(r.body, 300)
       from jsonb_to_recordset($2::jsonb) as r(uid text, title text, body text)`,
    [out.taskId, JSON.stringify(rows)],
  );
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export async function sendPush(pool: Pool, env: Env, out: Outbox, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (env.PUSH === 'off' || !out.notes.length) return;
  const uids = [...new Set(out.notes.flatMap((n) => n.uids))];
  const { rows } = await pool.query<{ token: string; user_id: string }>(
    'select token, user_id from devices where user_id = any($1::text[])',
    [uids],
  );
  if (!rows.length) return;
  const byUser = new Map<string, string[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.token]);

  const messages = out.notes.flatMap((n) =>
    [...new Set(n.uids)].flatMap((uid) =>
      (byUser.get(uid) ?? []).map((to) => ({
        to,
        title: n.title.slice(0, 120),
        body: n.body.slice(0, 240),
        data: out.taskId ? { url: `/task/${out.taskId}`, taskId: out.taskId } : { url: '/inbox' },
        channelId: 'default',
        sound: 'default' as const,
        priority: 'high' as const,
      })),
    ),
  );

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn('expo push failed', res.status);
        continue;
      }
      const { data } = (await res.json()) as { data?: ExpoTicket[] };
      // Remove tokens for uninstalled apps so we stop sending to them.
      const dead = (data ?? [])
        .map((t, idx) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? chunk[idx]!.to : null))
        .filter((t): t is string => !!t);
      if (dead.length) await pool.query('delete from devices where token = any($1::text[])', [dead]);
    } catch (e) {
      console.warn('expo push error', String(e));
    }
  }
}
