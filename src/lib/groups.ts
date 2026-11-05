import { isValidInviteCode, LIMITS, normalizeInviteCode, trimTo } from '@shared/logic';
import type { Group, Role } from '@shared/types';
import type { AppUser } from './auth';
import { afterMutation, api } from './api';

export const fetchMyGroups = () => api<Group[]>('/api/groups');
export const fetchGroup = (id: string) => api<Group>(`/api/groups/${id}`);

export async function createGroup(_user: AppUser, name: string, description: string): Promise<string> {
  const cleanName = trimTo(name, LIMITS.groupName);
  if (!cleanName) throw new Error('Group name is required.');
  const g = await api<Group>('/api/groups', { json: { name: cleanName, description: trimTo(description, LIMITS.groupDescription) } });
  await afterMutation();
  return g.id;
}

export async function joinGroupByCode(_user: AppUser, rawCode: string): Promise<string> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) throw new Error('Invite codes are 6 letters/numbers.');
  const g = await api<Group>('/api/groups/join', { json: { code } });
  await afterMutation();
  return g.id;
}

export async function regenerateInvite(group: Group, _uid: string): Promise<string> {
  const g = await api<Group>(`/api/groups/${group.id}/invite`, { method: 'POST' });
  await afterMutation();
  return g.inviteCode;
}

export async function updateGroupInfo(group: Group, name: string, description: string) {
  const cleanName = trimTo(name, LIMITS.groupName);
  if (!cleanName) throw new Error('Group name is required.');
  await api(`/api/groups/${group.id}`, {
    method: 'PATCH',
    json: { name: cleanName, description: trimTo(description, LIMITS.groupDescription) },
  });
  await afterMutation();
}

/** Leave (self) or remove another member (admins). Owners cannot be removed. */
export async function removeMember(group: Group, uid: string) {
  if (group.ownerId === uid) throw new Error('The owner cannot leave. Delete the group instead.');
  await api(`/api/groups/${group.id}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  await afterMutation();
}

export async function setMemberRole(group: Group, uid: string, role: Exclude<Role, 'owner'>) {
  await api(`/api/groups/${group.id}/members/${encodeURIComponent(uid)}`, { method: 'PATCH', json: { role } });
  await afterMutation();
}

/** Owner only. Deletes the group and all its tasks for everyone. */
export async function deleteGroup(group: Group) {
  await api(`/api/groups/${group.id}`, { method: 'DELETE' });
  await afterMutation();
}
