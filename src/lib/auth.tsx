import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fbAuth, fbDb } from './firebase';
import { LIMITS, trimTo } from './logic';
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
  resetPassword(email: string): Promise<void>;
  updateName(name: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function toAppUser(u: User): AppUser {
  return {
    uid: u.uid,
    email: u.email ?? '',
    displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Friend'),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(fbAuth(), (u) => {
      setUser(u ? toAppUser(u) : null);
      setInitializing(false);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      async signIn(email, password) {
        await signInWithEmailAndPassword(fbAuth(), email.trim(), password);
      },
      async signUp(name, email, password) {
        const displayName = trimTo(name, LIMITS.displayName);
        if (!displayName) throw new Error('Please enter your name.');
        const cred = await createUserWithEmailAndPassword(fbAuth(), email.trim(), password);
        await updateProfile(cred.user, { displayName });
        await setDoc(doc(fbDb(), 'users', cred.user.uid), {
          displayName,
          email: cred.user.email ?? '',
          createdAt: serverTimestamp(),
        });
        setUser(toAppUser(cred.user));
      },
      async resetPassword(email) {
        await sendPasswordResetEmail(fbAuth(), email.trim());
      },
      async updateName(name) {
        const u = fbAuth().currentUser;
        const displayName = trimTo(name, LIMITS.displayName);
        if (!u || !displayName) return;
        await updateProfile(u, { displayName });
        await setDoc(doc(fbDb(), 'users', u.uid), { displayName }, { merge: true });
        // Update the name shown to friends in every group I'm in.
        const groups = await getDocs(query(collection(fbDb(), 'groups'), where('memberIds', 'array-contains', u.uid)));
        if (!groups.empty) {
          const batch = writeBatch(fbDb());
          groups.docs.forEach((g) =>
            batch.update(g.ref, { [`members.${u.uid}.name`]: displayName, updatedAt: serverTimestamp() }),
          );
          await batch.commit();
        }
        setUser(toAppUser(u));
      },
      async signOut() {
        // Best effort: stop pushes to this device and clear local reminders for this account.
        await unregisterThisDevice().catch(() => {});
        await cancelAllTaskReminders().catch(() => {});
        await fbSignOut(fbAuth());
      },
    }),
    [user, initializing],
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
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'No internet connection.';
    default:
      return (e as Error)?.message || 'Something went wrong.';
  }
}
