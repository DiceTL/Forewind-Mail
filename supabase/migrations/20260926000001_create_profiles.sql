-- M2 T2.1: profiles — one row per user (time zone + pause switch).
--
-- Done when: `supabase db reset` applies cleanly; RLS rejects cross-user reads.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'UTC',
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users may only read/write their own row (user_id must equal the JWT subject).
create policy "Users manage own profile"
  on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
