import type { Hono } from 'hono';
import type { Auth } from './auth.js';
import type { Pool } from './db.js';
import type { Env } from './env.js';
import { insertNotifications, sendPush, type Outbox } from './notify.js';
import type { Storage } from './storage.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type AppEnv = { Variables: { user: SessionUser } };
export type App = Hono<AppEnv>;

export interface Deps {
  pool: Pool;
  env: Env;
  auth: Auth;
  storage: Storage | null;
  /** Runs work after the response (Vercel waitUntil in production; awaited in tests). */
  background: (p: Promise<unknown>) => void;
  fetch?: typeof fetch;
}

/** After a transaction commits: push the notifications it recorded. */
export function deliver(deps: Deps, out: Outbox | null) {
  if (!out || !out.notes.length) return;
  deps.background(sendPush(deps.pool, deps.env, out, deps.fetch).catch((e) => console.warn('push failed', String(e))));
}

export { insertNotifications };
