/**
 * Local (on-device) reminders. These work without any server and without the
 * Firebase Blaze plan. Server pushes (Cloud Functions) cover assignment, status,
 * comment and overdue events, so the two don't duplicate each other.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { CHANNELS } from './push';
import type { TaskStatus } from './types';

const STORE_KEY = 'crewtasks.reminders.v1';
const SETTINGS_KEY = 'crewtasks.autoReminders';
export const AUTO_LEAD_MINUTES = 60;

interface CustomReminder {
  id: string; // notification identifier
  atMs: number;
}

interface TaskReminders {
  auto?: { dueMs: number; ids: string[] };
  custom?: CustomReminder[];
}

type Store = Record<string, TaskReminders>;

export interface ReminderTask {
  id: string;
  title: string;
  groupName: string;
  dueMs: number | null;
  status: TaskStatus;
}

// Serialize all store mutations so concurrent syncs can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function load(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

async function save(store: Store) {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

async function cancelIds(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

async function scheduleAt(atMs: number, title: string, body: string, taskId: string): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, data: { url: `/task/${taskId}` } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: atMs, channelId: CHANNELS.reminders },
  });
}

export async function getAutoRemindersEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(SETTINGS_KEY)) !== 'off';
}

export async function setAutoRemindersEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, enabled ? 'on' : 'off');
}

/**
 * Reconcile automatic due-date reminders with the full list of open tasks
 * assigned to the current user. Idempotent: running it twice schedules nothing new.
 */
export function syncAutoReminders(tasks: ReminderTask[], nowMs = Date.now()): Promise<void> {
  return serialized(async () => {
    const enabled = await getAutoRemindersEnabled();
    const store = await load();
    const wanted = new Map(
      enabled ? tasks.filter((t) => t.status !== 'done' && t.dueMs != null && t.dueMs > nowMs).map((t) => [t.id, t]) : [],
    );

    // Cancel reminders for tasks that are done, removed, unassigned or past due.
    for (const [taskId, entry] of Object.entries(store)) {
      if (entry.auto && (!wanted.has(taskId) || wanted.get(taskId)!.dueMs !== entry.auto.dueMs)) {
        await cancelIds(entry.auto.ids);
        delete entry.auto;
      }
      if (entry.custom) entry.custom = entry.custom.filter((c) => c.atMs > nowMs);
      if (!entry.auto && !entry.custom?.length) delete store[taskId];
    }

    for (const t of wanted.values()) {
      if (store[t.id]?.auto) continue; // already scheduled for this exact due time
      const ids: string[] = [];
      const lead = t.dueMs! - AUTO_LEAD_MINUTES * 60_000;
      if (lead > nowMs) ids.push(await scheduleAt(lead, `Due in 1 hour: ${t.title}`, t.groupName, t.id));
      ids.push(await scheduleAt(t.dueMs!, `Due now: ${t.title}`, t.groupName, t.id));
      store[t.id] = { ...store[t.id], auto: { dueMs: t.dueMs!, ids } };
    }
    await save(store);
  });
}

export function addCustomReminder(task: Pick<ReminderTask, 'id' | 'title' | 'groupName'>, at: Date): Promise<void> {
  return serialized(async () => {
    if (at.getTime() <= Date.now()) throw new Error('Pick a time in the future.');
    const id = await scheduleAt(at.getTime(), `Reminder: ${task.title}`, task.groupName, task.id);
    const store = await load();
    const entry = store[task.id] ?? {};
    entry.custom = [...(entry.custom ?? []), { id, atMs: at.getTime() }];
    store[task.id] = entry;
    await save(store);
  });
}

export async function listCustomReminders(taskId: string): Promise<CustomReminder[]> {
  const store = await load();
  return (store[taskId]?.custom ?? []).filter((c) => c.atMs > Date.now()).sort((a, b) => a.atMs - b.atMs);
}

export function cancelCustomReminder(taskId: string, id: string): Promise<void> {
  return serialized(async () => {
    await cancelIds([id]);
    const store = await load();
    const entry = store[taskId];
    if (entry?.custom) {
      entry.custom = entry.custom.filter((c) => c.id !== id);
      if (!entry.auto && !entry.custom.length) delete store[taskId];
      await save(store);
    }
  });
}

export function cancelAllTaskReminders(): Promise<void> {
  return serialized(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(STORE_KEY);
  });
}
