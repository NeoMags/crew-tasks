/**
 * Vercel entry point. Vercel's Hono detection needs this file to import 'hono' and
 * default-export the app; the routes themselves live in createApp.ts.
 */
import { attachDatabasePool, waitUntil } from '@vercel/functions';
import { Hono } from 'hono';
import { createApp } from './createApp.js';
import { createAuth } from './auth.js';
import { createPool } from './db.js';
import { loadEnv } from './env.js';
import { vercelBlobStorage } from './storage.js';

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

const app = new Hono();
app.route('/', api);

export default app;
