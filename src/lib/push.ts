import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { fbAuth, fbDb } from './firebase';

const DEVICE_ID_KEY = 'crewtasks.deviceId';

export const CHANNELS = {
  default: 'default',
  reminders: 'reminders',
} as const;

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNELS.default, {
    name: 'Task updates',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.reminders, {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function deviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'permission-denied' | 'not-a-device' | 'token-error'; detail?: string };

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

async function saveToken(token: string) {
  const uid = fbAuth().currentUser?.uid;
  if (!uid) return;
  await setDoc(doc(fbDb(), 'users', uid, 'devices', await deviceId()), {
    token,
    platform: Platform.OS,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Registers this device's FCM token so Cloud Functions can push task updates.
 * Requires google-services.json in the build; without it, local reminders still work.
 */
export async function registerForPush(): Promise<PushSetupResult> {
  if (!Device.isDevice) return { ok: false, reason: 'not-a-device' };
  const granted = await requestNotificationPermission();
  if (!granted) return { ok: false, reason: 'permission-denied' };
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    await saveToken(String(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'token-error', detail: (e as Error)?.message };
  }
}

/** Keeps the stored token fresh if FCM rotates it. Returns an unsubscribe function. */
export function watchPushToken(): () => void {
  const sub = Notifications.addPushTokenListener(({ data }) => {
    saveToken(String(data)).catch(() => {});
  });
  return () => sub.remove();
}

export async function unregisterThisDevice(): Promise<void> {
  const uid = fbAuth().currentUser?.uid;
  if (!uid) return;
  await deleteDoc(doc(fbDb(), 'users', uid, 'devices', await deviceId()));
}
