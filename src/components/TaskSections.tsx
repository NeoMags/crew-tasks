import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { useAction, useActivity, useComments } from '../hooks/data';
import type { AppUser } from '../lib/auth';
import { allowedStatuses, canEditDetails, canWorkOn, checklistProgress, formatDue, LIMITS } from '../lib/logic';
import { addCustomReminder, cancelCustomReminder, listCustomReminders } from '../lib/reminders';
import {
  addChecklistItem,
  addComment,
  claimTask,
  removeAttachment,
  removeChecklistItem,
  setProgress,
  setStatus,
  toggleChecklistItem,
  uploadAttachment,
} from '../lib/tasks';
import { STATUS_LABEL, type Group, type Task, type TaskStatus } from '../lib/types';
import { radius, space, STATUS_COLOR, useTheme } from '../theme';
import { pickDateTime } from './DateTimeField';
import { Avatar, Body, Button, Card, Chip, IconButton, Muted, ProgressBar, SectionTitle, TextField } from './ui';

interface Props {
  task: Task;
  group: Group;
  user: AppUser;
}

// ---------------- Status & progress ----------------

export function StatusSection({ task, group, user }: Props) {
  const c = useTheme();
  const { busy, run } = useAction();
  const [blockedDraft, setBlockedDraft] = useState<string | null>(null);
  const statuses = allowedStatuses(task, group, user.uid);
  const canWork = canWorkOn(task, group, user.uid);

  const choose = (s: TaskStatus) => {
    if (s === 'blocked') return setBlockedDraft(task.blockedReason || '');
    setBlockedDraft(null);
    run('status', () => setStatus(user, task.id, s));
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: STATUS_COLOR[task.status], fontSize: 18, fontWeight: '800' }}>{STATUS_LABEL[task.status]}</Text>
        <Text style={{ color: c.muted, fontWeight: '600' }}>{task.progress}%</Text>
      </View>
      <ProgressBar value={task.progress} color={STATUS_COLOR[task.status]} />
      {task.status === 'blocked' && task.blockedReason ? (
        <Body style={{ color: STATUS_COLOR.blocked }}>Blocked: {task.blockedReason}</Body>
      ) : null}
      {task.status === 'review' && task.requiresApproval && canEditDetails(task, group, user.uid) ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Approve" icon="checkmark" loading={busy === 'status'} onPress={() => run('status', () => setStatus(user, task.id, 'done'))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Send back" variant="secondary" onPress={() => run('status', () => setStatus(user, task.id, 'in_progress'))} />
          </View>
        </View>
      ) : null}

      {task.assigneeIds.length === 0 ? (
        <Button title="I'll do this" icon="hand-right-outline" loading={busy === 'claim'} onPress={() => run('claim', () => claimTask(user, task.id))} />
      ) : null}

      {canWork ? (
        <>
          <Muted style={{ marginTop: space.sm }}>Update status</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {statuses.map((s) => (
              <Chip key={s} label={STATUS_LABEL[s]} color={STATUS_COLOR[s]} selected={task.status === s} onPress={() => choose(s)} />
            ))}
          </View>
          {task.requiresApproval && !statuses.includes('done') ? (
            <Muted>This task needs approval — move it to “In review” when finished.</Muted>
          ) : null}
          {blockedDraft !== null ? (
            <View style={{ gap: space.sm }}>
              <TextField
                label="What is blocking it?"
                value={blockedDraft}
                onChangeText={setBlockedDraft}
                maxLength={LIMITS.blockedReason}
                placeholder="e.g. Waiting for Ravi to send the money"
                autoFocus
              />
              <Button
                title="Mark blocked"
                variant="danger"
                loading={busy === 'status'}
                onPress={() => run('status', () => setStatus(user, task.id, 'blocked', blockedDraft), () => setBlockedDraft(null))}
              />
            </View>
          ) : null}
          {task.status !== 'done' ? (
            <>
              <Muted style={{ marginTop: space.sm }}>Progress</Muted>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {[0, 25, 50, 75, 100].map((p) => (
                  <Chip
                    key={p}
                    label={`${p}%`}
                    selected={task.progress === p}
                    onPress={() => run('progress', () => setProgress(user, task.id, p))}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : task.assigneeIds.length ? (
        <Muted>Only assignees, the assigner or an admin can change the status.</Muted>
      ) : null}
    </Card>
  );
}

// ---------------- What's needed (checklist) ----------------

export function ChecklistSection({ task, user }: Props) {
  const c = useTheme();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState('');
  const { done, total } = checklistProgress(task.checklist);

  return (
    <>
      <SectionTitle right={total ? <Muted>{done}/{total} furnished</Muted> : null}>What's needed</SectionTitle>
      <Card style={{ gap: space.md }}>
        {task.checklist.length === 0 ? <Muted>Nothing listed. Add documents, money, items or info that must be furnished.</Muted> : null}
        {task.checklist.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            onPress={() => run(item.id, () => toggleChecklistItem(user, task.id, item.id))}
            onLongPress={() =>
              Alert.alert('Remove item?', item.text, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => run('rm', () => removeChecklistItem(user, task.id, item.id)) },
              ])
            }
            style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start', opacity: busy === item.id ? 0.5 : 1 }}
          >
            <Ionicons name={item.done ? 'checkbox' : 'square-outline'} size={22} color={item.done ? c.success : c.muted} />
            <View style={{ flex: 1 }}>
              <Body style={{ textDecorationLine: item.done ? 'line-through' : 'none', color: item.done ? c.muted : c.text }}>
                {item.text}
              </Body>
              {item.done && item.doneByName ? (
                <Muted style={{ fontSize: 12 }}>
                  by {item.doneByName}
                  {item.doneAt ? ` · ${formatDue(item.doneAt)}` : ''}
                </Muted>
              ) : null}
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <TextField
              value={draft}
              onChangeText={setDraft}
              placeholder="Add something that's needed…"
              maxLength={LIMITS.checklistItem}
              onSubmitEditing={() => run('add', () => addChecklistItem(user, task.id, draft), () => setDraft(''))}
            />
          </View>
          <IconButton
            name="add-circle"
            label="Add needed item"
            onPress={() => run('add', () => addChecklistItem(user, task.id, draft), () => setDraft(''))}
          />
        </View>
        {task.checklist.length ? <Muted style={{ fontSize: 12 }}>Tap to tick off · long-press to remove</Muted> : null}
      </Card>
    </>
  );
}

// ---------------- Attachments ----------------

export function AttachmentsSection({ task, group, user }: Props) {
  const c = useTheme();
  const { busy, run } = useAction();

  const pick = async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow ${source === 'camera' ? 'camera' : 'photo'} access in settings to attach proof.`);
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    run('upload', () =>
      uploadAttachment(user, task, {
        uri: a.uri,
        name: a.fileName ?? `photo-${Date.now()}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
        size: a.fileSize,
      }),
    );
  };

  return (
    <>
      <SectionTitle>Proof & files</SectionTitle>
      <Card style={{ gap: space.md }}>
        {task.attachments.length === 0 ? <Muted>Attach photos of receipts, documents or finished work.</Muted> : null}
        {task.attachments.map((a) => {
          const canRemove = a.uploadedBy === user.uid || canEditDetails(task, group, user.uid);
          return (
            <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Ionicons name={a.contentType.startsWith('image/') ? 'image-outline' : 'document-outline'} size={22} color={c.primary} />
              <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(a.url)} accessibilityRole="link">
                <Body numberOfLines={1}>{a.name}</Body>
                <Muted style={{ fontSize: 12 }}>
                  {a.uploadedByName} · {formatDue(a.uploadedAt)}
                </Muted>
              </Pressable>
              {canRemove ? (
                <IconButton
                  name="trash-outline"
                  label={`Remove ${a.name}`}
                  color={c.danger}
                  onPress={() =>
                    Alert.alert('Remove file?', a.name, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => run('rm', () => removeAttachment(user, task.id, a)) },
                    ])
                  }
                />
              ) : null}
            </View>
          );
        })}
        {task.attachments.length < LIMITS.attachments ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Camera" icon="camera-outline" variant="secondary" compact loading={busy === 'upload'} onPress={() => pick('camera')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Gallery" icon="images-outline" variant="secondary" compact disabled={busy === 'upload'} onPress={() => pick('library')} />
            </View>
          </View>
        ) : null}
      </Card>
    </>
  );
}

