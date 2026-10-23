import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, Switch, Text, View } from 'react-native';
import { Avatar, Body, Button, Card, Muted, Screen, SectionTitle, TextField } from '../../../components/ui';
import { useAction } from '../../../hooks/data';
import { useAuth, useUser } from '../../../lib/auth';
import { LIMITS } from '../../../lib/logic';
import { registerForPush } from '../../../lib/push';
import { getAutoRemindersEnabled, setAutoRemindersEnabled } from '../../../lib/reminders';
import { space, useTheme } from '../../../theme';

export default function Profile() {
  const c = useTheme();
  const user = useUser();
  const { signOut, updateName } = useAuth();
  const { busy, run } = useAction();
  const [name, setName] = useState(user.displayName);
  const [notif, setNotif] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [exact, setExact] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(true);

  const refresh = useCallback(async () => {
    const p = await Notifications.getPermissionsAsync();
    setNotif(p.status as typeof notif);
    if (Platform.OS === 'android') {
      const e = await Notifications.getExactAlarmPermissionsAsync().catch(() => null);
      setExact(e ? e.granted : null);
    }
    setAuto(await getAutoRemindersEnabled());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enablePush = () =>
    run('push', async () => {
      const r = await registerForPush();
      if (!r.ok && r.reason === 'permission-denied') {
        Alert.alert('Notifications are off', 'Turn them on in system settings to get task updates.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ]);
      } else if (!r.ok && r.reason === 'token-error') {
        Alert.alert(
          'Push not available in this build',
          'Reminders on this phone still work. Server push needs google-services.json in the build (see README).',
        );
      }
      await refresh();
    });

  return (
    <Screen>
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={user.displayName} size={64} />
        <Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{user.displayName}</Text>
        <Muted>{user.email}</Muted>
      </Card>

      <SectionTitle>Profile</SectionTitle>
      <Card>
        <TextField label="Display name" value={name} onChangeText={setName} maxLength={LIMITS.displayName} />
        <Muted>Your new name shows in all your groups.</Muted>
        <Button
          title="Save name"
          variant="secondary"
          disabled={!name.trim() || name.trim() === user.displayName}
          loading={busy === 'name'}
          onPress={() => run('name', () => updateName(name))}
        />
      </Card>

      <SectionTitle>Notifications</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Body>Task updates & reminders</Body>
          <Text style={{ color: notif === 'granted' ? c.success : c.danger, fontWeight: '600' }}>
            {notif === 'granted' ? 'On' : notif == null ? '…' : 'Off'}
          </Text>
        </View>
        {notif !== 'granted' ? <Button title="Turn on notifications" onPress={enablePush} loading={busy === 'push'} /> : null}

        {Platform.OS === 'android' && exact === false ? (
          <>
            <Muted>Exact alarms are off, so reminders may arrive a few minutes late.</Muted>
            <Button
              title="Allow exact reminders"
              variant="secondary"
              onPress={() => run('exact', async () => {
                await Notifications.requestExactAlarmPermissionsAsync();
                await refresh();
              })}
            />
          </>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm }}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Body>Auto due-date reminders</Body>
            <Muted>1 hour before and at the due time, for tasks assigned to you.</Muted>
          </View>
          <Switch
            value={auto}
            onValueChange={async (v) => {
              setAuto(v);
              await setAutoRemindersEnabled(v);
            }}
          />
        </View>
        {Platform.OS === 'android' ? (
          <Muted style={{ marginTop: space.sm }}>
            Not getting notifications on Xiaomi, Oppo, Vivo, Realme or OnePlus? Set Battery → "No restrictions" for Crew Tasks
            and allow Autostart.
          </Muted>
        ) : null}
        {Platform.OS === 'android' ? (
          <Button title="Open app settings" variant="ghost" compact onPress={() => Linking.openSettings()} />
        ) : null}
      </Card>

      <Button
        title="Sign out"
        variant="danger"
        icon="log-out-outline"
        loading={busy === 'out'}
        onPress={() =>
          Alert.alert('Sign out?', 'Reminders on this phone will be cleared.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => run('out', signOut) },
          ])
        }
      />
      <Muted style={{ textAlign: 'center' }}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Muted>
    </Screen>
  );
}
