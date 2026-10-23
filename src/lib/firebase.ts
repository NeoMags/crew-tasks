import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Web-app config from Firebase console → Project settings → Your apps → Web app.
// These values identify the project; they are not secrets. Access is enforced by
// firestore.rules / storage.rules.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const missingFirebaseConfig: string[] = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

export const isFirebaseConfigured = missingFirebaseConfig.length === 0;

// getReactNativePersistence only exists in the React Native build of @firebase/auth (which Metro
// resolves via the "react-native" export condition); the public typings omit it.
const getReactNativePersistence = (
  FirebaseAuth as unknown as { getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence }
).getReactNativePersistence;

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

function init() {
  if (app) return;
  if (!isFirebaseConfigured) {
    throw new Error(`Firebase is not configured. Missing: ${missingFirebaseConfig.join(', ')}`);
  }
  const fresh = getApps().length === 0;
  app = fresh ? initializeApp(firebaseConfig) : getApp();
  if (fresh) {
    // Persist the session so users stay signed in across app restarts.
    auth = getReactNativePersistence
      ? initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
      : initializeAuth(app);
    if (!getReactNativePersistence) console.warn('Auth persistence unavailable: users will be signed out on restart.');
    db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  } else {
    // Fast refresh: reuse already-initialized instances.
    auth = getAuth(app);
    db = getFirestore(app);
  }
  storage = getStorage(app);
}

export function fbAuth(): Auth {
  init();
  return auth!;
}

export function fbDb(): Firestore {
  init();
  return db!;
}

export function fbStorage(): FirebaseStorage {
  init();
  return storage!;
}
