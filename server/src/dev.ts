/** Local dev server: `npm run dev` (reads server/.env). */
import { serve } from '@hono/node-server';
import { createApp } from './createApp.js';
import { createAuth } from './auth.js';
import { createPool } from './db.js';
import { loadEnv } from './env.js';
import { vercelBlobStorage } from './storage.js';

process.loadEnvFile?.('.env');
const env = loadEnv({ ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' });
const pool = createPool(env.DATABASE_URL);
const app = createApp({
  pool,
  env,
  auth: createAuth(pool, env),
  storage: vercelBlobStorage(env),
  background: (p) => void p,
});
const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => console.log(`Crew Tasks API on http://localhost:${port}`));
