import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Share, Text, View } from 'react-native';
import { TaskRow } from '../../../../components/TaskRow';
import { Avatar, Button, Chip, EmptyState, ErrorBanner, IconButton, Loading } from '../../../../components/ui';
import { useGroup, useGroupTasks } from '../../../../hooks/data';
import { useUser } from '../../../../lib/auth';
import { compareTasks, isOpen, isOverdue } from '../../../../lib/logic';
import { createdMs, dueMs } from '../../../../lib/tasks';
import { STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '../../../../lib/types';
import { radius, space, useTheme } from '../../../../theme';

type StatusFilter = 'open' | TaskStatus;

export default function GroupBoard() {
  const c = useTheme();
  const user = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const tasks = useGroupTasks(id);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [member, setMember] = useState<string | null>(null);
  const now = Date.now();

  const perMember = useMemo(() => {
    const g = group.data;
    if (!g) return [];
    return g.memberIds.map((uid) => {
      const mine = (tasks.data ?? []).filter((t) => t.assigneeIds.includes(uid));
      return {
        uid,
        name: g.members[uid]?.name ?? '?',
        open: mine.filter((t) => isOpen(t.status)).length,
        overdue: mine.filter((t) => isOverdue(dueMs(t), t.status, now)).length,
      };
    });
  }, [group.data, tasks.data, now]);

  const visible = useMemo(
    () =>
      (tasks.data ?? [])
        .filter((t) => (status === 'open' ? isOpen(t.status) : t.status === status))
        .filter((t) => (member ? t.assigneeIds.includes(member) : true))
        .sort((a, b) =>
          compareTasks(
            { status: a.status, priority: a.priority, dueMs: dueMs(a), createdMs: createdMs(a) },
            { status: b.status, priority: b.priority, dueMs: dueMs(b), createdMs: createdMs(b) },
            now,
          ),
        ),
    [tasks.data, status, member, now],
  );

  if (group.loading) return <Loading />;
  if (group.error || !group.data) {
    return (
      <View style={{ flex: 1, padding: space.lg, backgroundColor: c.bg }}>
        <ErrorBanner message={group.error ?? 'This group no longer exists.'} onRetry={group.retry} />
      </View>
    );
  }
  const g = group.data;

  const invite = () =>
    Share.share({
      message:
        `Join "${g.name}" on Crew Tasks.\n\nInvite code: ${g.inviteCode}\n` +
        `Open the app → Groups → Join, or tap: crewtasks://group/join?code=${g.inviteCode}`,
    });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      {g.description ? <Text style={{ color: c.muted }}>{g.description}</Text> : null}

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="New task" icon="add" onPress={() => router.push({ pathname: '/task/new', params: { groupId: g.id } })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Invite" icon="share-social-outline" variant="secondary" onPress={invite} />
        </View>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={perMember}
        keyExtractor={(m) => m.uid}
        contentContainerStyle={{ gap: space.sm }}
        renderItem={({ item: m }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: member === m.uid }}
            accessibilityLabel={`${m.name}: ${m.open} pending, ${m.overdue} overdue`}
            onPress={() => setMember(member === m.uid ? null : m.uid)}
            style={{
              alignItems: 'center',
              width: 84,
              padding: space.sm,
              borderRadius: radius.md,
              backgroundColor: c.card,
              borderWidth: 1,
              borderColor: member === m.uid ? c.primary : c.border,
              gap: 4,
            }}
          >
            <Avatar name={m.name} size={36} />
            <Text style={{ color: c.text, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
              {m.uid === user.uid ? 'You' : m.name}
            </Text>
            <Text style={{ color: m.overdue ? c.danger : c.muted, fontSize: 11 }}>
              {m.open} pending{m.overdue ? ` · ${m.overdue}!` : ''}
            </Text>
          </Pressable>
        )}
      />

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={['open', ...TASK_STATUSES] as StatusFilter[]}
        keyExtractor={(s) => s}
        contentContainerStyle={{ gap: space.sm }}
        renderItem={({ item: s }) => (
          <Chip label={s === 'open' ? 'All pending' : STATUS_LABEL[s]} selected={status === s} onPress={() => setStatus(s)} />
        )}
      />
      {tasks.error ? <ErrorBanner message={tasks.error} onRetry={tasks.retry} /> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: g.name,
          headerRight: () => (
            <IconButton name="settings-outline" label="Group settings" onPress={() => router.push(`/group/${g.id}/settings`)} />
          ),
        }}
      />
      {tasks.loading ? (
        <Loading />
      ) : (
        <FlatList
          style={{ flex: 1, backgroundColor: c.bg }}
          contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 80 }}
          data={visible}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          renderItem={({ item }) => <TaskRow task={item} group={g} />}
          ListEmptyComponent={
            g.memberIds.length === 1 ? (
              <EmptyState
                icon="person-add-outline"
                title="Invite your friends"
                body={`Share the code ${g.inviteCode} so they can join.`}
                action={<Button title="Share invite" icon="share-social-outline" onPress={invite} />}
              />
            ) : (
              <EmptyState
                icon="checkmark-done-outline"
                title={status === 'open' ? 'Nothing pending' : 'No tasks here'}
                body="Create a task and assign it to someone."
              />
            )
          }
        />
      )}
    </>
  );
}
