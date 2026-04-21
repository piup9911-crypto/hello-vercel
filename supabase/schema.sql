create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.mini_notion_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  icon text not null default '📄',
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists mini_notion_notes_user_updated_idx
  on public.mini_notion_notes (user_id, updated_at desc);

drop trigger if exists mini_notion_notes_set_updated_at on public.mini_notion_notes;
create trigger mini_notion_notes_set_updated_at
before update on public.mini_notion_notes
for each row
execute function public.set_updated_at();

alter table public.mini_notion_notes enable row level security;

drop policy if exists "Users can read own mini notion notes" on public.mini_notion_notes;
create policy "Users can read own mini notion notes"
on public.mini_notion_notes
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own mini notion notes" on public.mini_notion_notes;
create policy "Users can insert own mini notion notes"
on public.mini_notion_notes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own mini notion notes" on public.mini_notion_notes;
create policy "Users can update own mini notion notes"
on public.mini_notion_notes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own mini notion notes" on public.mini_notion_notes;
create policy "Users can delete own mini notion notes"
on public.mini_notion_notes
for delete
to authenticated
using (auth.uid() = user_id);

create table if not exists public.secret_diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  mood text not null default 'calm',
  memory_mode text not null default 'private',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists secret_diary_entries_user_updated_idx
  on public.secret_diary_entries (user_id, updated_at desc);

drop trigger if exists secret_diary_entries_set_updated_at on public.secret_diary_entries;
create trigger secret_diary_entries_set_updated_at
before update on public.secret_diary_entries
for each row
execute function public.set_updated_at();

alter table public.secret_diary_entries enable row level security;

drop policy if exists "Users can read own secret diary entries" on public.secret_diary_entries;
create policy "Users can read own secret diary entries"
on public.secret_diary_entries
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own secret diary entries" on public.secret_diary_entries;
create policy "Users can insert own secret diary entries"
on public.secret_diary_entries
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own secret diary entries" on public.secret_diary_entries;
create policy "Users can update own secret diary entries"
on public.secret_diary_entries
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own secret diary entries" on public.secret_diary_entries;
create policy "Users can delete own secret diary entries"
on public.secret_diary_entries
for delete
to authenticated
using (auth.uid() = user_id);

create table if not exists public.agent_shared_memory (
  memory_key text primary key,
  content text not null default '',
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.agent_shared_memory (memory_key, content)
values ('primary', '')
on conflict (memory_key) do nothing;

drop trigger if exists agent_shared_memory_set_updated_at on public.agent_shared_memory;
create trigger agent_shared_memory_set_updated_at
before update on public.agent_shared_memory
for each row
execute function public.set_updated_at();

alter table public.agent_shared_memory enable row level security;

drop policy if exists "Authenticated users can read shared memory" on public.agent_shared_memory;
create policy "Authenticated users can read shared memory"
on public.agent_shared_memory
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert shared memory" on public.agent_shared_memory;
create policy "Authenticated users can insert shared memory"
on public.agent_shared_memory
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update shared memory" on public.agent_shared_memory;
create policy "Authenticated users can update shared memory"
on public.agent_shared_memory
for update
to authenticated
using (true)
with check (true);
