/**
 * Pure decision logic: who gets notified about what. No Firebase imports, so it is unit-tested directly.
 */

export interface TaskLike {
  title: string;
  groupName: string;
  assigneeIds: string[];
  createdBy: string;
  status: string;
  blockedReason?: string;
  updatedBy?: string;
}

export interface Note {
  uids: string[];
  title: string;
  body: string;
}

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  review: 'In review',
  done: 'Done',
};

const uniqWithout = (uids: string[], ...exclude: (string | undefined)[]) =>
  [...new Set(uids)].filter((u) => u && !exclude.includes(u));

export function onCreatedNotes(task: TaskLike, actorName: string): Note[] {
  const to = uniqWithout(task.assigneeIds, task.createdBy);
  if (!to.length) return [];
  return [{ uids: to, title: `New task from ${actorName}`, body: `${task.title} · ${task.groupName}` }];
}

export function onUpdatedNotes(before: TaskLike, after: TaskLike, actorName: string): Note[] {
  const actor = after.updatedBy;
  const notes: Note[] = [];

  const added = uniqWithout(after.assigneeIds.filter((u) => !before.assigneeIds.includes(u)), actor);
  if (added.length) {
    notes.push({ uids: added, title: `${actorName} assigned you a task`, body: `${after.title} · ${after.groupName}` });
  }

  if (before.status !== after.status || (after.status === 'blocked' && before.blockedReason !== after.blockedReason)) {
    // Everyone involved except whoever made the change and people just told about it above.
    const to = uniqWithout([after.createdBy, ...after.assigneeIds], actor, ...added);
    if (to.length) {
      const reason = after.status === 'blocked' && after.blockedReason ? ` — ${after.blockedReason}` : '';
      const title =
        after.status === 'review'
          ? `${actorName} submitted a task for review`
          : after.status === 'done'
            ? `${actorName} completed a task`
            : `${actorName} marked a task ${STATUS_LABEL[after.status] ?? after.status}`;
      notes.push({ uids: to, title, body: `${after.title}${reason}` });
    }
  }
  return notes;
}

export function onCommentNotes(
  task: TaskLike,
  comment: { authorId: string; authorName: string; text: string; mentions: string[] },
  memberIds: string[],
): Note[] {
  const preview = comment.text.length > 120 ? comment.text.slice(0, 117) + '…' : comment.text;
  const mentioned = uniqWithout(comment.mentions.filter((u) => memberIds.includes(u)), comment.authorId);
  const involved = uniqWithout([task.createdBy, ...task.assigneeIds], comment.authorId, ...mentioned).filter((u) =>
    memberIds.includes(u),
  );
  const notes: Note[] = [];
  if (mentioned.length) notes.push({ uids: mentioned, title: `${comment.authorName} mentioned you · ${task.title}`, body: preview });
  if (involved.length) notes.push({ uids: involved, title: `${comment.authorName} · ${task.title}`, body: preview });
  return notes;
}

export function overdueNote(task: TaskLike): Note | null {
  const to = uniqWithout([...task.assigneeIds, task.createdBy]);
  return to.length ? { uids: to, title: `Overdue: ${task.title}`, body: task.groupName } : null;
}
