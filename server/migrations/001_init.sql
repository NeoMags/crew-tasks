-- Crew Tasks schema (application tables).
-- Better Auth creates/maintains its own tables ("user", "session", "account", "verification")
-- via scripts/migrate.ts before this file runs. User ids are text.

create table if not exists groups (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 60),
  description       text not null default '' check (length(description) <= 300),
  owner_id          text not null references "user"(id) on delete restrict,
  invite_code       text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  invite_expires_at timestamptz not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists groups_owner_idx on groups (owner_id);

create table if not exists group_members (
  group_id  uuid not null references groups(id) on delete cascade,
  user_id   text not null references "user"(id) on delete cascade,
  role      text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on group_members (user_id);
-- exactly one owner per group
create unique index if not exists group_members_one_owner on group_members (group_id) where role = 'owner';

create table if not exists tasks (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references groups(id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 120),
  description       text not null default '' check (length(description) <= 2000),
  created_by        text not null references "user"(id) on delete restrict,
  status            text not null default 'todo'
                      check (status in ('todo', 'in_progress', 'blocked', 'review', 'done')),
  blocked_reason    text not null default '' check (length(blocked_reason) <= 300),
  requires_approval boolean not null default false,
  priority          text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  progress          smallint not null default 0 check (progress between 0 and 100),
  due_at            timestamptz,
  recurrence        text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  next_task_id      uuid unique references tasks(id) on delete set null,
  recurred_from     uuid references tasks(id) on delete set null,
  overdue_notified  boolean not null default false,
  updated_by        text references "user"(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint recurring_needs_due check (recurrence = 'none' or due_at is not null)
);
create index if not exists tasks_group_idx on tasks (group_id);
create index if not exists tasks_created_by_idx on tasks (created_by);
create index if not exists tasks_recurred_from_idx on tasks (recurred_from);
create index if not exists tasks_updated_by_idx on tasks (updated_by);
-- overdue scan: open tasks with a due date that haven't been announced
create index if not exists tasks_overdue_scan_idx on tasks (due_at)
  where overdue_notified = false and status <> 'done' and due_at is not null;

create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user_idx on task_assignees (user_id);

-- "What's needed": items to be furnished for a task
create table if not exists checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  text       text not null check (length(btrim(text)) between 1 and 200),
  done       boolean not null default false,
  done_by    text references "user"(id) on delete set null,
  done_at    timestamptz,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists checklist_items_task_idx on checklist_items (task_id, position);
create index if not exists checklist_items_done_by_idx on checklist_items (done_by);

create table if not exists attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id) on delete cascade,
  name         text not null check (length(name) between 1 and 120),
  url          text not null,
  pathname     text not null,
  content_type text not null,
  size_bytes   integer not null check (size_bytes >= 0),
  uploaded_by  text references "user"(id) on delete set null,
  uploaded_at  timestamptz not null default now()
);
create index if not exists attachments_task_idx on attachments (task_id);
create index if not exists attachments_uploaded_by_idx on attachments (uploaded_by);

create table if not exists comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  author_id  text references "user"(id) on delete set null,
  text       text not null check (length(btrim(text)) between 1 and 1000),
  mentions   text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists comments_task_idx on comments (task_id, created_at);
create index if not exists comments_author_idx on comments (author_id);

-- Append-only audit trail
create table if not exists activity (
  id         bigint generated always as identity primary key,
  task_id    uuid not null references tasks(id) on delete cascade,
  actor_id   text references "user"(id) on delete set null,
  type       text not null
               check (type in ('created', 'status', 'progress', 'assigned', 'edited', 'checklist', 'attachment', 'recurred')),
  message    text not null check (length(message) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists activity_task_idx on activity (task_id, created_at desc);
create index if not exists activity_actor_idx on activity (actor_id);

-- Expo push tokens
create table if not exists devices (
  token      text primary key check (length(token) <= 4096),
  user_id    text not null references "user"(id) on delete cascade,
  platform   text not null default 'android' check (length(platform) <= 20),
  updated_at timestamptz not null default now()
);
create index if not exists devices_user_idx on devices (user_id);

-- In-app notification inbox (works without any push provider)
create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    text not null references "user"(id) on delete cascade,
  task_id    uuid references tasks(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on notifications (user_id) where read_at is null;
create index if not exists notifications_task_idx on notifications (task_id);

-- Small key/value table for housekeeping (e.g. last overdue scan time)
create table if not exists app_meta (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
