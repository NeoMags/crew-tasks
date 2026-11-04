import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { LIMITS, trimTo } from '@shared/logic';
import { afterMutation, api, authClient, onUnauthorized, queryClient } from './api';
import { unregisterThisDevice } from './push';
import { cancelAllTaskReminders } from './reminders';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
}

interface AuthState {
  user: AppUser | null;
  initializing: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  updateName(name: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function check(result: { error?: { code?: string; message?: string; status?: number } | null }) {
  if (result.error) {
    throw new AuthError(result.error.code ?? String(result.error.status ?? ''), result.error.message ?? 'Something went wrong.');
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const u = session.data?.user;
  const user = useMemo<AppUser | null>(
    () => (u ? { uid: u.id, email: u.email, displayName: u.name || u.email.split('@')[0] || 'Friend' } : null),
    [u?.id, u?.email, u?.name], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // If the API rejects the session (expired / revoked), re-check so the app returns to sign-in.
  useEffect(() => {
    const off = onUnauthorized(() => void session.refetch());
    return () => void off();
  }, [session]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing: session.isPending,
      async signIn(email, password) {
        check(await authClient.signIn.email({ email: email.trim(), password }));
      },
      async signUp(name, email, password) {
        const clean = trimTo(name, LIMITS.displayName);
        if (!clean) throw new Error('Please enter your name.');
        check(await authClient.signUp.email({ name: clean, email: email.trim(), password }));
      },
      async updateName(name) {
        const clean = trimTo(name, LIMITS.displayName);
        if (!clean) return;
        await api('/api/me', { method: 'PATCH', json: { name: clean } });
        await session.refetch();
        await afterMutation();
      },
      async signOut() {
        // Best effort: stop pushes to this phone and clear its reminders for this account.
        await unregisterThisDevice().catch(() => {});
        await cancelAllTaskReminders().catch(() => {});
        await authClient.signOut().catch(() => {});
        queryClient.clear();
        await session.refetch();
      },
    }),
    [user, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens inside the signed-in area. */
export function useUser(): AppUser {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'INVALID_EMAIL':
      return 'That email address looks invalid.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return 'Email or password is incorrect.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account already exists with this email.';
    case 'PASSWORD_TOO_SHORT':
      return 'Password must be at least 6 characters.';
    case '429':
      return 'Too many attempts. Please wait a minute and try again.';
    default:
      return (e as Error)?.message || 'Something went wrong.';
  }
}
