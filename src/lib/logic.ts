/**
 * Pure business logic (no Firebase / React Native imports) so it can be unit-tested in Node.
 * Permission helpers mirror firestore.rules — the rules are the real enforcement;
 * these only decide what the UI offers.
 */
import type { Group, Recurrence, Role, Task, TaskStatus } from './types';

export const LIMITS = {
  groupName: 60,
  groupDescription: 300,
  taskTitle: 120,
  taskDescription: 2000,
  blockedReason: 300,
  checklistItem: 200,
  checklistItems: 50,
  comment: 1000,
  attachments: 10,
  attachmentBytes: 10 * 1024 * 1024,
  displayName: 50,
} as const;

export const INVITE_TTL_DAYS = 7;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateInviteCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)];
  return code;
}

export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidInviteCode(code: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

export function roleOf(group: Pick<Group, 'members'> | null | undefined, uid: string): Role | null {
  return group?.members?.[uid]?.role ?? null;
}

export function isAdmin(group: Pick<Group, 'members'> | null | undefined, uid: string): boolean {
  const r = roleOf(group, uid);
  return r === 'owner' || r === 'admin';
}

type TaskPerm = Pick<Task, 'createdBy' | 'assigneeIds' | 'requiresApproval'>;

/** Edit title/description/assignees/due/priority/recurrence/approval; delete. */
export function canEditDetails(task: TaskPerm, group: Pick<Group, 'members'> | null, uid: string) {
  return task.createdBy === uid || isAdmin(group, uid);
}

/** Change status / progress. */
export function canWorkOn(task: TaskPerm, group: Pick<Group, 'members'> | null, uid: string) {
  return task.assigneeIds.includes(uid) || canEditDetails(task, group, uid);
}

/**
 * Which statuses this user may move the task to. When approval is required,
 * only the creator/admins can mark it Done; assignees submit it for review.
 */
export function allowedStatuses(task: TaskPerm, group: Pick<Group, 'members'> | null, uid: string): TaskStatus[] {
  if (!canWorkOn(task, group, uid)) return [];
  const all: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'review', 'done'];
  if (task.requiresApproval && !canEditDetails(task, group, uid)) return all.filter((s) => s !== 'done');
  return all;
}

export function progressForStatus(status: TaskStatus, current: number): number {
  if (status === 'done') return 100;
  if (status === 'todo' && current === 100) return 0;
  return current;
}

export function clampProgress(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Next due date for a recurring task. Monthly keeps the day-of-month, clamped to month end. */
export function nextDueDate(from: Date, recurrence: Recurrence): Date | null {
  const d = new Date(from.getTime());
  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      return d;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      return d;
    case 'monthly': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, lastDay));
      return d;
    }
    default:
      return null;
  }
}

export function isOpen(status: TaskStatus): boolean {
  return status !== 'done';
}

export function isOverdue(dueMs: number | null, status: TaskStatus, nowMs = Date.now()): boolean {
  return dueMs != null && isOpen(status) && dueMs < nowMs;
}

export function isDueToday(dueMs: number | null, nowMs = Date.now()): boolean {
  if (dueMs == null) return false;
  const a = new Date(dueMs);
  const b = new Date(nowMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export interface SortableTask {
  status: TaskStatus;
  priority: keyof typeof PRIORITY_RANK;
  dueMs: number | null;
  createdMs: number;
}

/** Open before done; overdue first; then by due date (no date last); then priority; then newest. */
export function compareTasks(a: SortableTask, b: SortableTask, nowMs = Date.now()): number {
  const openA = isOpen(a.status) ? 0 : 1;
  const openB = isOpen(b.status) ? 0 : 1;
  if (openA !== openB) return openA - openB;
  const odA = isOverdue(a.dueMs, a.status, nowMs) ? 0 : 1;
  const odB = isOverdue(b.dueMs, b.status, nowMs) ? 0 : 1;
  if (odA !== odB) return odA - odB;
  if (a.dueMs !== b.dueMs) {
    if (a.dueMs == null) return 1;
    if (b.dueMs == null) return -1;
    return a.dueMs - b.dueMs;
  }
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (p !== 0) return p;
  return b.createdMs - a.createdMs;
}

export function checklistProgress(items: { done: boolean }[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** Extract @mentions by matching member display names (case-insensitive, longest first). */
export function extractMentions(text: string, members: Record<string, { name: string }>): string[] {
  let rest = text.toLowerCase();
  const found = new Set<string>();
  const entries = Object.entries(members).sort((a, b) => b[1].name.length - a[1].name.length);
  for (const [uid, m] of entries) {
    const tag = '@' + m.name.trim().toLowerCase();
    if (tag.length > 1 && rest.includes(tag)) {
      found.add(uid);
      rest = rest.split(tag).join(' '); // consume so "@ravi kumar" doesn't also match "@ravi"
    }
  }
  return [...found];
}

export function formatDue(dueMs: number, nowMs = Date.now()): string {
  const d = new Date(dueMs);
  const now = new Date(nowMs);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date}, ${time}`;
}

export function trimTo(s: string, max: number): string {
  return s.trim().slice(0, max);
}
