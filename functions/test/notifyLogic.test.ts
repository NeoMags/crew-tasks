import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onCommentNotes, onCreatedNotes, onUpdatedNotes, overdueNote, type TaskLike } from '../src/notifyLogic.ts';

const base: TaskLike = {
  title: 'Book tickets',
  groupName: 'Trip',
  assigneeIds: ['a', 'b'],
  createdBy: 'boss',
  status: 'todo',
  updatedBy: 'boss',
};

test('new task notifies assignees except the creator', () => {
  assert.deepEqual(onCreatedNotes(base, 'Boss')[0]!.uids, ['a', 'b']);
  assert.deepEqual(onCreatedNotes({ ...base, assigneeIds: ['boss'] }, 'Boss'), []);
});

test('status change notifies creator and other assignees, never the actor', () => {
  const notes = onUpdatedNotes(base, { ...base, status: 'done', updatedBy: 'a' }, 'Asha');
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0]!.uids.sort(), ['b', 'boss']);
  assert.match(notes[0]!.title, /completed/);
});

test('blocked includes the reason; review is phrased for approval', () => {
  const blocked = onUpdatedNotes(base, { ...base, status: 'blocked', blockedReason: 'no money', updatedBy: 'a' }, 'Asha');
  assert.match(blocked[0]!.body, /no money/);
  const review = onUpdatedNotes(base, { ...base, status: 'review', updatedBy: 'a' }, 'Asha');
  assert.match(review[0]!.title, /review/);
});

test('newly added assignees get an assignment note and are not double-notified', () => {
  const notes = onUpdatedNotes(base, { ...base, assigneeIds: ['a', 'b', 'c'], status: 'in_progress', updatedBy: 'boss' }, 'Boss');
  assert.deepEqual(notes[0]!.uids, ['c']);
  assert.deepEqual(notes[1]!.uids.sort(), ['a', 'b']);
});

test('no-op updates produce no notes', () => {
  assert.deepEqual(onUpdatedNotes(base, { ...base }, 'Boss'), []);
});

test('comments: mentions get their own note; author and non-members excluded', () => {
  const notes = onCommentNotes(base, { authorId: 'a', authorName: 'Asha', text: 'hi @Bala', mentions: ['b', 'ghost'] }, ['a', 'b', 'boss']);
  assert.deepEqual(notes[0]!.uids, ['b']);
  assert.match(notes[0]!.title, /mentioned you/);
  assert.deepEqual(notes[1]!.uids, ['boss']);
});

test('overdue goes to assignees and creator once each', () => {
  assert.deepEqual(overdueNote({ ...base, assigneeIds: ['boss', 'a'] })!.uids.sort(), ['a', 'boss']);
});
