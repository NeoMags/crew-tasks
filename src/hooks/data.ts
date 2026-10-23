import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { subscribeGroup, subscribeMyGroups } from '../lib/groups';
import type { Activity, Comment, Group, Task } from '../lib/types';
import {
  subscribeActivity,
  subscribeAssignedTasks,
  subscribeComments,
  subscribeCreatedTasks,
  subscribeGroupTasks,
  subscribeTask,
} from '../lib/tasks';

type Subscribe<T> = (onData: (d: T) => void, onError: (e: Error) => void) => () => void;

export interface Live<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

export function friendlyError(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === 'permission-denied') return "You don't have access to this (you may have been removed from the group).";
  if (code === 'unavailable') return 'You appear to be offline. Changes will sync when you reconnect.';
  if (code === 'failed-precondition') return 'The database needs an index for this view. See README → Deploy.';
  return (e as Error)?.message || 'Something went wrong.';
}

/** Realtime Firestore subscription with loading/error/retry state. Pass key=null to skip. */
export function useLive<T>(key: string | null, subscribe: Subscribe<T>): Live<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key == null) return;
    setError(null);
    setData(undefined);
    const unsub = subscribe(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(friendlyError(e)),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { data, error, loading: key != null && data === undefined && !error, retry };
}

export const useMyGroups = (uid: string) => useLive<Group[]>(`groups:${uid}`, (d, e) => subscribeMyGroups(uid, d, e));
export const useGroup = (id: string | undefined) => useLive<Group | null>(id ? `group:${id}` : null, (d, e) => subscribeGroup(id!, d, e));
export const useGroupTasks = (id: string | undefined) =>
  useLive<Task[]>(id ? `gtasks:${id}` : null, (d, e) => subscribeGroupTasks(id!, d, e));
export const useAssignedTasks = (uid: string) => useLive<Task[]>(`assigned:${uid}`, (d, e) => subscribeAssignedTasks(uid, d, e));
export const useCreatedTasks = (uid: string) => useLive<Task[]>(`created:${uid}`, (d, e) => subscribeCreatedTasks(uid, d, e));
export const useTask = (id: string | undefined) => useLive<Task | null>(id ? `task:${id}` : null, (d, e) => subscribeTask(id!, d, e));
export const useComments = (id: string | undefined) =>
  useLive<Comment[]>(id ? `comments:${id}` : null, (d, e) => subscribeComments(id!, d, e));
export const useActivity = (id: string | undefined) =>
  useLive<Activity[]>(id ? `activity:${id}` : null, (d, e) => subscribeActivity(id!, d, e));

/** Wraps an async action with a busy flag and an error alert. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (label: string, fn: () => Promise<unknown>, onDone?: () => void) => {
    setBusy(label);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      Alert.alert('Could not complete', friendlyError(e));
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}
