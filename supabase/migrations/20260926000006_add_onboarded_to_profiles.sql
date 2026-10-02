-- M6 T6.9: profiles.onboarded — gates first-login onboarding redirect (M8).
--
-- Done when: migration applies cleanly; profiles rows have an onboarded
-- column; existing rows default to false.
--
-- Why DEFAULT false with NOT NULL: users who signed up before M6 get
-- onboarded = false automatically (no backfill query needed); new sign-ups
-- after this lands receive onboarded = false from the column default.
-- T5.4 needs no modification. The redirect to /onboarding is governed by
-- middleware (see T8.9).

alter table public.profiles
  add column onboarded boolean not null default false;
