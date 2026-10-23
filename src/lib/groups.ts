import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { AppUser } from './auth';
import { fbDb } from './firebase';
import {
  generateInviteCode,
  INVITE_TTL_DAYS,
  isValidInviteCode,
  LIMITS,
  normalizeInviteCode,
  trimTo,
} from './logic';
import type { Group, Role } from './types';

const groupsCol = () => collection(fbDb(), 'groups');

function inviteExpiry(): Timestamp {
  return Timestamp.fromMillis(Date.now() + INVITE_TTL_DAYS * 86_400_000);
}

function toGroup(id: string, data: Record<string, unknown>): Group {
  return { id, ...(data as Omit<Group, 'id'>) };
}

export function subscribeMyGroups(uid: string, onData: (g: Group[]) => void, onError: (e: Error) => void) {
  const q = query(groupsCol(), where('memberIds', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => toGroup(d.id, d.data()));
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list);
    },
    onError,
  );
}

export function subscribeGroup(id: string, onData: (g: Group | null) => void, onError: (e: Error) => void) {
  return onSnapshot(
    doc(groupsCol(), id),
    (snap) => onData(snap.exists() ? toGroup(snap.id, snap.data()) : null),
    onError,
  );
}

export async function createGroup(user: AppUser, name: string, description: string): Promise<string> {
  const cleanName = trimTo(name, LIMITS.groupName);
  if (!cleanName) throw new Error('Group name is required.');
  // An invite-code collision makes the batch fail (the rules forbid overwriting a code), so retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = doc(groupsCol());
    const code = generateInviteCode();
    const expiresAt = inviteExpiry();
    const batch = writeBatch(fbDb());
    batch.set(ref, {
      name: cleanName,
      description: trimTo(description, LIMITS.groupDescription),
      ownerId: user.uid,
      memberIds: [user.uid],
      members: { [user.uid]: { name: user.displayName, role: 'owner' } },
      inviteCode: code,
      inviteExpiresAt: expiresAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(fbDb(), 'inviteCodes', code), {
      groupId: ref.id,
      createdBy: user.uid,
      expiresAt,
    });
    try {
      await batch.commit();
      return ref.id;
    } catch (e) {
      if (attempt === 2 || (e as { code?: string }).code !== 'permission-denied') throw e;
    }
  }
  throw new Error('Could not create group. Please try again.');
}

export async function joinGroupByCode(user: AppUser, rawCode: string): Promise<string> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) throw new Error('Invite codes are 6 letters/numbers.');
  const invite = await getDoc(doc(fbDb(), 'inviteCodes', code));
  if (!invite.exists()) throw new Error('Invite code not found.');
  const { groupId, expiresAt } = invite.data() as { groupId: string; expiresAt: Timestamp };
  if (expiresAt.toMillis() < Date.now()) throw new Error('This invite has expired. Ask for a new code.');

  // Already a member? (Non-members cannot read the group, so a permission error means "not yet".)
  try {
    const g = await getDoc(doc(groupsCol(), groupId));
    if (g.exists() && (g.data().memberIds as string[]).includes(user.uid)) return groupId;
  } catch {
    /* expected for non-members */
  }

  try {
    await updateDoc(doc(groupsCol(), groupId), {
      memberIds: arrayUnion(user.uid),
      [`members.${user.uid}`]: { name: user.displayName, role: 'member' },
      joinCodeUsed: code,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') {
      throw new Error('This invite is no longer valid. Ask for a new code.');
    }
    throw e;
  }
  return groupId;
}

export async function regenerateInvite(group: Group, uid: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateInviteCode();
    const expiresAt = inviteExpiry();
    const batch = writeBatch(fbDb());
    batch.set(doc(fbDb(), 'inviteCodes', code), { groupId: group.id, createdBy: uid, expiresAt });
    batch.update(doc(groupsCol(), group.id), {
      inviteCode: code,
      inviteExpiresAt: expiresAt,
      updatedAt: serverTimestamp(),
    });
    batch.delete(doc(fbDb(), 'inviteCodes', group.inviteCode));
    try {
      await batch.commit();
      return code;
    } catch (e) {
      if (attempt === 2 || (e as { code?: string }).code !== 'permission-denied') throw e;
    }
  }
  throw new Error('Could not create a new code.');
}

export async function updateGroupInfo(group: Group, name: string, description: string) {
  const cleanName = trimTo(name, LIMITS.groupName);
  if (!cleanName) throw new Error('Group name is required.');
  await updateDoc(doc(groupsCol(), group.id), {
    name: cleanName,
    description: trimTo(description, LIMITS.groupDescription),
    updatedAt: serverTimestamp(),
  });
}

/** Leave (self) or remove another member (admins). Owners cannot be removed. */
export async function removeMember(group: Group, uid: string) {
  if (group.ownerId === uid) throw new Error('The owner cannot leave. Transfer ownership or delete the group.');
  await updateDoc(doc(groupsCol(), group.id), {
    memberIds: arrayRemove(uid),
    [`members.${uid}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function setMemberRole(group: Group, uid: string, role: Exclude<Role, 'owner'>) {
  await updateDoc(doc(groupsCol(), group.id), {
    [`members.${uid}.role`]: role,
    updatedAt: serverTimestamp(),
  });
}

/** Owner only. Tasks are deleted here; their comments/activity/files are cleaned up by Cloud Functions. */
export async function deleteGroup(group: Group) {
  const tasks = await getDocs(query(collection(fbDb(), 'tasks'), where('groupId', '==', group.id)));
  const refs = tasks.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(fbDb());
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  const batch = writeBatch(fbDb());
  batch.delete(doc(fbDb(), 'inviteCodes', group.inviteCode));
  batch.delete(doc(groupsCol(), group.id));
  await batch.commit();
}
