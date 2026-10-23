import { Stack } from 'expo-router';
import React from 'react';
import { useTheme } from '../../theme';

export const unstable_settings = { initialRouteName: 'sign-in' };

export default function AuthLayout() {
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
    </Stack>
  );
}
