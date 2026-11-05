/** API data shapes shared by the server and the app. Timestamps are ISO-8601 strings. */
export type ISODate = string;

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
  /** Any member may share the invite; only admins can reset it. */
  inviteCode: string;
  inviteExpiresAt: ISODate;
  createdAt: ISODate | null;
  updatedAt: ISODate | null;
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
  doneAt: ISODate | null;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  contentType: string;
  uploadedBy: string | null;
  uploadedByName: string;
  uploadedAt: ISODate;
  sizeBytes: number;
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
  dueAt: ISODate | null;
  recurrence: Recurrence;
  checklist: ChecklistItem[];
  attachments: Attachment[];
  nextTaskId: string | null;
  recurredFrom: string | null;
  updatedBy: string | null;
  createdAt: ISODate | null;
  updatedAt: ISODate | null;
  completedAt: ISODate | null;
}

export interface Comment {
  id: string;
  authorId: string | null;
  authorName: string;
  text: string;
  mentions: string[];
  createdAt: ISODate | null;
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
  actorId: string | null;
  actorName: string;
  type: ActivityType;
  message: string;
  createdAt: ISODate | null;
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

export interface AppNotification {
  id: string;
  taskId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: ISODate;
}

export interface Me {
  id: string;
  name: string;
  email: string;
}