// ---------------- Reminders (this device) ----------------

export function RemindersSection({ task }: Props) {
  const c = useTheme();
  const { run } = useAction();
  const [list, setList] = useState<{ id: string; atMs: number }[]>([]);
  const refresh = useCallback(() => listCustomReminders(task.id).then(setList).catch(() => {}), [task.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = (at: Date) => run('add', () => addCustomReminder(task, at), refresh);
  const inOneHour = () => new Date(Date.now() + 3_600_000);
  const tomorrow9 = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const due = task.dueAt?.toMillis() ?? null;

  if (task.status === 'done') return null;
  return (
    <>
      <SectionTitle>Remind me</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip label="In 1 hour" onPress={() => add(inOneHour())} />
          <Chip label="Tomorrow 9 AM" onPress={() => add(tomorrow9())} />
          {due && due - 86_400_000 > Date.now() ? <Chip label="1 day before due" onPress={() => add(new Date(due - 86_400_000))} /> : null}
          <Chip label="Pick time…" onPress={() => pickDateTime(inOneHour(), add)} />
        </View>
        {list.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Ionicons name="alarm-outline" size={18} color={c.muted} />
            <Body style={{ flex: 1 }}>{formatDue(r.atMs)}</Body>
            <IconButton name="close-circle-outline" label="Cancel reminder" onPress={() => run('cancel', () => cancelCustomReminder(task.id, r.id), refresh)} />
          </View>
        ))}
        <Muted style={{ fontSize: 12 }}>Reminders are set on this phone only.</Muted>
      </Card>
    </>
  );
}

