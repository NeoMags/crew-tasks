import type { Timestamp } from 'firebase/firestore';

export type Role = 'owner' | 'admin' | 'member';

export interface MemberInfo {
  name: string;
  role: Role;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberIds: string[];
  members: Record<string, MemberInfo>;
  inviteCode: string;
  inviteExpiresAt: Timestamp;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/** One item that has to be furnished / completed for the task. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneBy: string | null;
  doneByName: string | null;
  doneAt: number | null; // epoch ms (serverTimestamp is not allowed inside arrays)
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  path: string;
  contentType: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: number;
}

export interface Task {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  description: string;
  assigneeIds: string[];
  createdBy: string;
  createdByName: string;
  status: TaskStatus;
  blockedReason: string;
  requiresApproval: boolean;
  priority: Priority;
  progress: number; // 0..100
  dueAt: Timestamp | null;
  recurrence: Recurrence;
  checklist: ChecklistItem[];
  attachments: Attachment[];
  nextTaskId: string | null;
  recurredFrom: string | null;
  overdueNotified: boolean;
  updatedBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  completedAt: Timestamp | null;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  mentions: string[];
  createdAt: Timestamp | null;
}

export type ActivityType =
  | 'created'
  | 'status'
  | 'progress'
  | 'assigned'
  | 'edited'
  | 'checklist'
  | 'attachment'
  | 'recurred';

export interface Activity {
  id: string;
  actorId: string;
  actorName: string;
  type: ActivityType;
  message: string;
  createdAt: Timestamp | null;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'In review',
  done: 'Done',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};
