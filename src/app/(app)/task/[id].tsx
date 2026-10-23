import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import {
  ActivitySection,
  AttachmentsSection,
  ChecklistSection,
  CommentsSection,
  RemindersSection,
  StatusSection,
} from '../../../components/TaskSections';
import { Avatar, Body, Card, ErrorBanner, IconButton, Loading, Muted, Pill, Screen } from '../../../components/ui';
import { useAction, useGroup, useTask } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { canEditDetails, formatDue, isOverdue } from '../../../lib/logic';
import { deleteTask, dueMs } from '../../../lib/tasks';
import { PRIORITY_LABEL, RECURRENCE_LABEL } from '../../../lib/types';
import { PRIORITY_COLOR, space, useTheme } from '../../../theme';

// Photo attachments need Cloud Storage, which requires the Firebase Blaze plan.
// Build with EXPO_PUBLIC_ATTACHMENTS=off to hide them on the free Spark plan.
const ATTACHMENTS_ENABLED = process.env.EXPO_PUBLIC_ATTACHMENTS !== 'off';

export default function TaskDetail() {
  const c = useTheme();
  const user = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useTask(id);
  const group = useGroup(task.data?.groupId);
  const { run } = useAction();

  if (task.loading || (task.data && group.loading)) return <Loading />;
  if (task.error || !task.data) {
    return (
      <Screen>
        <ErrorBanner message={task.error ?? 'This task was deleted.'} onRetry={task.error ? task.retry : undefined} />
      </Screen>
    );
  }
  const t = task.data;
  const g = group.data;
  if (!g) {
    return (
      <Screen>
        <ErrorBanner message={group.error ?? "You're no longer a member of this task's group."} />
      </Screen>
    );
  }

  const editor = canEditDetails(t, g, user.uid);
  const due = dueMs(t);
  const overdue = isOverdue(due, t.status);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: g.name,
          headerRight: () =>
            editor ? (
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <IconButton
                  name="create-outline"
                  label="Edit task"
                  onPress={() => router.push({ pathname: '/task/new', params: { taskId: t.id } })}
                />
                <IconButton
                  name="trash-outline"
                  label="Delete task"
                  color={c.danger}
                  onPress={() =>
                    Alert.alert('Delete task?', 'This removes it for everyone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => run('del', () => deleteTask(t.id), () => router.back()) },
                    ])
                  }
                />
              </View>
            ) : null,
        }}
      />
      <Screen>
        <Card>
          <Text style={{ color: c.text, fontSize: 22, fontWeight: '800' }} selectable>
            {t.title}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill label={PRIORITY_LABEL[t.priority]} color={PRIORITY_COLOR[t.priority]} />
            {t.recurrence !== 'none' ? <Pill label={RECURRENCE_LABEL[t.recurrence]} color={c.primary} /> : null}
            {t.requiresApproval ? <Pill label="Needs approval" color={c.warning} /> : null}
          </View>
          {due != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={overdue ? 'alert-circle' : 'calendar-outline'} size={16} color={overdue ? c.danger : c.muted} />
              <Text style={{ color: overdue ? c.danger : c.text, fontWeight: overdue ? '700' : '400' }}>
                {overdue ? 'Overdue — was due ' : 'Due '}
                {formatDue(due)}
              </Text>
            </View>
          ) : null}
          {t.description ? <Body style={{ marginTop: space.sm }}>{t.description}</Body> : null}

          <View style={{ marginTop: space.sm, gap: space.sm }}>
            <Muted>Assigned by {t.createdBy === user.uid ? 'you' : t.createdByName}</Muted>
            {t.assigneeIds.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                {t.assigneeIds.map((u) => (
                  <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Avatar name={g.members[u]?.name ?? '?'} size={24} />
                    <Text style={{ color: c.text }}>{u === user.uid ? 'You' : g.members[u]?.name ?? 'Former member'}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Muted>Not assigned yet — anyone in the group can pick it up.</Muted>
            )}
          </View>
          {t.nextTaskId ? (
            <Pressable onPress={() => router.push(`/task/${t.nextTaskId}`)} accessibilityRole="link">
              <Text style={{ color: c.primary, marginTop: space.sm }}>Next occurrence →</Text>
            </Pressable>
          ) : null}
        </Card>

        <StatusSection task={t} group={g} user={user} />
        <ChecklistSection task={t} group={g} user={user} />
        {ATTACHMENTS_ENABLED ? <AttachmentsSection task={t} group={g} user={user} /> : null}
        <RemindersSection task={t} group={g} user={user} />
        <CommentsSection task={t} group={g} user={user} />
        <ActivitySection task={t} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
