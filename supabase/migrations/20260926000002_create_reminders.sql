-- M2 T2.2: reminders — title, optional deadline, repeat rule + toggle, status.
--
-- Done when: migration applies; RLS in place.

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) > 0),
  deadline timestamptz null,
  repeat_rule text null,
  repeat_enabled boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reminders_user_id_idx on public.reminders (user_id);

alter table public.reminders enable row level security;

-- Users may only read/write rows tied to their own user_id.
create policy "Users manage own reminders"
  on public.reminders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
