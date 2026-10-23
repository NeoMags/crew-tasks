import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedStatuses,
  canEditDetails,
  canWorkOn,
  clampProgress,
  compareTasks,
  extractMentions,
  generateInviteCode,
  isOverdue,
  isValidInviteCode,
  nextDueDate,
  normalizeInviteCode,
  progressForStatus,
  type SortableTask,
} from '../../src/lib/logic.ts';

const group = {
  members: {
    owner: { name: 'Asha', role: 'owner' as const },
    admin: { name: 'Ravi Kumar', role: 'admin' as const },
    m1: { name: 'Ravi', role: 'member' as const },
    m2: { name: 'Meena', role: 'member' as const },
  },
};

test('invite codes are 6 unambiguous chars and normalize user input', () => {
  for (let i = 0; i < 500; i++) assert.ok(isValidInviteCode(generateInviteCode()));
  assert.equal(normalizeInviteCode(' ab3-k7q9 '), 'AB3K7Q9');
  assert.equal(isValidInviteCode('AB3K7Q'), true);
  assert.equal(isValidInviteCode('AB0K7Q'), false); // 0 excluded
  assert.equal(isValidInviteCode('AB3K7'), false);
});

test('permissions: creator/admin edit, assignee works, others neither', () => {
  const task = { createdBy: 'm2', assigneeIds: ['m1'], requiresApproval: false };
  assert.equal(canEditDetails(task, group, 'm2'), true);
  assert.equal(canEditDetails(task, group, 'admin'), true);
  assert.equal(canEditDetails(task, group, 'owner'), true);
  assert.equal(canEditDetails(task, group, 'm1'), false);
  assert.equal(canWorkOn(task, group, 'm1'), true);
  assert.deepEqual(allowedStatuses(task, group, 'outsider'), []);
});

test('approval: assignee cannot mark Done, creator can', () => {
  const task = { createdBy: 'm2', assigneeIds: ['m1'], requiresApproval: true };
  assert.ok(!allowedStatuses(task, group, 'm1').includes('done'));
  assert.ok(allowedStatuses(task, group, 'm1').includes('review'));
  assert.ok(allowedStatuses(task, group, 'm2').includes('done'));
});

test('progress follows status and clamps', () => {
  assert.equal(progressForStatus('done', 40), 100);
  assert.equal(progressForStatus('todo', 100), 0);
  assert.equal(progressForStatus('in_progress', 40), 40);
  assert.equal(clampProgress(140), 100);
  assert.equal(clampProgress(-3), 0);
  assert.equal(clampProgress(Number.NaN), 0);
});

test('recurrence: daily, weekly, monthly clamps to month end', () => {
  const d = new Date(2026, 0, 31, 9, 30); // 31 Jan 2026
  assert.equal(nextDueDate(d, 'daily')!.getDate(), 1);
  assert.equal(nextDueDate(d, 'weekly')!.getDate(), 7);
  const m = nextDueDate(d, 'monthly')!;
  assert.equal(m.getMonth(), 1);
  assert.equal(m.getDate(), 28); // Feb 2026 has 28 days
  assert.equal(m.getHours(), 9);
  assert.equal(nextDueDate(new Date(2026, 11, 15), 'monthly')!.getFullYear(), 2027);
  assert.equal(nextDueDate(d, 'none'), null);
});

test('overdue only for open tasks with a past due date', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  assert.equal(isOverdue(now - 1, 'todo', now), true);
  assert.equal(isOverdue(now - 1, 'done', now), false);
  assert.equal(isOverdue(null, 'todo', now), false);
  assert.equal(isOverdue(now + 1, 'blocked', now), false);
});

test('sorting: open first, overdue first, then due date, then priority', () => {
  const now = 1_000_000;
  const t = (o: Partial<SortableTask> & { k: string }) =>
    ({ status: 'todo', priority: 'medium', dueMs: null, createdMs: 0, ...o }) as SortableTask & { k: string };
  const list = [
    t({ k: 'done', status: 'done', dueMs: now - 10 }),
    t({ k: 'noDue' }),
    t({ k: 'later', dueMs: now + 500 }),
    t({ k: 'overdue', dueMs: now - 5 }),
    t({ k: 'soonUrgent', dueMs: now + 100, priority: 'urgent' }),
    t({ k: 'soonLow', dueMs: now + 100, priority: 'low' }),
  ];
  list.sort((a, b) => compareTasks(a, b, now));
  assert.deepEqual(
    list.map((x) => x.k),
    ['overdue', 'soonUrgent', 'soonLow', 'later', 'noDue', 'done'],
  );
});

test('mentions match longest member name first and ignore case', () => {
  assert.deepEqual(extractMentions('thanks @ravi kumar!', group.members), ['admin']);
  assert.deepEqual(extractMentions('@Ravi and @ravi kumar', group.members).sort(), ['admin', 'm1']);
  assert.deepEqual(extractMentions('@Meena please check', group.members), ['m2']);
  assert.deepEqual(extractMentions('no mentions here', group.members), []);
});
