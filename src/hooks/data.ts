import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { ApiError } from '../lib/api';
import { fetchGroup, fetchMyGroups } from '../lib/groups';
import {
  fetchActivity,
  fetchAssignedTasks,
  fetchComments,
  fetchCreatedTasks,
  fetchGroupTasks,
  fetchNotifications,
  fetchTask,
} from '../lib/tasks';

export interface Live<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  retry: () => void;
}

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return `${e.message} Changes will need to be retried when you're back online.`;
    if (e.status === 401) return 'Please sign in again.';
    return e.message;
  }
  return (e as Error)?.message || 'Something went wrong.';
}

/**
 * Server data that refreshes itself every few seconds while the app is open
 * (and immediately after any change you make). Pass key=null to skip.
 */
function useLive<T>(key: readonly unknown[] | null, fn: () => Promise<T>): Live<T> {
  const q = useQuery({ queryKey: key ?? ['disabled'], queryFn: fn, enabled: key != null });
  const retry = useCallback(() => void q.refetch(), [q]);
  return {
    data: q.data,
    // Keep showing cached data during a transient refresh error.
    error: q.error && q.data === undefined ? friendlyError(q.error) : null,
    loading: key != null && q.isPending && !q.error,
    retry,
  };
}

/** A 404 means "gone or not yours" — treat it as null rather than an error. */
const orNull = <T,>(p: Promise<T>) =>
  p.catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

export const useMyGroups = (_uid: string) => useLive(['groups'], fetchMyGroups);
export const useGroup = (id: string | undefined) => useLive(id ? ['group', id] : null, () => orNull(fetchGroup(id!)));
export const useGroupTasks = (id: string | undefined) => useLive(id ? ['groupTasks', id] : null, () => fetchGroupTasks(id!));
export const useAssignedTasks = (_uid: string) => useLive(['tasks', 'assigned'], fetchAssignedTasks);
export const useCreatedTasks = (_uid: string) => useLive(['tasks', 'created'], fetchCreatedTasks);
export const useTask = (id: string | undefined) => useLive(id ? ['task', id] : null, () => orNull(fetchTask(id!)));
export const useComments = (id: string | undefined) => useLive(id ? ['comments', id] : null, () => fetchComments(id!));
export const useActivity = (id: string | undefined) => useLive(id ? ['activity', id] : null, () => fetchActivity(id!));
export const useNotifications = () => useLive(['notifications'], fetchNotifications);

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
