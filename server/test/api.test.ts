/**
 * API integration tests against a real Postgres (embedded). These replace the old
 * Firestore security-rules tests: every permission rule is checked here.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runOverdueScan } from '../src/overdue.js';
import { startTestServer, type TestServer, type TestUser } from './helpers.js';

let s: TestServer;
before(async () => {
  s = await startTestServer();
});
after(async () => s?.stop());

/** owner, admin, two members, and an outsider in one group. */
async function crew() {
  const owner = await s.signUp('Asha');
  const admin = await s.signUp('Bala');
  const m1 = await s.signUp('Chetan');
  const m2 = await s.signUp('Divya');
  const stranger = await s.signUp('Eve');
  const g = await owner.as('POST', '/api/groups', { name: 'Trip crew', description: 'Goa' });
  assert.equal(g.status, 201);
  const code = g.data.inviteCode as string;
  for (const u of [admin, m1, m2]) assert.equal((await u.as('POST', '/api/groups/join', { code })).status, 200);
  assert.equal((await owner.as('PATCH', `/api/groups/${g.data.id}/members/${admin.id}`, { role: 'admin' })).status, 200);
  return { owner, admin, m1, m2, stranger, groupId: g.data.id as string, code };
}

async function newTask(u: TestUser, groupId: string, extra: Record<string, unknown> = {}) {
  const r = await u.as('POST', '/api/tasks', { groupId, title: 'Book bus tickets', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data as { id: string; [k: string]: unknown };
}

describe('auth', () => {
  test('API requires a session', async () => {
    assert.equal((await s.request('GET', '/api/groups')).status, 401);
    assert.equal((await s.request('GET', '/api/groups', { cookie: 'better-auth.session_token=forged' })).status, 401);
  });

  test('sign-up returns a working session and /api/me', async () => {
    const u = await s.signUp('Farah');
    const me = await u.as('GET', '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.name, 'Farah');
    assert.equal((await u.as('PATCH', '/api/me', { name: 'Farah K' })).data.name, 'Farah K');
    assert.equal((await u.as('GET', '/api/me')).data.name, 'Farah K');
  });
});

describe('password reset', () => {
  test('emailed code resets the password; wrong code is rejected', async () => {
    const u = await s.signUp('Hari');
    assert.equal((await s.request('POST', '/api/auth/email-otp/request-password-reset', { json: { email: u.email } })).status, 200);
    const mail = s.emails.findLast((m) => m.to === u.email);
    const otp = mail?.subject.match(/^(\d{6})/)?.[1];
    assert.ok(otp, 'reset email with a 6-digit code was sent');
    const wrong = await s.request('POST', '/api/auth/email-otp/reset-password', {
      json: { email: u.email, otp: otp === '000000' ? '111111' : '000000', password: 'newpass123' },
    });
    assert.notEqual(wrong.status, 200);
    const ok = await s.request('POST', '/api/auth/email-otp/reset-password', { json: { email: u.email, otp, password: 'newpass123' } });
    assert.equal(ok.status, 200);
    const signIn = await s.request('POST', '/api/auth/sign-in/email', { json: { email: u.email, password: 'newpass123' } });
    assert.equal(signIn.status, 200);
    const old = await s.request('POST', '/api/auth/sign-in/email', { json: { email: u.email, password: 'password123' } });
    assert.equal(old.status, 401);
  });

  test('unknown emails get the same response (no account enumeration)', async () => {
    const before = s.emails.length;
    const r = await s.request('POST', '/api/auth/email-otp/request-password-reset', { json: { email: 'nobody@example.com' } });
    assert.equal(r.status, 200);
    assert.equal(s.emails.length, before);
  });
});

describe('groups', () => {
  test('create, join with code, membership-scoped reads', async () => {
    const { owner, m1, stranger, groupId, code } = await crew();
    const g = (await m1.as('GET', `/api/groups/${groupId}`)).data;
    assert.equal(g.memberIds.length, 4);
    assert.equal(g.members[owner.id].role, 'owner');
    assert.equal((await stranger.as('GET', `/api/groups/${groupId}`)).status, 404);
    assert.equal((await stranger.as('GET', `/api/groups/${groupId}/tasks`)).status, 404);
    assert.deepEqual((await stranger.as('GET', '/api/groups')).data, []);
    // joining twice is a no-op
    assert.equal((await m1.as('POST', '/api/groups/join', { code })).status, 200);
    assert.equal((await m1.as('GET', `/api/groups/${groupId}`)).data.memberIds.length, 4);
  });

  test('wrong, malformed and expired codes are rejected', async () => {
    const { stranger, groupId, code } = await crew();
    assert.equal((await stranger.as('POST', '/api/groups/join', { code: 'ZZZ999' })).status, 404);
    assert.equal((await stranger.as('POST', '/api/groups/join', { code: 'nope' })).status, 400);
    await s.pool.query(`update groups set invite_expires_at = now() - interval '1 minute' where id = $1`, [groupId]);
    assert.equal((await stranger.as('POST', '/api/groups/join', { code })).status, 410);
  });

  test('admins edit and reset the invite; members cannot', async () => {
    const { admin, m1, stranger, groupId, code } = await crew();
    assert.equal((await m1.as('PATCH', `/api/groups/${groupId}`, { name: 'Hacked' })).status, 403);
    assert.equal((await admin.as('PATCH', `/api/groups/${groupId}`, { name: 'Goa 2026' })).data.name, 'Goa 2026');
    assert.equal((await m1.as('POST', `/api/groups/${groupId}/invite`)).status, 403);
    const fresh = (await admin.as('POST', `/api/groups/${groupId}/invite`)).data.inviteCode;
    assert.notEqual(fresh, code);
    assert.equal((await stranger.as('POST', '/api/groups/join', { code })).status, 404); // old code dead
    assert.equal((await stranger.as('POST', '/api/groups/join', { code: fresh })).status, 200);
  });

  test('roles: only the owner promotes; nobody demotes the owner', async () => {
    const { owner, admin, m1, groupId } = await crew();
    assert.equal((await admin.as('PATCH', `/api/groups/${groupId}/members/${m1.id}`, { role: 'admin' })).status, 403);
    assert.equal((await m1.as('PATCH', `/api/groups/${groupId}/members/${m1.id}`, { role: 'admin' })).status, 403);
    assert.equal((await owner.as('PATCH', `/api/groups/${groupId}/members/${owner.id}`, { role: 'member' })).status, 403);
    assert.equal((await owner.as('PATCH', `/api/groups/${groupId}/members/${m1.id}`, { role: 'admin' })).status, 200);
  });

  test('leave/remove rules; removed members are unassigned from open tasks', async () => {
    const { owner, admin, m1, m2, groupId } = await crew();
    const open = await newTask(owner, groupId, { assigneeIds: [m1.id, m2.id] });
    const done = await newTask(owner, groupId, { assigneeIds: [m1.id] });
    assert.equal((await m1.as('POST', `/api/tasks/${done.id}/status`, { status: 'done' })).status, 200);

    assert.equal((await m2.as('DELETE', `/api/groups/${groupId}/members/${admin.id}`)).status, 403);
    assert.equal((await owner.as('DELETE', `/api/groups/${groupId}/members/${owner.id}`)).status, 403);
    assert.equal((await admin.as('DELETE', `/api/groups/${groupId}/members/${m1.id}`)).status, 200);
    assert.deepEqual((await owner.as('GET', `/api/tasks/${open.id}`)).data.assigneeIds, [m2.id]);
    assert.deepEqual((await owner.as('GET', `/api/tasks/${done.id}`)).data.assigneeIds, [m1.id]); // history kept
    assert.equal((await m1.as('GET', `/api/tasks/${open.id}`)).status, 404); // lost access
    assert.equal((await m2.as('DELETE', `/api/groups/${groupId}/members/${m2.id}`)).status, 200); // leave
  });

  test('only the owner deletes the group; tasks and files go with it', async () => {
    const { owner, admin, m1, groupId } = await crew();
    const t = await newTask(owner, groupId);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'r.jpg', { type: 'image/jpeg' }));
    assert.equal((await m1.upload(`/api/tasks/${t.id}/attachments`, form)).status, 201);
    const filesBefore = s.storage.files.size;
    assert.equal((await admin.as('DELETE', `/api/groups/${groupId}`)).status, 403);
    assert.equal((await owner.as('DELETE', `/api/groups/${groupId}`)).status, 200);
    assert.equal((await owner.as('GET', `/api/tasks/${t.id}`)).status, 404);
    assert.equal(s.storage.files.size, filesBefore - 1);
  });
});

describe('tasks', () => {
  test('create: members only, assignees must be members, validation', async () => {
    const { m1, m2, stranger, groupId } = await crew();
    await newTask(m1, groupId, { assigneeIds: [m2.id], checklist: ['Aadhaar copy', '₹500'] });
    assert.equal((await stranger.as('POST', '/api/tasks', { groupId, title: 'x' })).status, 404);
    assert.equal((await m1.as('POST', '/api/tasks', { groupId, title: 'x', assigneeIds: [stranger.id] })).status, 400);
    assert.equal((await m1.as('POST', '/api/tasks', { groupId, title: '   ' })).status, 400);
    assert.equal((await m1.as('POST', '/api/tasks', { groupId, title: 'x', recurrence: 'daily' })).status, 400);
    assert.equal((await m1.as('POST', '/api/tasks', { groupId, title: 'x', status: 'done' })).data.status, 'todo');
  });

  test('lists: assigned to me, created by me, group board', async () => {
    const { m1, m2, stranger, groupId } = await crew();
    const t = await newTask(m1, groupId, { assigneeIds: [m2.id] });
    assert.ok((await m2.as('GET', '/api/tasks?scope=assigned')).data.some((x: { id: string }) => x.id === t.id));
    assert.ok((await m1.as('GET', '/api/tasks?scope=created')).data.some((x: { id: string }) => x.id === t.id));
    assert.ok((await m2.as('GET', `/api/groups/${groupId}/tasks`)).data.some((x: { id: string }) => x.id === t.id));
    assert.equal((await stranger.as('GET', `/api/tasks/${t.id}`)).status, 404);
    assert.equal((await m1.as('GET', '/api/tasks?scope=everything')).status, 400);
  });

  test('status: assignee/creator/admin yes, other members no; blocked keeps a reason', async () => {
    const { owner, admin, m1, m2, groupId } = await crew();
    const t = await newTask(m2, groupId, { assigneeIds: [m1.id] });
    const res = await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'in_progress' });
    assert.equal(res.status, 200);
    assert.equal((await admin.as('POST', `/api/tasks/${t.id}/status`, { status: 'blocked', blockedReason: 'No money' })).data.blockedReason, 'No money');
    const other = await s.signUp('Gita');
    await other.as('POST', '/api/groups/join', { code: (await owner.as('GET', `/api/groups/${groupId}`)).data.inviteCode });
    assert.equal((await other.as('POST', `/api/tasks/${t.id}/status`, { status: 'done' })).status, 403);
    // …but any member can furnish checklist items
    const withItem = (await other.as('POST', `/api/tasks/${t.id}/checklist`, { text: 'ID copy' })).data;
    const item = withItem.checklist[0];
    const toggled = (await other.as('POST', `/api/tasks/${t.id}/checklist/${item.id}/toggle`)).data.checklist[0];
    assert.equal(toggled.done, true);
    assert.equal(toggled.doneBy, other.id);
    assert.equal(toggled.doneByName, 'Gita');
  });

  test('details: only creator or admin edit; assignees cannot', async () => {
    const { admin, m1, m2, stranger, groupId } = await crew();
    const t = await newTask(m2, groupId, { assigneeIds: [m1.id] });
    const edit = (u: TestUser, extra: Record<string, unknown> = {}) =>
      u.as('PATCH', `/api/tasks/${t.id}`, { title: 'Renamed', assigneeIds: [m1.id], ...extra });
    assert.equal((await edit(m1)).status, 403);
    assert.equal((await edit(m2)).data.title, 'Renamed');
    assert.equal((await edit(admin, { assigneeIds: [stranger.id] })).status, 400);
    assert.equal((await m1.as('DELETE', `/api/tasks/${t.id}`)).status, 403);
    assert.equal((await admin.as('DELETE', `/api/tasks/${t.id}`)).status, 200);
  });

  test('approval: assignee submits for review, creator approves', async () => {
    const { m1, m2, groupId } = await crew();
    const t = await newTask(m2, groupId, { assigneeIds: [m1.id], requiresApproval: true });
    assert.equal((await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'done' })).status, 403);
    assert.equal((await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'review' })).status, 200);
    const done = (await m2.as('POST', `/api/tasks/${t.id}/status`, { status: 'done' })).data;
    assert.equal(done.status, 'done');
    assert.equal(done.progress, 100);
    assert.ok(done.completedAt);
  });

  test('claim: anyone picks up an unassigned task, once', async () => {
    const { m1, m2, groupId } = await crew();
    const t = await newTask(m2, groupId);
    assert.deepEqual((await m1.as('POST', `/api/tasks/${t.id}/claim`)).data.assigneeIds, [m1.id]);
    assert.equal((await m2.as('POST', `/api/tasks/${t.id}/claim`)).status, 409);
  });

  test('progress: workers only, clamped', async () => {
    const { m1, m2, admin, groupId } = await crew();
    const t = await newTask(admin, groupId, { assigneeIds: [m1.id] });
    assert.equal((await m1.as('POST', `/api/tasks/${t.id}/progress`, { progress: 40 })).data.progress, 40);
    assert.equal((await m1.as('POST', `/api/tasks/${t.id}/progress`, { progress: 400 })).status, 400);
    assert.equal((await m2.as('POST', `/api/tasks/${t.id}/progress`, { progress: 10 })).status, 403);
  });

  test('repeating task: completing spawns exactly one next occurrence', async () => {
    const { owner, m1, m2, groupId } = await crew();
    const due = new Date(Date.UTC(2026, 0, 31, 12)).toISOString();
    const t = await newTask(m2, groupId, { assigneeIds: [m1.id], recurrence: 'monthly', dueAt: due, checklist: ['Rent'] });
    await m1.as('POST', `/api/tasks/${t.id}/checklist/${(t.checklist as { id: string }[])[0]!.id}/toggle`);
    const done = (await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'done' })).data;
    assert.ok(done.nextTaskId);
    const next = (await owner.as('GET', `/api/tasks/${done.nextTaskId}`)).data;
    assert.equal(next.createdBy, m2.id); // original assigner keeps ownership
    assert.equal(new Date(next.dueAt).getUTCDate(), 28); // Jan 31 → Feb 28
    assert.deepEqual(next.assigneeIds, [m1.id]);
    assert.equal(next.checklist[0].done, false); // checklist reset
    assert.equal(next.status, 'todo');
    // reopen + complete again: no second copy
    await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'in_progress' });
    const again = (await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'done' })).data;
    assert.equal(again.nextTaskId, done.nextTaskId);
    const { rows } = await s.pool.query('select count(*)::int as n from tasks where recurred_from = $1', [t.id]);
    assert.equal(rows[0].n, 1);
  });

  test('activity log records changes in order', async () => {
    const { m1, m2, groupId } = await crew();
    const t = await newTask(m2, groupId, { assigneeIds: [m1.id] });
    await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'in_progress' });
    const log = (await m2.as('GET', `/api/tasks/${t.id}/activity`)).data;
    assert.equal(log[0].type, 'status');
    assert.equal(log[0].actorName, 'Chetan');
    assert.match(log[1].message, /assigned Chetan/);
  });
});

