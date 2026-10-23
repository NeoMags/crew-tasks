import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Avatar, Body, Button, Card, ErrorBanner, Loading, Muted, Screen, SectionTitle, TextField } from '../../../../components/ui';
import { useAction, useGroup } from '../../../../hooks/data';
import { useUser } from '../../../../lib/auth';
import { deleteGroup, regenerateInvite, removeMember, setMemberRole, updateGroupInfo } from '../../../../lib/groups';
import { isAdmin, LIMITS } from '../../../../lib/logic';
import { space, useTheme } from '../../../../theme';

export default function GroupSettings() {
  const c = useTheme();
  const user = useUser();
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (group.data) {
      setName(group.data.name);
      setDescription(group.data.description);
    }
  }, [group.data?.name, group.data?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  if (group.loading) return <Loading />;
  if (!group.data) return <Screen><ErrorBanner message={group.error ?? 'Group not found.'} /></Screen>;

  const g = group.data;
  const admin = isAdmin(g, user.uid);
  const owner = g.ownerId === user.uid;
  const expires = g.inviteExpiresAt.toDate();
  const expired = expires.getTime() < Date.now();

  const confirm = (title: string, msg: string, action: string, fn: () => void) =>
    Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: fn }]);

  return (
    <Screen>
      {admin ? (
        <>
          <SectionTitle>Details</SectionTitle>
          <Card>
            <TextField label="Name" value={name} onChangeText={setName} maxLength={LIMITS.groupName} />
            <TextField label="Description" value={description} onChangeText={setDescription} maxLength={LIMITS.groupDescription} multiline />
            <Button
              title="Save"
              variant="secondary"
              loading={busy === 'save'}
              disabled={!name.trim() || (name === g.name && description === g.description)}
              onPress={() => run('save', () => updateGroupInfo(g, name, description))}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Invite</SectionTitle>
      <Card>
        <Text style={{ color: c.text, fontSize: 32, fontWeight: '800', letterSpacing: 8, textAlign: 'center' }} selectable>
          {g.inviteCode}
        </Text>
        <Muted style={{ textAlign: 'center', color: expired ? c.danger : c.muted }}>
          {expired ? 'Expired' : 'Expires'} {expires.toLocaleDateString()}
        </Muted>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Copy"
              variant="secondary"
              icon="copy-outline"
              onPress={async () => {
                await Clipboard.setStringAsync(g.inviteCode);
                Alert.alert('Copied', 'Invite code copied.');
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Share"
              icon="share-social-outline"
              onPress={() =>
                Share.share({
                  message: `Join "${g.name}" on Crew Tasks. Invite code: ${g.inviteCode}\ncrewtasks://group/join?code=${g.inviteCode}`,
                })
              }
            />
          </View>
        </View>
        {admin ? (
          <Button
            title={expired ? 'Create new code' : 'Reset code (old one stops working)'}
            variant="ghost"
            loading={busy === 'code'}
            onPress={() => run('code', () => regenerateInvite(g, user.uid))}
          />
        ) : null}
      </Card>

      <SectionTitle>Members ({g.memberIds.length})</SectionTitle>
      <Card style={{ gap: space.md }}>
        {g.memberIds.map((uid) => {
          const m = g.members[uid];
          const isMe = uid === user.uid;
          const canRemove = admin && !isMe && uid !== g.ownerId;
          const canRole = owner && !isMe;
          return (
            <View key={uid} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Avatar name={m?.name ?? '?'} size={36} />
              <View style={{ flex: 1 }}>
                <Body>
                  {m?.name ?? 'Unknown'}
                  {isMe ? ' (you)' : ''}
                </Body>
                <Muted style={{ textTransform: 'capitalize' }}>{m?.role}</Muted>
              </View>
              {canRole ? (
                <Button
                  compact
                  variant="ghost"
                  title={m?.role === 'admin' ? 'Make member' : 'Make admin'}
                  onPress={() => run('role', () => setMemberRole(g, uid, m?.role === 'admin' ? 'member' : 'admin'))}
                />
              ) : null}
              {canRemove ? (
                <Button
                  compact
                  variant="danger"
                  title="Remove"
                  onPress={() =>
                    confirm('Remove member?', `${m?.name} will lose access to this group's tasks.`, 'Remove', () =>
                      run('remove', () => removeMember(g, uid)),
                    )
                  }
                />
              ) : null}
            </View>
          );
        })}
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      {!owner ? (
        <Button
          title="Leave group"
          variant="danger"
          icon="exit-outline"
          loading={busy === 'leave'}
          onPress={() =>
            confirm('Leave group?', 'You will lose access to its tasks.', 'Leave', () =>
              run('leave', () => removeMember(g, user.uid), () => router.replace('/groups')),
            )
          }
        />
      ) : (
        <Button
          title="Delete group"
          variant="danger"
          icon="trash-outline"
          loading={busy === 'delete'}
          onPress={() =>
            confirm('Delete group?', 'All tasks in this group are deleted for everyone. This cannot be undone.', 'Delete', () =>
              run('delete', () => deleteGroup(g), () => router.replace('/groups')),
            )
          }
        />
      )}
    </Screen>
  );
}
