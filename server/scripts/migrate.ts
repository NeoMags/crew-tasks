/**
 * Creates/updates all tables. Safe to run repeatedly (idempotent).
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=... npm run migrate
 * Use the Neon *direct* (non-pooler) connection string for migrations if the pooler rejects DDL.
 */
import { pathToFileURL } from 'node:url';
import { loadEnv } from '../src/env.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    const applied = await migrate(pool, env);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}
