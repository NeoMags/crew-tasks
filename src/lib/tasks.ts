import { LIMITS, trimTo } from '@shared/logic';
import type { Activity, AppNotification, Attachment, Comment, Group, Priority, Recurrence, Task, TaskStatus } from '@shared/types';
import type { AppUser } from './auth';
import { afterMutation, api } from './api';

// ---------- reads ----------

export const fetchAssignedTasks = () => api<Task[]>('/api/tasks?scope=assigned');
export const fetchCreatedTasks = () => api<Task[]>('/api/tasks?scope=created');
export const fetchGroupTasks = (groupId: string) => api<Task[]>(`/api/groups/${groupId}/tasks`);
export const fetchTask = (id: string) => api<Task>(`/api/tasks/${id}`);
export const fetchComments = (id: string) => api<Comment[]>(`/api/tasks/${id}/comments`);
export const fetchActivity = (id: string) => api<Activity[]>(`/api/tasks/${id}/activity`);
export const fetchNotifications = () => api<{ items: AppNotification[]; unread: number }>('/api/notifications');

// ---------- create / edit ----------

export interface TaskInput {
  title: string;
  description: string;
  assigneeIds: string[];
  priority: Priority;
  dueAt: Date | null;
  recurrence: Recurrence;
  requiresApproval: boolean;
  checklist: string[]; // only used on create
}

function payload(input: TaskInput) {
  const title = trimTo(input.title, LIMITS.taskTitle);
  if (!title) throw new Error('Title is required.');
  if (input.recurrence !== 'none' && !input.dueAt) throw new Error('Recurring tasks need a due date.');
  return {
    title,
    description: trimTo(input.description, LIMITS.taskDescription),
    assigneeIds: [...new Set(input.assigneeIds)],
    priority: input.priority,
    dueAt: input.dueAt ? input.dueAt.toISOString() : null,
    recurrence: input.recurrence,
    requiresApproval: input.requiresApproval,
  };
}

export async function createTask(_user: AppUser, group: Group, input: TaskInput): Promise<string> {
  const task = await api<Task>('/api/tasks', {
    json: {
      ...payload(input),
      groupId: group.id,
      checklist: input.checklist.map((t) => trimTo(t, LIMITS.checklistItem)).filter(Boolean).slice(0, LIMITS.checklistItems),
    },
  });
  await afterMutation(task);
  return task.id;
}

export async function updateTaskDetails(_user: AppUser, _group: Group, task: Task, input: TaskInput) {
  await afterMutation(await api<Task>(`/api/tasks/${task.id}`, { method: 'PATCH', json: payload(input) }));
}

export async function deleteTask(taskId: string) {
  await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
  await afterMutation();
}

// ---------- work ----------

export async function setStatus(_user: AppUser, taskId: string, status: TaskStatus, blockedReason = '') {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/status`, { json: { status, blockedReason } }));
}

export async function claimTask(_user: AppUser, taskId: string) {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/claim`, { method: 'POST' }));
}

export async function setProgress(_user: AppUser, taskId: string, value: number) {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/progress`, { json: { progress: Math.round(value) } }));
}

// ---------- "What's needed" checklist ----------

export async function toggleChecklistItem(_user: AppUser, taskId: string, itemId: string) {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/checklist/${itemId}/toggle`, { method: 'POST' }));
}

export async function addChecklistItem(_user: AppUser, taskId: string, text: string) {
  const clean = trimTo(text, LIMITS.checklistItem);
  if (!clean) return;
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/checklist`, { json: { text: clean } }));
}

export async function removeChecklistItem(_user: AppUser, taskId: string, itemId: string) {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' }));
}

// ---------- comments ----------

export async function addComment(_user: AppUser, _group: Group, taskId: string, text: string) {
  const clean = trimTo(text, LIMITS.comment);
  if (!clean) return;
  await api(`/api/tasks/${taskId}/comments`, { json: { text: clean } }); // server works out @mentions
  await afterMutation();
}

// ---------- attachments (proof of work) ----------

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function uploadAttachment(
  _user: AppUser,
  task: Task,
  file: { uri: string; name: string; mimeType: string; size?: number },
) {
  if (task.attachments.length >= LIMITS.attachments) throw new Error(`Max ${LIMITS.attachments} attachments per task.`);
  if (file.size && file.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 4 MB.');
  const form = new FormData();
  // React Native's FormData accepts a { uri, name, type } descriptor for files.
  form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  await afterMutation(await api<Task>(`/api/tasks/${task.id}/attachments`, { form, timeoutMs: 60_000 }));
}

export async function removeAttachment(_user: AppUser, taskId: string, attachment: Attachment) {
  await afterMutation(await api<Task>(`/api/tasks/${taskId}/attachments/${attachment.id}`, { method: 'DELETE' }));
}

// ---------- inbox ----------

export async function markNotificationsRead(ids?: string[]) {
  await api('/api/notifications/read', { json: ids ? { ids } : {} });
  await afterMutation();
}

// ---------- helpers ----------

export function dueMs(t: Pick<Task, 'dueAt'>): number | null {
  return t.dueAt ? Date.parse(t.dueAt) : null;
}

export function createdMs(t: Pick<Task, 'createdAt'>): number {
  return t.createdAt ? Date.parse(t.createdAt) : Date.now();
}
