import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '../../theme';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function AppLayout() {
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="group/new" options={{ title: 'New group', presentation: 'modal' }} />
      <Stack.Screen name="group/join" options={{ title: 'Join a group', presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/index" options={{ title: 'Group' }} />
      <Stack.Screen name="group/[id]/settings" options={{ title: 'Group settings' }} />
      <Stack.Screen name="task/new" options={{ title: 'New task', presentation: 'modal' }} />
      <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
    </Stack>
  );
}