// ---------------- Comments ----------------

export function CommentsSection({ task, group, user }: Props) {
  const c = useTheme();
  const comments = useComments(task.id);
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const others = group.memberIds.filter((u) => u !== user.uid);

  return (
    <>
      <SectionTitle>Discussion</SectionTitle>
      <Card style={{ gap: space.md }}>
        {comments.error ? <Muted style={{ color: c.danger }}>{comments.error}</Muted> : null}
        {comments.data?.length === 0 ? <Muted>No messages yet. Ask a question or post an update.</Muted> : null}
        {comments.data?.map((m) => (
          <View key={m.id} style={{ flexDirection: 'row', gap: space.sm }}>
            <Avatar name={m.authorName} size={28} />
            <View
              style={{
                flex: 1,
                backgroundColor: m.authorId === user.uid ? c.primarySoft : c.bg,
                borderRadius: radius.md,
                padding: space.sm,
              }}
            >
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 13 }}>
                {m.authorName}
                <Text style={{ color: c.muted, fontWeight: '400' }}>
                  {m.createdAt ? `  ·  ${formatDue(m.createdAt.toMillis())}` : '  ·  sending…'}
                </Text>
              </Text>
              <Body>{m.text}</Body>
            </View>
          </View>
        ))}
        <TextField
          value={text}
          onChangeText={setText}
          placeholder="Write an update… use @name to notify someone"
          multiline
          maxLength={LIMITS.comment}
        />
        {others.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {others.slice(0, 8).map((u) => (
              <Chip
                key={u}
                label={`@${group.members[u]?.name}`}
                onPress={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${group.members[u]?.name} `)}
              />
            ))}
          </View>
        ) : null}
        <Button
          title="Send"
          icon="send"
          compact
          disabled={!text.trim()}
          loading={busy === 'send'}
          onPress={() => run('send', () => addComment(user, group, task.id, text), () => setText(''))}
        />
      </Card>
    </>
  );
}

// ---------------- Activity ----------------

export function ActivitySection({ task }: { task: Task }) {
  const c = useTheme();
  const activity = useActivity(task.id);
  const [open, setOpen] = useState(false);
  const items = activity.data ?? [];
  return (
    <>
      <SectionTitle
        right={<Button title={open ? 'Hide' : `Show (${items.length})`} variant="ghost" compact onPress={() => setOpen((o) => !o)} />}
      >
        Activity
      </SectionTitle>
      {open ? (
        <Card style={{ gap: space.sm }}>
          {items.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.primary, marginTop: 8 }} />
              <View style={{ flex: 1 }}>
                <Body>
                  <Text style={{ fontWeight: '600' }}>{a.actorName}</Text> {a.message}
                </Body>
                <Muted style={{ fontSize: 12 }}>{a.createdAt ? formatDue(a.createdAt.toMillis()) : 'just now'}</Muted>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}
