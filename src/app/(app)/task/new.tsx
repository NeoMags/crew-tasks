import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { DateTimeField } from '../../../components/DateTimeField';
import { Body, Button, Chip, EmptyState, IconButton, Loading, Muted, Screen, SectionTitle, TextField } from '../../../components/ui';
import { useAction, useMyGroups, useTask } from '../../../hooks/data';
import { useUser } from '../../../lib/auth';
import { canEditDetails, LIMITS } from '../../../lib/logic';
import { createTask, updateTaskDetails, type TaskInput } from '../../../lib/tasks';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  RECURRENCES,
  RECURRENCE_LABEL,
  type Priority,
  type Recurrence,
} from '../../../lib/types';
import { PRIORITY_COLOR, space, useTheme } from '../../../theme';

/** Create a task (optionally for ?groupId) or edit one (?taskId). */
export default function TaskForm() {
  const c = useTheme();
  const user = useUser();
  const params = useLocalSearchParams<{ groupId?: string; taskId?: string }>();
  const editing = useTask(params.taskId);
  const groups = useMyGroups(user.uid);
  const { busy, run } = useAction();

  const [groupId, setGroupId] = useState<string | undefined>(params.groupId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [needed, setNeeded] = useState<string[]>([]);
  const [neededDraft, setNeededDraft] = useState('');
  const [loaded, setLoaded] = useState(!params.taskId);

  // Prefill when editing.
  useEffect(() => {
    const t = editing.data;
    if (!t || loaded) return;
    setGroupId(t.groupId);
    setTitle(t.title);
    setDescription(t.description);
    setAssigneeIds(t.assigneeIds);
    setPriority(t.priority);
    setDueAt(t.dueAt ? t.dueAt.toDate() : null);
    setRecurrence(t.recurrence);
    setRequiresApproval(t.requiresApproval);
    setLoaded(true);
  }, [editing.data, loaded]);

  // Single group? Pick it automatically.
  useEffect(() => {
    if (!groupId && groups.data?.length === 1) setGroupId(groups.data[0]!.id);
  }, [groupId, groups.data]);

  const group = useMemo(() => groups.data?.find((g) => g.id === groupId) ?? null, [groups.data, groupId]);

  if (groups.loading || !loaded) return <Loading />;
  if (!groups.data?.length) {
    return (
      <Screen>
        <EmptyState icon="people-outline" title="Create or join a group first" />
        <Button title="Go to groups" onPress={() => router.replace('/groups')} />
      </Screen>
    );
  }
  if (editing.data && group && !canEditDetails(editing.data, group, user.uid)) {
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
      if (editing.data) {
        await updateTaskDetails(user, group, editing.data, input);
        router.back();
      } else {
        const id = await createTask(user, group, input);
        router.replace(`/task/${id}`);
      }
    });

  return (
    <Screen>
      <Stack.Screen options={{ title: editing.data ? 'Edit task' : 'New task' }} />

      {!params.taskId && !params.groupId && groups.data.length > 1 ? (
        <>
          <SectionTitle>Group</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {groups.data.map((g) => (
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

      {!editing.data ? (
        <>
          <SectionTitle>What's needed (optional)</SectionTitle>
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
        title={editing.data ? 'Save changes' : 'Create task'}
        onPress={save}
        loading={busy === 'save'}
        disabled={!title.trim() || !group || (recurrence !== 'none' && !dueAt)}
      />
    </Screen>
  );
}