describe('notifications', () => {
  test('assignment, status and @mentions land in the inbox and push', async () => {
    const { m1, m2, owner, groupId } = await crew();
    await m1.as('POST', '/api/devices', { token: 'ExponentPushToken[m1]' });
    await m2.as('POST', '/api/devices', { token: 'ExponentPushToken[m2]' });
    s.pushes.length = 0;

    const t = await newTask(m2, groupId, { assigneeIds: [m1.id] });
    assert.ok(s.pushes.some((p) => p.to === 'ExponentPushToken[m1]' && /New task from Divya/.test(p.title)));

    await m1.as('POST', `/api/tasks/${t.id}/status`, { status: 'review' });
    assert.ok(s.pushes.some((p) => p.to === 'ExponentPushToken[m2]' && /submitted a task for review/.test(p.title)));

    // mentions are computed on the server from names, not trusted from the client
    await owner.as('POST', `/api/tasks/${t.id}/comments`, { text: 'Thanks @chetan!', mentions: [m2.id] });
    const comments = (await m1.as('GET', `/api/tasks/${t.id}/comments`)).data;
    assert.deepEqual(comments[0].mentions, [m1.id]);

    const inbox = (await m1.as('GET', '/api/notifications')).data;
    assert.ok(inbox.unread >= 2);
    assert.ok(inbox.items.some((n: { title: string }) => /mentioned you/.test(n.title)));
    await m1.as('POST', '/api/notifications/read', {});
    assert.equal((await m1.as('GET', '/api/notifications')).data.unread, 0);
  });

  test('dead push tokens are removed', async () => {
    const { m1, m2, groupId } = await crew();
    await m1.as('POST', '/api/devices', { token: 'ExponentPushToken[gone]' });
    s.deadTokens.add('ExponentPushToken[gone]');
    await newTask(m2, groupId, { assigneeIds: [m1.id] });
    const { rows } = await s.pool.query('select 1 from devices where token = $1', ['ExponentPushToken[gone]']);
    assert.equal(rows.length, 0);
  });

  test('overdue scan notifies once and skips done tasks', async () => {
    const { m1, m2, groupId } = await crew();
    const late = await newTask(m2, groupId, { assigneeIds: [m1.id], dueAt: new Date(Date.now() + 60_000).toISOString() });
    const doneLate = await newTask(m2, groupId, { assigneeIds: [m1.id], dueAt: new Date(Date.now() + 60_000).toISOString() });
    await m1.as('POST', `/api/tasks/${doneLate.id}/status`, { status: 'done' });
    await s.pool.query(`update tasks set due_at = now() - interval '1 hour' where id = any($1::uuid[])`, [[late.id, doneLate.id]]);

    const before = (await m2.as('GET', '/api/notifications')).data.items.length;
    await runOverdueScan(s.deps);
    await runOverdueScan(s.deps); // second run is a no-op
    const items = (await m2.as('GET', '/api/notifications')).data.items as { title: string; taskId: string }[];
    const overdue = items.filter((n) => /^Overdue/.test(n.title));
    assert.equal(overdue.filter((n) => n.taskId === late.id).length, 1);
    assert.equal(overdue.filter((n) => n.taskId === doneLate.id).length, 0);
    assert.ok(items.length > before);
  });

  test('cron endpoint requires the secret', async () => {
    assert.equal((await s.request('GET', '/api/cron/overdue')).status, 401);
    const ok = await s.app.request('http://localhost:3000/api/cron/overdue', { headers: { authorization: 'Bearer cron-test' } });
    assert.equal(ok.status, 200);
  });
});

