import { expoClient } from '@better-auth/expo/client';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';

/** Public URL of the Crew Tasks API (the Vercel deployment of server/). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
export const isApiConfigured = /^https?:\/\/.+/.test(API_URL);

export const authClient = createAuthClient({
  baseURL: isApiConfigured ? API_URL : 'http://localhost:3000',
  plugins: [
    expoClient({
      scheme: 'crewtasks',
      storagePrefix: 'crewtasks',
      storage: SecureStore, // session cookie lives in the Android keystore-backed secure store
    }),
    emailOTPClient(),
  ],
});

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called when the server says the session is gone (expired / signed out elsewhere). */
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export async function api<T>(
  path: string,
  opts: { method?: string; json?: unknown; form?: FormData; timeoutMs?: number } = {},
): Promise<T> {
  const cookie = await authClient.getCookie();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // fetch sets the multipart boundary
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      // Cookies are sent manually above; 'include' would interfere (Better Auth Expo docs).
      credentials: 'omit',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === 'TimeoutError';
    throw new ApiError(0, timedOut ? 'The server took too long to respond.' : 'No internet connection.');
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ---------- React Query: auto-refresh while the app is open ----------

export const REFRESH_MS = 15_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchInterval: REFRESH_MS, // paused automatically while the app is in the background
      retry: (count, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && count < 2,
    },
    mutations: { retry: false },
  },
});

/** Refetch when the app returns to the foreground; pause polling in the background. */
export function wireAppLifecycle(): () => void {
  const appSub = AppState.addEventListener('change', (s) => {
    if (Platform.OS !== 'web') focusManager.setFocused(s === 'active');
  });
  const netSub = Network.addNetworkStateListener((state) => {
    onlineManager.setOnline(state.isConnected !== false);
  });
  return () => {
    appSub.remove();
    netSub.remove();
  };
}

/** After any change: show the server's version of the task immediately, then refresh what's on screen. */
export function afterMutation(task?: { id: string } | null) {
  if (task) queryClient.setQueryData(['task', task.id], task);
  return queryClient.invalidateQueries();
}
