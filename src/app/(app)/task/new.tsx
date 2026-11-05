import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { DateTimeField } from '../../../components/DateTimeField';
import { Body, Button, Chip, EmptyState, IconButton, Loading, Muted, Screen, SectionTitle, TextField } from '../../../components/ui';
import { useAction, useMyGroups, useTask } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { canEditDetails, LIMITS } from '@shared/logic';
import { createTask, updateTaskDetails, type TaskInput } from '../../../lib/tasks';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  RECURRENCES,
  RECURRENCE_LABEL,
  type Priority,
  type Group,
  type Recurrence,
  type Task,
} from '@shared/types';
import { PRIORITY_COLOR, space, useTheme } from '../../../theme';

/** Create a task (optionally for ?groupId) or edit one (?taskId). */
export default function TaskForm() {
  const user = useUser();
  const params = useLocalSearchParams<{ groupId?: string; taskId?: string }>();
  const editing = useTask(params.taskId);
  const groups = useMyGroups(user.uid);

  if (groups.loading || (params.taskId && editing.loading)) return <Loading />;
  if (!groups.data?.length) {
    return (
      <Screen>
        <EmptyState icon="people-outline" title="Create or join a group first" />
        <Button title="Go to groups" onPress={() => router.replace('/groups')} />
      </Screen>
    );
  }
  if (params.taskId && !editing.data) {
    return (
      <Screen>
        <EmptyState icon="alert-circle-outline" title={editing.error ?? 'This task no longer exists.'} />
      </Screen>
    );
  }
  // Fields start from the task being edited, so the form never flashes empty values.
  return <TaskFormBody task={editing.data ?? null} groups={groups.data} presetGroupId={params.groupId} />;
}

function TaskFormBody({ task, groups, presetGroupId }: { task: Task | null; groups: Group[]; presetGroupId?: string }) {
  const c = useTheme();
  const user = useUser();
  const { busy, run } = useAction();

  // With a single group there is nothing to choose.
  const [groupId, setGroupId] = useState<string | undefined>(
    task?.groupId ?? presetGroupId ?? (groups.length === 1 ? groups[0]!.id : undefined),
  );
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? []);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium');
  const [dueAt, setDueAt] = useState<Date | null>(task?.dueAt ? new Date(task.dueAt) : null);
  const [recurrence, setRecurrence] = useState<Recurrence>(task?.recurrence ?? 'none');
  const [requiresApproval, setRequiresApproval] = useState(task?.requiresApproval ?? false);
  const [needed, setNeeded] = useState<string[]>([]);
  const [neededDraft, setNeededDraft] = useState('');

  const group = useMemo(() => groups.find((g) => g.id === groupId) ?? null, [groups, groupId]);

  if (task && group && !canEditDetails(task, group, user.uid)) {
    return (
      <Screen>
        <EmptyState icon="lock-closed-outline" title="Only the person who assigned this task or a group admin can edit it." />
      </Screen>
    );
  }

  const toggleAssignee = (uid: string) =>
    setAssigneeIds((ids) => (ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid]));

  const addNeeded = () => {
    const t = neededDraft.trim();
    if (!t || needed.length >= LIMITS.checklistItems) return;
    setNeeded((n) => [...n, t]);
    setNeededDraft('');
  };

  const save = () =>
    run('save', async () => {
      if (!group) throw new Error('Choose a group.');
      const input: TaskInput = {
        title,
        description,
        assigneeIds,
        priority,
        dueAt,
        recurrence,
        requiresApproval,
        checklist: neededDraft.trim() ? [...needed, neededDraft.trim()] : needed,
      };
      if (task) {
        await updateTaskDetails(user, group, task, input);
        router.back();
      } else {
        const id = await createTask(user, group, input);
        router.replace(`/task/${id}`);
      }
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: task ? 'Edit task' : 'New task' }} />

      {!task && !presetGroupId && groups.length > 1 ? (
        <>
          <SectionTitle>Group</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {groups.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                selected={g.id === groupId}
                onPress={() => {
                  setGroupId(g.id);
                  setAssigneeIds([]);
                }}
              />
            ))}
          </View>
        </>
      ) : group ? (
        <Muted>In {group.name}</Muted>
      ) : null}

      <TextField label="What needs doing?" value={title} onChangeText={setTitle} maxLength={LIMITS.taskTitle} placeholder="e.g. Book train tickets" />
      <TextField
        label="Details (optional)"
        value={description}
        onChangeText={setDescription}
        maxLength={LIMITS.taskDescription}
        multiline
        placeholder="Context, links, instructions…"
      />

      {group ? (
        <>
          <SectionTitle>Assign to</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {group.memberIds.map((uid) => (
              <Chip
                key={uid}
                label={uid === user.uid ? 'Me' : group.members[uid]?.name ?? '?'}
                selected={assigneeIds.includes(uid)}
                onPress={() => toggleAssignee(uid)}
              />
            ))}
          </View>
          {assigneeIds.length === 0 ? <Muted>Leave empty to let anyone in the group pick it up.</Muted> : null}
        </>
      ) : null}

      <SectionTitle>Priority</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {PRIORITIES.map((p) => (
          <Chip key={p} label={PRIORITY_LABEL[p]} color={PRIORITY_COLOR[p]} selected={priority === p} onPress={() => setPriority(p)} />
        ))}
      </View>

      <DateTimeField label="Due" value={dueAt} onChange={setDueAt} />

      <SectionTitle>Repeat</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {RECURRENCES.map((r) => (
          <Chip key={r} label={RECURRENCE_LABEL[r]} selected={recurrence === r} onPress={() => setRecurrence(r)} />
        ))}
      </View>
      {recurrence !== 'none' && !dueAt ? <Text style={{ color: c.danger }}>Repeating tasks need a due date.</Text> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Body>Needs my approval</Body>
          <Muted>Assignees submit for review; only you or an admin can mark it done.</Muted>
        </View>
        <Switch value={requiresApproval} onValueChange={setRequiresApproval} />
      </View>

      {!task ? (
        <>
          <SectionTitle>What’s needed (optional)</SectionTitle>
          <Muted>Documents, money, photos or anything that has to be furnished.</Muted>
          {needed.map((n, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={{ color: c.text, flex: 1 }}>• {n}</Text>
              <IconButton name="close-circle-outline" label={`Remove ${n}`} color={c.muted} onPress={() => setNeeded((x) => x.filter((_, j) => j !== i))} />
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={neededDraft}
                onChangeText={setNeededDraft}
                maxLength={LIMITS.checklistItem}
                placeholder="e.g. Aadhaar copy, ₹500 advance"
                onSubmitEditing={addNeeded}
                returnKeyType="done"
              />
            </View>
            <IconButton name="add-circle" label="Add needed item" onPress={addNeeded} />
          </View>
        </>
      ) : null}

      <Button
        title={task ? 'Save changes' : 'Create task'}
        onPress={save}
        loading={busy === 'save'}
        disabled={!title.trim() || !group || (recurrence !== 'none' && !dueAt)}
      />
    </Screen>
  );
}
