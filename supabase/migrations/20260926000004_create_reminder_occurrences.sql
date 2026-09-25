-- M2 T2.4: reminder_occurrences — one row per email to be sent.
--
-- Done when: migration applies; RLS in place; attempt_count and
-- last_attempted_at exist and are readable from the server client.
--
-- Why attempt_count / last_attempted_at: T4.5's "retry up to a configured
-- maximum" logic needs a durable place to track how many times an
-- occurrence has been retried across separate cron runs.
--
-- Why 'cancelled' instead of deleting rows: marking a reminder done (T3.6,
-- PRD Story 4) sets its pending occurrences to 'cancelled' rather than
-- deleting them, preserving audit history and avoiding the hazards of data
-- deletion. The M4 cron query only picks up status = 'pending', so
-- cancelled rows are naturally skipped.

create table public.reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminders (id) on delete cascade,
  send_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  sent_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempted_at timestamptz null,
  created_at timestamptz not null default now()
);

create index reminder_occurrences_reminder_id_idx
  on public.reminder_occurrences (reminder_id);

-- Covering index for the cron query in T4.4:
-- where send_at <= now() and status = 'pending'.
create index reminder_occurrences_due_idx
  on public.reminder_occurrences (status, send_at);

alter table public.reminder_occurrences enable row level security;

-- Ownership checked through the parent reminder row, as with offsets.
create policy "Users manage occurrences of own reminders"
  on public.reminder_occurrences
  for all
  using (
    exists (
      select 1 from public.reminders
      where reminders.id = reminder_occurrences.reminder_id
        and reminders.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.reminders
      where reminders.id = reminder_occurrences.reminder_id
        and reminders.user_id = auth.uid()
    )
  );
