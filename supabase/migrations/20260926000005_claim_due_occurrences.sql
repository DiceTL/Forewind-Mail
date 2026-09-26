-- M4 T4.4 (Option B): claim_due_occurrences — single-step atomic pickup.
--
-- Done when: migration applies cleanly; POST /api/cron/send-due claims via
-- this function; two overlapping cron runs never receive the same row.
--
-- Why a function instead of select-then-update in the route: the old
-- three-step pickup (read due rows → write claim → verify) left a gap in
-- which two overlapping runs could both send the same reminder. Locking,
-- claiming, and returning happen here in ONE statement, so the database
-- itself guarantees at-most-once pickup (SELECT ... FOR UPDATE SKIP
-- LOCKED: a row locked by a concurrent caller is skipped, not double-sent).
--
-- Why paused users are excluded here (not in the route): the frozen cron
-- contract requires paused occurrences to stay pending WITHOUT burning an
-- attempt. Excluding them at claim time upholds that literally — a paused
-- row is never touched, so attempt_count stays 0 until the user unpauses.
-- Fail-open: a missing profiles row means "not paused" (claim normally).
--
-- Security: SECURITY DEFINER so the single statement runs with full rights
-- regardless of caller; EXECUTE is revoked from anon/authenticated and
-- granted only to service_role (the cron route's identity). RLS on the
-- underlying tables is untouched — normal users still only see own rows.

create or replace function public.claim_due_occurrences(
  p_now timestamptz,
  p_limit integer default 100
)
returns setof public.reminder_occurrences
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select o.id
    from public.reminder_occurrences as o
    join public.reminders as r
      on r.id = o.reminder_id
    left join public.profiles as p
      on p.user_id = r.user_id
    where o.status = 'pending'
      and o.send_at <= p_now
      and coalesce(p.paused, false) = false
    order by o.send_at asc, o.id asc
    limit coalesce(p_limit, 100)
    for update of o skip locked
  ),
  claimed as (
    update public.reminder_occurrences as o
    set attempt_count = o.attempt_count + 1,
        last_attempted_at = p_now
    from due
    where o.id = due.id
    returning o.*
  )
  select * from claimed
  order by send_at asc, id asc;
end;
$$;

revoke execute on function public.claim_due_occurrences(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_occurrences(timestamptz, integer)
  to service_role;
