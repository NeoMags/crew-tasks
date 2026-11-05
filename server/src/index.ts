/**
 * Vercel entry point. Vercel's Hono detection needs this file to import 'hono' and
 * default-export the app; the routes themselves live in createApp.ts.
 *
 * If configuration is missing or invalid, the server still starts and answers every
 * request with a 503 naming the problem (variable names only, never values), instead
 * of crashing with FUNCTION_INVOCATION_FAILED and no explanation.
 */
import { attachDatabasePool, waitUntil } from '@vercel/functions';
import { Hono } from 'hono';
import { createApp } from './createApp.js';
import { createAuth } from './auth.js';
import { createPool } from './db.js';
import { loadEnv } from './env.js';
import { vercelBlobStorage } from './storage.js';

const app = new Hono();

try {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  attachDatabasePool(pool); // lets Vercel close idle connections before suspending an instance

  const api = createApp({
    pool,
    env,
    auth: createAuth(pool, env),
    storage: vercelBlobStorage(env),
    background: (p) => waitUntil(p),
  });
  app.route('/', api);
} catch (e) {
  const problem = (e as Error)?.message ?? 'Unknown startup error';
  console.error('[startup] Server misconfigured:', problem);
  app.all('*', (c) =>
    c.json(
      {
        ok: false,
        error: 'server_misconfigured',
        problem,
        fix: 'Set the missing/invalid Environment Variables in Vercel → Settings, then Redeploy.',
      },
      503,
    ),
  );
}

export default app;
