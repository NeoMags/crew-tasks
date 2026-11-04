import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button, EmptyState, ErrorBanner, Loading } from '../../../components/ui';
import { useAction, useNotifications } from '../../../hooks/data';
import { formatDue } from '@shared/logic';
import { markNotificationsRead } from '../../../lib/tasks';
import { radius, space, useTheme } from '../../../theme';

/** In-app notifications: works with or without push set up. */
export default function Inbox() {
  const c = useTheme();
  const inbox = useNotifications();
  const { busy, run } = useAction();

  if (inbox.loading) return <Loading />;
  const items = inbox.data?.items ?? [];
  const unread = inbox.data?.unread ?? 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            unread ? (
              <View style={{ marginRight: space.sm }}>
                <Button title="Mark all read" variant="ghost" compact loading={busy === 'all'} onPress={() => run('all', () => markNotificationsRead())} />
              </View>
            ) : null,
        }}
      />
      <FlatList
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={inbox.retry} />}
        ListHeaderComponent={inbox.error ? <ErrorBanner message={inbox.error} onRetry={inbox.retry} /> : undefined}
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
            onPress={() => {
              if (!n.read) markNotificationsRead([n.id]).catch(() => {});
              if (n.taskId) router.push(`/task/${n.taskId}`);
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: space.md,
              padding: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: n.read ? c.border : c.primary + '55',
              backgroundColor: n.read ? c.card : c.primarySoft,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name={/^Overdue/.test(n.title) ? 'alert-circle' : 'notifications-outline'} size={20} color={/^Overdue/.test(n.title) ? c.danger : c.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.text, fontWeight: n.read ? '500' : '700' }}>{n.title}</Text>
              {n.body ? (
                <Text style={{ color: c.muted }} numberOfLines={2}>
                  {n.body}
                </Text>
              ) : null}
              <Text style={{ color: c.muted, fontSize: 12 }}>{formatDue(Date.parse(n.createdAt))}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState icon="notifications-off-outline" title="All caught up" body="Assignments, updates, mentions and overdue alerts show up here." />
        }
      />
    </>
  );
}
