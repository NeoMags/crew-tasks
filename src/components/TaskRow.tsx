import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { checklistProgress, formatDue, isOverdue } from '../lib/logic';
import { dueMs } from '../lib/tasks';
import { PRIORITY_LABEL, STATUS_LABEL, type Group, type Task } from '../lib/types';
import { PRIORITY_COLOR, radius, space, STATUS_COLOR, useTheme } from '../theme';
import { Avatar, Pill, ProgressBar } from './ui';

export function TaskRow({
  task,
  group,
  showGroup,
}: {
  task: Task;
  group?: Group | null;
  showGroup?: boolean;
}) {
  const c = useTheme();
  const due = dueMs(task);
  const overdue = isOverdue(due, task.status);
  const cl = checklistProgress(task.checklist);
  const names = task.assigneeIds.map((u) => group?.members[u]?.name ?? '?');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${STATUS_LABEL[task.status]}${overdue ? ', overdue' : ''}`}
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => ({
        backgroundColor: c.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: overdue ? c.danger + '66' : c.border,
        borderLeftWidth: 4,
        borderLeftColor: PRIORITY_COLOR[task.priority],
        padding: space.md,
        gap: 8,
        opacity: pressed ? 0.85 : task.status === 'done' ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Text
          style={{
            flex: 1,
            color: c.text,
            fontSize: 16,
            fontWeight: '600',
            textDecorationLine: task.status === 'done' ? 'line-through' : 'none',
          }}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <Pill label={STATUS_LABEL[task.status]} color={STATUS_COLOR[task.status]} />
      </View>

      {showGroup ? (
        <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>
          {task.groupName}
        </Text>
      ) : null}

      {task.status === 'blocked' && task.blockedReason ? (
        <Text style={{ color: STATUS_COLOR.blocked, fontSize: 13 }} numberOfLines={2}>
          Blocked: {task.blockedReason}
        </Text>
      ) : null}

      {task.status !== 'done' && task.progress > 0 ? <ProgressBar value={task.progress} color={STATUS_COLOR[task.status]} /> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {due != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name={overdue ? 'alert-circle' : 'calendar-outline'} size={14} color={overdue ? c.danger : c.muted} />
            <Text style={{ color: overdue ? c.danger : c.muted, fontSize: 13, fontWeight: overdue ? '700' : '400' }}>
              {overdue ? 'Overdue · ' : ''}
              {formatDue(due)}
            </Text>
          </View>
        ) : null}
        {cl.total > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="checkbox-outline" size={14} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 13 }}>
              {cl.done}/{cl.total} needed
            </Text>
          </View>
        ) : null}
        {task.recurrence !== 'none' ? <Ionicons name="repeat" size={14} color={c.muted} /> : null}
        {task.priority === 'urgent' || task.priority === 'high' ? (
          <Text style={{ color: PRIORITY_COLOR[task.priority], fontSize: 13, fontWeight: '600' }}>
            {PRIORITY_LABEL[task.priority]}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row' }}>
          {names.slice(0, 3).map((n, i) => (
            <View key={i} style={{ marginLeft: i ? -8 : 0 }}>
              <Avatar name={n} size={24} />
            </View>
          ))}
          {names.length > 3 ? <Text style={{ color: c.muted, marginLeft: 4 }}>+{names.length - 3}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}
