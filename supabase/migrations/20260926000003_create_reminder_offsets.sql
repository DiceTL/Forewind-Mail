-- M2 T2.3: reminder_offsets — one or more lead times per reminder.
--
-- Done when: migration applies; inserting a 3-minute offset is rejected
-- by the CHECK constraint.

create table public.reminder_offsets (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders (id) on delete cascade,
  offset_minutes integer not null
    check (offset_minutes >= 5 and offset_minutes % 5 = 0),
  created_at timestamptz not null default now()
);

create index reminder_offsets_reminder_id_idx
  on public.reminder_offsets (reminder_id);

alter table public.reminder_offsets enable row level security;

-- No user_id on this table, so ownership is checked through the parent
-- reminder row: the caller must own the reminder the offset belongs to.
create policy "Users manage offsets of own reminders"
  on public.reminder_offsets
  for all
  using (
    exists (
      select 1 from public.reminders
      where reminders.id = reminder_offsets.reminder_id
        and reminders.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.reminders
      where reminders.id = reminder_offsets.reminder_id
        and reminders.user_id = auth.uid()
    )
  );
