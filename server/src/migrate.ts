import { getMigrations } from 'better-auth/db/migration';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authOptions } from './auth.js';
import type { Pool } from './db.js';
import type { Env } from './env.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** 1) Better Auth tables, 2) numbered SQL files in migrations/, each applied once. */
export async function migrate(pool: Pool, env: Env): Promise<string[]> {
  const applied: string[] = [];

  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(authOptions(pool, env));
  if (toBeCreated.length || toBeAdded.length) {
    await runMigrations();
    applied.push('better-auth');
  }

  await pool.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
