import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { QueryClientProvider } from '@tanstack/react-query';
import { isApiConfigured, queryClient, wireAppLifecycle } from '../lib/api';
import { ensureChannels, registerForPush, watchPushToken } from '../lib/push';
import { useTheme } from '../theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Tapping a notification opens the task it is about (payload: { url: '/task/<id>' }). */
function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const open = (n: Notifications.Notification) => {
      const url = n.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        router.push(url as never);
        Notifications.clearLastNotificationResponse();
      }
    };
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) open(last.notification);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification));
    return () => sub.remove();
  }, [enabled]);
}

function RootNavigator() {
  const { user, initializing } = useAuth();
  const c = useTheme();
  const signedIn = !!user;

  useNotificationRouting(signedIn);

  useEffect(() => {
    ensureChannels().catch(() => {});
    return wireAppLifecycle();
  }, []);

  useEffect(() => {
    if (!user) return;
    registerForPush().catch(() => {});
    return watchPushToken();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (initializing) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function MissingConfig() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '700' }}>Server address missing</Text>
      <Text>
        This build doesn’t know where the Crew Tasks API is. Set EXPO_PUBLIC_API_URL (your Vercel deployment URL, see
        README) and rebuild.
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {isApiConfigured ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <MissingConfig />
      )}
    </SafeAreaProvider>
  );
}
