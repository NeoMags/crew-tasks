/**
 * Server push via Expo's push service. On Android, Expo delivers through Google FCM,
 * so a build needs google-services.json and an EAS project id for push to work.
 * Without them, everything else (in-app inbox, local reminders) still works.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

const TOKEN_KEY = 'crewtasks.expoPushToken';

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

export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'permission-denied' | 'not-a-device' | 'not-configured' | 'token-error'; detail?: string };

export async function requestNotificationPermission(): Promise<boolean> {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Asks for permission (needed for local reminders too) and registers for server push if configured. */
export async function registerForPush(): Promise<PushSetupResult> {
  const granted = await requestNotificationPermission();
  if (!granted) return { ok: false, reason: 'permission-denied' };
  if (!Device.isDevice) return { ok: false, reason: 'not-a-device' };
  const projectId = easProjectId();
  if (!projectId) return { ok: false, reason: 'not-configured' };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('/api/devices', { json: { token, platform: Platform.OS } });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'token-error', detail: (e as Error)?.message };
  }
}

/** Re-registers if FCM rotates the device token. Returns an unsubscribe function. */
export function watchPushToken(): () => void {
  const sub = Notifications.addPushTokenListener(() => {
    registerForPush().catch(() => {});
  });
  return () => sub.remove();
}

export async function unregisterThisDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await api('/api/devices', { method: 'DELETE', json: { token } });
  await AsyncStorage.removeItem(TOKEN_KEY);
}
