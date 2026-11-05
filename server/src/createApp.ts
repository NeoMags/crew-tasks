import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Deps } from './context.js';
import { HttpError } from './http.js';
import { maybeRunOverdueScan, runOverdueScan } from './overdue.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerMeRoutes } from './routes/me.js';
import { registerTaskRoutes } from './routes/tasks.js';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', secureHeaders());
  app.use('/api/*', bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (c) => c.json({ error: 'Request too large.' }, 413) }));

  app.get('/', (c) => c.text('Crew Tasks API'));
  app.get('/api/health', async (c) => {
    await deps.pool.query('select 1');
    return c.json({ ok: true, attachments: !!deps.storage });
  });

  // Better Auth: sign-up, sign-in, sign-out, session…
  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.auth.handler(c.req.raw));

  // Scheduled overdue scan (Vercel Cron sends "Authorization: Bearer $CRON_SECRET").
  app.get('/api/cron/overdue', async (c) => {
    const secret = deps.env.CRON_SECRET;
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({ notified: await runOverdueScan(deps) });
  });

  // Everything below requires a signed-in user.
  app.use('/api/*', async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'Please sign in again.' }, 401);
    c.set('user', { id: session.user.id, name: session.user.name, email: session.user.email });
    await next();
    deps.background(maybeRunOverdueScan(deps).catch((e) => console.warn('overdue scan failed', String(e))));
  });

  registerMeRoutes(app, deps);
  registerGroupRoutes(app, deps);
  registerTaskRoutes(app, deps);

  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  return app;
}