describe('attachments', () => {
  test('members upload photos/PDFs; type and permissions enforced', async () => {
    const { admin, m1, m2, stranger, groupId } = await crew();
    const t = await newTask(admin, groupId, { assigneeIds: [m1.id] });
    const file = (name: string, type: string) => {
      const f = new FormData();
      f.append('file', new File([new Uint8Array([1, 2, 3])], name, { type }));
      return f;
    };
    const up = await m1.upload(`/api/tasks/${t.id}/attachments`, file('receipt one.jpg', 'image/jpeg'));
    assert.equal(up.status, 201);
    const a = up.data.attachments[0];
    assert.equal(a.name, 'receipt_one.jpg');
    assert.equal(a.uploadedByName, 'Chetan');
    assert.equal((await m1.upload(`/api/tasks/${t.id}/attachments`, file('x.exe', 'application/x-msdownload'))).status, 415);
    assert.equal((await stranger.upload(`/api/tasks/${t.id}/attachments`, file('y.jpg', 'image/jpeg'))).status, 404);
    assert.equal((await m2.as('DELETE', `/api/tasks/${t.id}/attachments/${a.id}`)).status, 403);
    assert.equal((await admin.as('DELETE', `/api/tasks/${t.id}/attachments/${a.id}`)).data.attachments.length, 0);
  });
});
