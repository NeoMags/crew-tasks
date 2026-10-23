/**
 * Security-rules tests against the Firestore + Storage emulators.
 * Run: cd tests && npm run test:rules
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';

let env: RulesTestEnvironment;
const G = 'g1';
const CODE = 'ABC234';

const db = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore() as unknown as Firestore;

const inDays = (d: number) => Timestamp.fromMillis(Date.now() + d * 86_400_000);

function groupDoc(extra: Record<string, unknown> = {}) {
  return {
    name: 'Trip crew',
    description: '',
    ownerId: 'owner',
    memberIds: ['owner', 'admin', 'm1', 'm2'],
    members: {
      owner: { name: 'Asha', role: 'owner' },
      admin: { name: 'Bala', role: 'admin' },
      m1: { name: 'Chetan', role: 'member' },
      m2: { name: 'Divya', role: 'member' },
    },
    inviteCode: CODE,
    inviteExpiresAt: inDays(5),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extra,
  };
}

function taskDoc(extra: Record<string, unknown> = {}) {
  return {
    groupId: G,
    groupName: 'Trip crew',
    title: 'Book bus tickets',
    description: '',
    assigneeIds: ['m1'],
    createdBy: 'm2',
    createdByName: 'Divya',
    status: 'todo',
    blockedReason: '',
    requiresApproval: false,
    priority: 'medium',
    progress: 0,
    dueAt: inDays(2),
    recurrence: 'none',
    checklist: [],
    attachments: [],
    nextTaskId: null,
    recurredFrom: null,
    overdueNotified: false,
    updatedBy: 'm2',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    completedAt: null,
    ...extra,
  };
}

async function seed(fn: (d: Firestore) => Promise<void>) {
  await env.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore() as unknown as Firestore));
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-crew-tasks',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
});

after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (d) => {
    await setDoc(doc(d, 'groups', G), groupDoc());
    await setDoc(doc(d, 'inviteCodes', CODE), { groupId: G, createdBy: 'owner', expiresAt: inDays(5) });
    await setDoc(doc(d, 'tasks', 't1'), taskDoc());
  });
});

describe('groups', () => {
  test('owner creates group together with its invite code', async () => {
    const d = db('newbie');
    const b = writeBatch(d);
    b.set(doc(d, 'groups', 'g2'), {
      name: 'Flatmates',
      description: '',
      ownerId: 'newbie',
      memberIds: ['newbie'],
      members: { newbie: { name: 'New', role: 'owner' } },
      inviteCode: 'XYZ789',
      inviteExpiresAt: inDays(7),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    b.set(doc(d, 'inviteCodes', 'XYZ789'), { groupId: 'g2', createdBy: 'newbie', expiresAt: inDays(7) });
    await assertSucceeds(b.commit());
  });

  test('cannot create a group listing other members or without its invite doc', async () => {
    const d = db('newbie');
    await assertFails(
      setDoc(doc(d, 'groups', 'g3'), {
        name: 'X', description: '', ownerId: 'newbie', memberIds: ['newbie', 'victim'],
        members: { newbie: { name: 'N', role: 'owner' }, victim: { name: 'V', role: 'member' } },
        inviteCode: 'QQQ222', inviteExpiresAt: inDays(7), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(d, 'groups', 'g3'), {
        name: 'X', description: '', ownerId: 'newbie', memberIds: ['newbie'],
        members: { newbie: { name: 'N', role: 'owner' } },
        inviteCode: 'QQQ222', inviteExpiresAt: inDays(7), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  test('cannot hijack an existing invite code', async () => {
    await assertFails(setDoc(doc(db('newbie'), 'inviteCodes', CODE), { groupId: 'evil', createdBy: 'newbie', expiresAt: inDays(1) }));
  });

  test('only members read a group; invite codes are gettable, not listable', async () => {
    await assertSucceeds(getDoc(doc(db('m1'), 'groups', G)));
    await assertFails(getDoc(doc(db('stranger'), 'groups', G)));
    await assertFails(getDoc(doc(db(null), 'groups', G)));
    await assertSucceeds(getDoc(doc(db('stranger'), 'inviteCodes', CODE)));
    await assertFails(getDocs(collection(db('stranger'), 'inviteCodes')));
  });

  const join = (d: Firestore, uid: string, code: string, role = 'member') =>
    updateDoc(doc(d, 'groups', G), {
      memberIds: arrayUnion(uid),
      [`members.${uid}`]: { name: 'Eshan', role },
      joinCodeUsed: code,
      updatedAt: serverTimestamp(),
    });

  test('join with the right code as member', async () => {
    await assertSucceeds(join(db('stranger'), 'stranger', CODE));
  });

  test('join fails with wrong code, as admin, for someone else, or when expired', async () => {
    await assertFails(join(db('stranger'), 'stranger', 'ZZZ999'));
    await assertFails(join(db('stranger'), 'stranger', CODE, 'admin'));
    await assertFails(join(db('stranger'), 'other', CODE));
    await seed(async (d) => updateDoc(doc(d, 'groups', G), { inviteExpiresAt: Timestamp.fromMillis(Date.now() - 1000) }));
    await assertFails(join(db('stranger'), 'stranger', CODE));
  });

  const remove = (d: Firestore, uid: string) =>
    updateDoc(doc(d, 'groups', G), { memberIds: arrayRemove(uid), [`members.${uid}`]: deleteField(), updatedAt: serverTimestamp() });

  test('members leave; owner cannot; members cannot remove others; admins can', async () => {
    await assertSucceeds(remove(db('m1'), 'm1'));
    await assertFails(remove(db('owner'), 'owner'));
    await assertFails(remove(db('m2'), 'admin'));
    await assertSucceeds(remove(db('admin'), 'm2'));
  });

  test('members rename themselves but not others or their role', async () => {
    const d = db('m1');
    await assertSucceeds(updateDoc(doc(d, 'groups', G), { 'members.m1.name': 'Chetan K', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(d, 'groups', G), { 'members.m2.name': 'Hacked', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(d, 'groups', G), { 'members.m1.role': 'admin', updatedAt: serverTimestamp() }));
  });

  test('only the owner changes roles', async () => {
    const promote = (d: Firestore) => updateDoc(doc(d, 'groups', G), { 'members.m1.role': 'admin', updatedAt: serverTimestamp() });
    await assertFails(promote(db('m1')));
    await assertFails(promote(db('admin')));
    await assertSucceeds(promote(db('owner')));
  });

  test('admins rotate the invite code; members cannot', async () => {
    const rotate = (d: Firestore, uid: string, code: string) => {
      const b = writeBatch(d);
      b.set(doc(d, 'inviteCodes', code), { groupId: G, createdBy: uid, expiresAt: inDays(7) });
      b.update(doc(d, 'groups', G), { inviteCode: code, inviteExpiresAt: inDays(7), updatedAt: serverTimestamp() });
      b.delete(doc(d, 'inviteCodes', CODE));
      return b.commit();
    };
    await assertFails(rotate(db('m1'), 'm1', 'MMM333'));
    await assertSucceeds(rotate(db('admin'), 'admin', 'NNN444'));
  });

  test('only the owner deletes the group', async () => {
    await assertFails(env.authenticatedContext('admin').firestore().doc(`groups/${G}`).delete());
    await assertSucceeds(env.authenticatedContext('owner').firestore().doc(`groups/${G}`).delete());
  });
});

describe('tasks', () => {
  const newTask = (uid: string, extra: Record<string, unknown> = {}) => {
    const d = db(uid);
    const b = writeBatch(d);
    const t = doc(collection(d, 'tasks'));
    b.set(t, { ...taskDoc({ createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }), ...extra });
    b.set(doc(collection(d, 'tasks', t.id, 'activity')), {
      actorId: uid, actorName: 'X', type: 'created', message: 'created the task', createdAt: serverTimestamp(),
    });
    return b.commit();
  };

  test('members create tasks (with activity) for members only', async () => {
    await assertSucceeds(newTask('m1', { assigneeIds: ['m2', 'admin'] }));
    await assertFails(newTask('m1', { assigneeIds: ['stranger'] }));
    await assertFails(newTask('stranger'));
    await assertFails(newTask('m1', { status: 'done' }));
    await assertFails(newTask('m1', { createdBy: 'owner' }));
    await assertFails(newTask('m1', { title: '   ' }));
    await assertFails(newTask('m1', { recurrence: 'daily', dueAt: null }));
    await assertFails(newTask('m1', { isAdmin: true }));
  });

  test('queries: group board for members, "assigned to me", "created by me"', async () => {
    await assertSucceeds(getDocs(query(collection(db('admin'), 'tasks'), where('groupId', '==', G))));
    await assertFails(getDocs(query(collection(db('stranger'), 'tasks'), where('groupId', '==', G))));
    await assertSucceeds(getDocs(query(collection(db('m1'), 'tasks'), where('assigneeIds', 'array-contains', 'm1'))));
    await assertFails(getDocs(query(collection(db('stranger'), 'tasks'), where('assigneeIds', 'array-contains', 'm1'))));
    await assertSucceeds(getDocs(query(collection(db('m2'), 'tasks'), where('createdBy', '==', 'm2'))));
    await assertFails(getDocs(collection(db('m1'), 'tasks')));
  });

  const upd = (uid: string, patch: Record<string, unknown>) =>
    updateDoc(doc(db(uid), 'tasks', 't1'), { ...patch, updatedBy: uid, updatedAt: serverTimestamp() });

  test('assignee and creator change status; other members cannot', async () => {
    await assertSucceeds(upd('m1', { status: 'in_progress', progress: 30 }));
    await assertSucceeds(upd('admin', { status: 'blocked' }));
    await assertFails(upd('owner', { progress: 300 }));
    await assertFails(upd('stranger', { status: 'done' }));
    await assertSucceeds(upd('m2', { status: 'blocked', blockedReason: 'waiting for money' }));
  });

  test('non-assignee members may only touch checklist/attachments', async () => {
    // add a second plain member who is neither creator nor assignee
    await seed(async (d) =>
      updateDoc(doc(d, 'groups', G), { memberIds: arrayUnion('m3'), 'members.m3': { name: 'Farah', role: 'member' } }),
    );
    await assertSucceeds(upd('m3', { checklist: [{ id: 'c1', text: 'ID copy', done: true, doneBy: 'm3', doneByName: 'Farah', doneAt: 1 }] }));
    await assertFails(upd('m3', { status: 'done' }));
    await assertFails(upd('m3', { title: 'renamed' }));
    await assertFails(upd('m1', { title: 'renamed by assignee' }));
    await assertSucceeds(upd('m2', { title: 'renamed by creator' }));
    await assertFails(upd('m2', { assigneeIds: ['stranger'] }));
    await assertFails(upd('m2', { createdBy: 'm3' }));
    await assertFails(upd('m2', { groupId: 'other' }));
    await assertFails(updateDoc(doc(db('m1'), 'tasks', 't1'), { status: 'in_progress', updatedBy: 'm2' }));
  });

  test('any member can pick up an unassigned task, only for themselves', async () => {
    await seed(async (d) => updateDoc(doc(d, 'tasks', 't1'), { assigneeIds: [] }));
    await assertFails(upd('m1', { assigneeIds: ['m2'] }));
    await assertFails(upd('m1', { assigneeIds: ['m1', 'm2'] }));
    await assertSucceeds(upd('m1', { assigneeIds: ['m1'] }));
    // already taken: another plain member cannot take it over
    await seed(async (d) =>
      updateDoc(doc(d, 'groups', G), { memberIds: arrayUnion('m3'), 'members.m3': { name: 'Farah', role: 'member' } }),
    );
    await assertFails(upd('m3', { assigneeIds: ['m3'] }));
  });

  test('approval-required tasks: assignee submits for review, creator approves', async () => {
    await seed(async (d) => updateDoc(doc(d, 'tasks', 't1'), { requiresApproval: true }));
    await assertFails(upd('m1', { status: 'done', progress: 100, completedAt: serverTimestamp() }));
    await assertSucceeds(upd('m1', { status: 'review' }));
    await assertSucceeds(upd('m2', { status: 'done', progress: 100, completedAt: serverTimestamp() }));
  });

  test('completing a recurring task spawns exactly one next occurrence', async () => {
    await seed(async (d) => updateDoc(doc(d, 'tasks', 't1'), { recurrence: 'weekly' }));
    const complete = async (uid: string, nextId: string) => {
      const d = db(uid);
      await runTransaction(d, async (tx) => {
        const cur = await tx.get(doc(d, 'tasks', 't1'));
        const g = await tx.get(doc(d, 'groups', G));
        void g;
        tx.set(doc(d, 'tasks', nextId), {
          ...taskDoc({ recurrence: 'weekly', recurredFrom: 't1', updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
          createdBy: cur.data()!.createdBy,
          createdByName: cur.data()!.createdByName,
        });
        tx.update(doc(d, 'tasks', 't1'), {
          status: 'done', progress: 100, completedAt: serverTimestamp(), nextTaskId: nextId, updatedBy: uid, updatedAt: serverTimestamp(),
        });
      });
    };
    await assertSucceeds(complete('m1', 'next1'));
    // t1 already points at next1, so a second "next occurrence" is rejected.
    const d1 = db('m1');
    const second = runTransaction(d1, async (tx) => {
      tx.set(doc(d1, 'tasks', 'next2'), taskDoc({ recurredFrom: 't1', updatedBy: 'm1', createdBy: 'm2' }));
      tx.update(doc(d1, 'tasks', 't1'), { nextTaskId: 'next2', updatedBy: 'm1', updatedAt: serverTimestamp() });
    });
    await assertFails(second);
    let next: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async (ctx) => {
      next = (await ctx.firestore().doc('tasks/next1').get()).data();
    });
    if (next?.createdBy !== 'm2') throw new Error('next occurrence should keep the original assigner');
    // forging a "recurrence" without completing the parent is rejected
    await assertFails(setDoc(doc(db('m1'), 'tasks', 'forged'), taskDoc({ recurredFrom: 't1', updatedBy: 'm1', createdBy: 'owner' })));
  });

  test('only creator or admin deletes', async () => {
    await assertFails(env.authenticatedContext('m1').firestore().doc('tasks/t1').delete());
    await assertSucceeds(env.authenticatedContext('admin').firestore().doc('tasks/t1').delete());
  });
});

describe('comments and activity', () => {
  const comment = (uid: string, extra: Record<string, unknown> = {}) =>
    setDoc(doc(collection(db(uid), 'tasks', 't1', 'comments')), {
      authorId: uid, authorName: 'X', text: 'On it', mentions: [], createdAt: serverTimestamp(), ...extra,
    });

  test('members comment as themselves', async () => {
    await assertSucceeds(comment('admin'));
    await assertFails(comment('stranger'));
    await assertFails(comment('m1', { authorId: 'm2' }));
    await assertFails(comment('m1', { text: '' }));
    await assertSucceeds(getDocs(collection(db('m1'), 'tasks', 't1', 'comments')));
    await assertFails(getDocs(collection(db('stranger'), 'tasks', 't1', 'comments')));
  });

  test('activity is append-only', async () => {
    await seed(async (d) =>
      setDoc(doc(d, 'tasks', 't1', 'activity', 'a1'), { actorId: 'm1', actorName: 'C', type: 'status', message: 'x', createdAt: Timestamp.now() }),
    );
    await assertFails(updateDoc(doc(db('m1'), 'tasks', 't1', 'activity', 'a1'), { message: 'rewritten' }));
    await assertFails(env.authenticatedContext('m1').firestore().doc('tasks/t1/activity/a1').delete());
    await assertFails(
      setDoc(doc(db('m1'), 'tasks', 't1', 'activity', 'a2'), { actorId: 'm2', actorName: 'D', type: 'status', message: 'x', createdAt: serverTimestamp() }),
    );
  });
});

describe('users and devices', () => {
  test('users manage only their own profile and device tokens', async () => {
    await assertSucceeds(setDoc(doc(db('m1'), 'users', 'm1'), { displayName: 'Chetan', email: 'c@x.com', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('m1'), 'users', 'm2'), { displayName: 'Hacked', email: '', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db('m1'), 'users', 'm1', 'devices', 'd1'), { token: 'tok', platform: 'android', updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(db('m2'), 'users', 'm1', 'devices', 'd1')));
  });
});

describe('storage', () => {
  test('members upload images/PDFs under 10 MB; outsiders cannot', async () => {
    const st = (uid: string) => env.authenticatedContext(uid).storage();
    const small = new Uint8Array([1, 2, 3]);
    await assertSucceeds(uploadBytes(ref(st('m1') as never, 'tasks/t1/a.jpg'), small, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(st('stranger') as never, 'tasks/t1/b.jpg'), small, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(st('m1') as never, 'tasks/t1/c.exe'), small, { contentType: 'application/x-msdownload' }));
  });
});
