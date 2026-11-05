/**
 * Regression test for the "Unmatched Route crewtasks:///" screen on first launch:
 * the app opens at "/", which only exists inside the signed-in (app) group.
 * Mirrors the guard structure of src/app/_layout.tsx.
 */
import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import React from 'react';
import { Text } from 'react-native';

function routes(signedIn: boolean, withRedirects: boolean) {
  const Layout = () => (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn} redirectTo={withRedirects ? '/sign-in' : undefined}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo={withRedirects ? '/' : undefined}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
  return {
    _layout: Layout,
    '(app)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(app)/index': () => <Text>My tasks</Text>,
    '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(auth)/sign-in': () => <Text>Sign in</Text>,
    '(auth)/sign-up': () => <Text>Sign up</Text>,
  };
}

test('signed out at "/" lands on Sign in (with redirectTo)', async () => {
  const r = await renderRouter(routes(false, true), { initialUrl: '/' });
  expect(screen.getByText('Sign in')).toBeTruthy();
  expect(r.getPathname()).toBe('/sign-in');
});

test('signed in at "/sign-in" lands on My tasks (with redirectTo)', async () => {
  const r = await renderRouter(routes(true, true), { initialUrl: '/sign-in' });
  expect(screen.getByText('My tasks')).toBeTruthy();
  expect(r.getPathname()).toBe('/');
});

test('signed in at "/" shows My tasks', async () => {
  await renderRouter(routes(true, true), { initialUrl: '/' });
  expect(screen.getByText('My tasks')).toBeTruthy();
});

test('reproduces the bug without redirectTo (documents why it is needed)', async () => {
  await renderRouter(routes(false, false), { initialUrl: '/' });
  expect(screen.queryByText('Sign in')).toBeNull();
});
