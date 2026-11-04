import { createApp } from '../src/createApp.js';
import { createAuth } from '../src/auth.js';
import { createPool, type Pool } from '../src/db.js';
import { loadEnv, type Env } from '../src/env.js';
import { migrate } from '../src/migrate.js';
import { memoryStorage } from '../src/storage.js';

export interface PushCall {
  to: string;
  title: string;
  body: string;
}

/**
 * Tests need TEST_DATABASE_URL pointing at a throwaway Postgres (its public schema is wiped).
 * `npm test` starts an embedded Postgres automatically (scripts/test.mjs); CI uses a service container.
 */
export async function startTestServer() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set — run tests with `npm test`.');
  const reset = createPool(url);
  await reset.query('drop schema if exists public cascade; create schema public;');
  await reset.end();

  const env: Env = loadEnv({
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    BETTER_AUTH_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    CRON_SECRET: 'cron-test',
  });
  const pool: Pool = createPool(env.DATABASE_URL);
  await migrate(pool, env);

  const pending: Promise<unknown>[] = [];
  const pushes: PushCall[] = [];
  const deadTokens = new Set<string>();
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const msgs = JSON.parse(String(init?.body)) as PushCall[];
    pushes.push(...msgs);
    return new Response(
      JSON.stringify({
        data: msgs.map((m) =>
          deadTokens.has(m.to) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' },
        ),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const emails: { to: string; subject: string; text: string }[] = [];
  const storage = memoryStorage();
  const deps = {
    pool,
    env,
    auth: createAuth(pool, env, { send: async (m) => void emails.push(m) }),
    storage,
    background: (p: Promise<unknown>) => void pending.push(p),
    fetch: fakeFetch,
  };
  const app = createApp(deps);

  /** Wait for after-response work (push, overdue scan) so assertions are deterministic. */
  const settle = async () => {
    while (pending.length) await Promise.allSettled(pending.splice(0));
  };

  async function request(method: string, url: string, opts: { cookie?: string; json?: unknown; form?: FormData } = {}) {
    const headers: Record<string, string> = { origin: 'http://localhost:3000' };
    if (opts.cookie) headers.cookie = opts.cookie;
    let reqBody: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      reqBody = JSON.stringify(opts.json);
    } else if (opts.form) {
      reqBody = opts.form;
    }
    const res = await app.request(`http://localhost:3000${url}`, { method, headers, body: reqBody });
    await settle();
    const text = await res.text();
    let data: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }

  let seq = 0;
  async function signUp(name: string) {
    const email = `${name.toLowerCase().replace(/\W/g, '')}${++seq}@example.com`;
    const res = await request('POST', '/api/auth/sign-up/email', { json: { name, email, password: 'password123' } });
    if (res.status !== 200) throw new Error(`sign-up failed ${res.status} ${JSON.stringify(res.data)}`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const id = res.data.user.id as string;
    const as = (method: string, url: string, json?: unknown) => request(method, url, { cookie, json });
    return { id, name, email, cookie, as, upload: (url: string, form: FormData) => request('POST', url, { cookie, form }) };
  }

  async function stop() {
    await settle();
    await pool.end();
  }

  return { app, pool, env, request, signUp, emails, pushes, deadTokens, storage, settle, stop, deps };
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;
export type TestUser = Awaited<ReturnType<TestServer['signUp']>>;
