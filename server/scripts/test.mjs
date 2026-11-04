#!/usr/bin/env node
/**
 * Runs the server tests against Postgres.
 *  - If TEST_DATABASE_URL is set (CI service container, or your own throwaway DB), uses it.
 *  - Otherwise starts a temporary embedded Postgres, runs the tests, and removes it.
 * Postgres runs in this launcher process, not in the test process, so its exit hooks
 * can't interfere with the test runner's exit code.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const testArgs = ['--import', 'tsx', '--test', '--test-concurrency=1', ...process.argv.slice(2)];
if (process.argv.length <= 2) testArgs.push('test/*.test.ts');

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, testArgs, { stdio: 'inherit', env: { ...process.env, ...env }, shell: false });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

if (process.env.TEST_DATABASE_URL) {
  process.exit(await run({}));
}

const { default: EmbeddedPostgres } = await import('embedded-postgres');
// Postgres refuses to run as root; embedded-postgres then uses a "postgres" user, which needs access.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crewtasks-pg-'));
fs.chmodSync(base, 0o777);
const port = await freePort();
const pg = new EmbeddedPostgres({
  databaseDir: path.join(base, 'data'),
  user: 'postgres',
  password: 'test',
  port,
  persistent: false,
  onLog: () => {},
});
let code = 1;
try {
  await pg.initialise();
  await pg.start();
  code = await run({ TEST_DATABASE_URL: `postgres://postgres:test@localhost:${port}/postgres` });
} finally {
  await pg.stop().catch(() => {});
  fs.rmSync(base, { recursive: true, force: true });
}
process.exit(code);
