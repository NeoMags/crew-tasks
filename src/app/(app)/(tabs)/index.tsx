import { router, Stack } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { TaskRow } from '../../../components/TaskRow';
import { Button, Chip, EmptyState, ErrorBanner, IconButton, Loading } from '../../../components/ui';
import { useAssignedTasks, useCreatedTasks, useMyGroups } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { compareTasks, isDueToday, isOpen, isOverdue } from '../../../lib/logic';
import { syncAutoReminders } from '../../../lib/reminders';
import { createdMs, dueMs } from '../../../lib/tasks';
import type { Task } from '../../../lib/types';
import { radius, space, STATUS_COLOR, useTheme } from '../../../theme';

type Scope = 'assigned' | 'created';
type Filter = 'active' | 'overdue' | 'today' | 'blocked' | 'review' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'review', label: 'In review' },
  { key: 'done', label: 'Done' },
];

function matches(t: Task, f: Filter, now: number): boolean {
  const due = dueMs(t);
  switch (f) {
    case 'active':
      return isOpen(t.status);
    case 'overdue':
      return isOverdue(due, t.status, now);
    case 'today':
      return isOpen(t.status) && isDueToday(due, now);
    case 'blocked':
      return t.status === 'blocked';
    case 'review':
      return t.status === 'review';
    case 'done':
      return t.status === 'done';
  }
}

export default function MyTasks() {
  const c = useTheme();
  const user = useUser();
  const groups = useMyGroups(user.uid);
  const assigned = useAssignedTasks(user.uid);
  const created = useCreatedTasks(user.uid);
  const [scope, setScope] = useState<Scope>('assigned');
  const [filter, setFilter] = useState<Filter>('active');

  const groupById = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g])), [groups.data]);
  const source = scope === 'assigned' ? assigned : created;
  const now = Date.now();

  // Keep on-device due reminders in step with the tasks assigned to me.
  useEffect(() => {
    if (!assigned.data) return;
    syncAutoReminders(
      assigned.data.map((t) => ({ id: t.id, title: t.title, groupName: t.groupName, dueMs: dueMs(t), status: t.status })),
    ).catch(() => {});
  }, [assigned.data]);

  const stats = useMemo(() => {
    const list = source.data ?? [];
    return {
      open: list.filter((t) => isOpen(t.status)).length,
      overdue: list.filter((t) => isOverdue(dueMs(t), t.status, now)).length,
      today: list.filter((t) => isOpen(t.status) && isDueToday(dueMs(t), now)).length,
      blocked: list.filter((t) => t.status === 'blocked').length,
    };
  }, [source.data, now]);

  const visible = useMemo(
    () =>
      (source.data ?? [])
        .filter((t) => matches(t, filter, now))
        .sort((a, b) =>
          compareTasks(
            { status: a.status, priority: a.priority, dueMs: dueMs(a), createdMs: createdMs(a) },
            { status: b.status, priority: b.priority, dueMs: dueMs(b), createdMs: createdMs(b) },
            now,
          ),
        ),
    [source.data, filter, now],
  );

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <View style={{ flexDirection: 'row', backgroundColor: c.card, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: c.border }}>
        {(['assigned', 'created'] as Scope[]).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === s }}
            onPress={() => setScope(s)}
            style={{ flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: scope === s ? c.primarySoft : 'transparent' }}
          >
            <Text style={{ textAlign: 'center', fontWeight: '600', color: scope === s ? c.primary : c.muted }}>
              {s === 'assigned' ? 'Assigned to me' : 'I assigned'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {[
          { n: stats.open, l: 'Open', color: c.text, f: 'active' as Filter },
          { n: stats.overdue, l: 'Overdue', color: c.danger, f: 'overdue' as Filter },
          { n: stats.today, l: 'Today', color: c.warning, f: 'today' as Filter },
          { n: stats.blocked, l: 'Blocked', color: STATUS_COLOR.blocked, f: 'blocked' as Filter },
        ].map((s) => (
          <Pressable
            key={s.l}
            onPress={() => setFilter(s.f)}
            accessibilityRole="button"
            accessibilityLabel={`${s.n} ${s.l}`}
            style={{ flex: 1, backgroundColor: c.card, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: filter === s.f ? s.color : c.border }}
          >
            <Text style={{ color: s.color, fontSize: 22, fontWeight: '800' }}>{s.n}</Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>{s.l}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTERS}
        keyExtractor={(f) => f.key}
        contentContainerStyle={{ gap: space.sm }}
        renderItem={({ item }) => <Chip label={item.label} selected={filter === item.key} onPress={() => setFilter(item.key)} />}
      />
      {source.error ? <ErrorBanner message={source.error} onRetry={source.retry} /> : null}
    </View>
  );

  const noGroups = groups.data && groups.data.length === 0;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () =>
            groups.data?.length ? (
              <View style={{ marginRight: space.md }}>
                <IconButton name="add-circle" label="New task" onPress={() => router.push('/task/new')} />
              </View>
            ) : null,
        }}
      />
      {source.loading || groups.loading ? (
        <Loading />
      ) : (
        <FlatList
          style={{ flex: 1, backgroundColor: c.bg }}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 80 }}
          data={visible}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={false} onRefresh={source.retry} />}
          renderItem={({ item }) => <TaskRow task={item} group={groupById.get(item.groupId)} showGroup />}
          ListEmptyComponent={
            noGroups ? (
              <EmptyState
                icon="people-outline"
                title="Start with a group"
                body="Create a group for your friends, or join one with an invite code."
                action={
                  <View style={{ gap: space.sm }}>
                    <Button title="Create a group" icon="add" onPress={() => router.push('/group/new')} />
                    <Button title="Join with code" variant="secondary" icon="enter-outline" onPress={() => router.push('/group/join')} />
                  </View>
                }
              />
            ) : (
              <EmptyState
                icon={filter === 'done' ? 'trophy-outline' : 'checkmark-done-outline'}
                title={filter === 'active' ? 'Nothing pending' : 'Nothing here'}
                body={scope === 'assigned' ? 'Tasks assigned to you show up here.' : 'Tasks you assign to friends show up here.'}
              />
            )
          }
        />
      )}
    </>
  );
}
