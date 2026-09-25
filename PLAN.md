# PLAN.md — Forewind Mail

> Concrete, milestone-by-milestone task breakdown for implementing agents.
>
> - Product scope and acceptance criteria: `PRD.md`
> - Process, testing strategy, commit protocol, and milestone pass/fail checks: `WORKFLOW.md`
> - Operating rules (what files to touch, how to commit, etc.): `AGENTS.md`
>
> **How to use this file:** Pick up one task at a time. Each task names the file(s) it touches and states what "done" looks like. Do not start a task until its predecessors are complete unless the milestone's parallel-agent note explicitly permits it.

---

## M1 — Boilerplate & Deploy Skeleton

**Pass/fail (from `WORKFLOW.md`):** CI green on every push; live Vercel URL loads a bare page.

**Parallel-agent opportunities:** None — all tasks are sequential bootstrapping steps.

### Tasks

- [ ] **T1.1** Initialize the repo with `create-next-app` (TypeScript, App Router, Tailwind, ESLint).
  - Files: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`
  - Done: `npm run build` exits 0.

- [ ] **T1.2** Install and configure shadcn/ui.
  - Files: `components.json`, `app/globals.css`, `lib/utils.ts`
  - Done: at least one shadcn component (`Button`) renders on `app/page.tsx` without errors.

- [ ] **T1.3** Install Prettier; add `.prettierrc`; wire `prettier` into the ESLint config.
  - Files: `.prettierrc`, `eslint.config.*`
  - Done: `npm run lint` exits 0 on the starter files.

- [ ] **T1.4** Install Vitest and write one trivial passing unit test.
  - Files: `vitest.config.ts`, `tests/unit/smoke.test.ts`
  - Done: `npx vitest run` exits 0.

- [ ] **T1.5** Install Playwright and write one trivial passing E2E test (page title check).
  - Files: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`
  - Done: `npx playwright test` exits 0 against `npm run dev`.

- [ ] **T1.6** Add GitHub Actions workflow: install → lint → vitest → build → playwright.
  - Files: `.github/workflows/ci.yml`
  - Done: workflow YAML is valid; CI passes on push to main.

- [ ] **T1.7** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Connect repo to Vercel; confirm bare page loads at the deployed URL.
  - Done: Vercel deployment succeeds; URL is publicly reachable.

- [ ] **T1.8** Investigate Supabase's current free-tier inactivity-pause behavior. If projects can be paused after inactivity, add a scheduled GitHub Actions job that pings the Supabase REST endpoint once per day to keep the project active.
  - Files: `.github/workflows/keepalive.yml` (only if the ping is needed — omit the file if Supabase's current policy doesn't pause active projects)
  - Done: either the file exists and the scheduled job runs successfully, or a comment in this task documents that no ping is needed under the current Supabase free-tier policy and why.
  - **Why:** `WORKFLOW.md` lists a paused Supabase project as a named technical risk — "a paused project would silently stop all scheduling." This task resolves that risk before it can affect any later milestone.

---

## M2 — Schema & Contracts

**Pass/fail (from `WORKFLOW.md`):** Migrations apply cleanly to a fresh Supabase project; a manual insert as user A is invisible to user B via the client.

**Parallel-agent opportunities:** None — all migrations and types depend on the same schema being finalized first.

### Tasks

- [ ] **T2.1** Write Supabase migration: create `profiles` table (`user_id` FK → auth.users, `timezone` text, `paused` bool default false). Add RLS policy: users may only read/write their own row.
  - Files: `supabase/migrations/<timestamp>_create_profiles.sql`
  - Done: `supabase db reset` applies cleanly; RLS rejects cross-user reads.

- [ ] **T2.2** Write Supabase migration: create `reminders` table (`user_id` FK, `title` text, `deadline` timestamptz nullable, `repeat_rule` text nullable, `repeat_enabled` bool, `status` text check in ('active','done')). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminders.sql`
  - Done: migration applies; RLS in place.

- [ ] **T2.3** Write Supabase migration: create `reminder_offsets` table (`reminder_id` FK, `offset_minutes` int with `CHECK (offset_minutes >= 5 AND offset_minutes % 5 = 0)`). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminder_offsets.sql`
  - Done: migration applies; inserting a 3-minute offset is rejected by the CHECK constraint.

- [ ] **T2.4** Write Supabase migration: create `reminder_occurrences` table (`reminder_id` FK, `send_at` timestamptz, `status` text check in ('pending','sent','failed'), `sent_at` timestamptz nullable, `attempt_count` int not null default 0, `last_attempted_at` timestamptz nullable). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminder_occurrences.sql`
  - Done: migration applies; RLS in place; `attempt_count` and `last_attempted_at` columns exist and are readable from the server client.
  - **Why:** `attempt_count` is required by T4.5's "retry up to a configured maximum" logic — without it there is no durable place to track how many times an occurrence has been retried across separate cron runs.

- [ ] **T2.5** Generate TypeScript types from the Supabase schema.
  - Files: `lib/database.types.ts`
  - Done: file produced via `supabase gen types typescript`; no TypeScript errors in dependent files.

- [ ] **T2.6** Add typed Supabase client helpers: browser client (anon key only), server client (anon key + auth cookie), admin client (service-role key — server only).
  - Files: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
  - Done: `client.ts` imports no server-only env vars; `admin.ts` is imported **only** by `app/api/cron/send-due/route.ts` and `app/api/account/delete/route.ts` — no other file under `app/` or `lib/` may import it.
  - **Why the account-deletion exception:** deleting a `auth.users` row requires the service-role key. Rather than spread that import, a single dedicated server route (`app/api/account/delete/route.ts`, added in T6.5) is the sole additional permitted importer. The security audit in T8.3 is updated accordingly.

---

## M3 — Scheduling Core (Test-First)

**Pass/fail (from `WORKFLOW.md`):** Vitest suite covers normal cases, boundary cases (exact 5-minute minimum, offset = time remaining), repeats, time zone/DST transitions, and "done cancels the series" — all green, all written before the functions and not modified after.

> **Testing constraint:** Per `WORKFLOW.md`, tests for this milestone are **written by planning before implementation starts**. The implementing agent must not modify any file under `tests/`. If a test appears wrong, flag it back to planning.

**Parallel-agent opportunities:** `computeSendTime` (T3.2), `validateOffset` (T3.3), and `cancelOccurrences` (T3.6) are independent pure functions in separate files with no shared state — they can be built concurrently. `computeNextOccurrence` (T3.4) and `recomputeOnDeadlineEdit` (T3.5) depend on the output of the others and must follow sequentially. **Confirm with the human before running concurrently.**

### Tasks

- [ ] **T3.1** *(Read-only for implementer — written by planning.)* Review the test file to understand the expected signatures and behavior before writing any code.
  - Files: `tests/unit/scheduling.test.ts`

- [ ] **T3.2** Implement `computeSendTime(deadline: DateTime, offsetMinutes: number): DateTime` using Luxon.
  - Files: `lib/scheduling/computeSendTime.ts`
  - Done: all `computeSendTime` tests in `tests/unit/scheduling.test.ts` pass.

- [ ] **T3.3** Implement `validateOffset(offsetMinutes: number, deadline: DateTime | null, now: DateTime): ValidationResult`.
  - Files: `lib/scheduling/validateOffset.ts`
  - Done: 5-minute-minimum and past-at-creation rejection tests pass.

- [ ] **T3.4** Implement `computeNextOccurrence(rule: RRule, after: DateTime): DateTime | null` using `rrule`.
  - Files: `lib/scheduling/computeNextOccurrence.ts`
  - Done: daily, weekly (chosen days), and monthly repeat tests pass; no-end-date case passes.

- [ ] **T3.5** Implement `recomputeOnDeadlineEdit(reminderId: string, newDeadline: DateTime, now: DateTime): OccurrenceUpdate[]`.
  - Files: `lib/scheduling/recomputeOnDeadlineEdit.ts`
  - Done: overdue-lead-times-are-cancelled (not burst-sent) test passes.

- [ ] **T3.6** Implement `cancelOccurrences(reminderId: string): void` — marks all `pending` occurrences for a reminder as cancelled in the DB using the server client.
  - Files: `lib/scheduling/cancelOccurrences.ts`
  - Done: "done cancels the series" tests pass.

- [ ] **T3.7** Run the full Vitest suite; confirm all scheduling tests are green. Verify `git diff tests/` is empty.
  - Done: `npx vitest run` exits 0; no test files were modified.

---

## M4 — Delivery Pipeline

**Pass/fail (from `WORKFLOW.md`):** A manually inserted occurrence with a past `send_at` results in a real email arriving within ~2 minutes when the cron fires.

**Parallel-agent opportunities:** None — the cron route depends on the scheduling functions (M3) and DB schema (M2).

### Tasks

- [ ] **T4.1** *(Read-only for implementer — written by planning.)* Review the cron unit test file for expected behavior.
  - Files: `tests/unit/cron.test.ts`

- [ ] **T4.2** Implement the reminder email template: given a reminder title, deadline (formatted in the user's local time zone), and lead time, produce a plain-text email subject and body. No action links (per `PRD.md` security requirements).
  - Files: `lib/mailer/buildEmailContent.ts`
  - Done: function accepts `{ title: string, deadline: DateTime | null, offsetMinutes: number, timezone: string }` and returns `{ subject: string, text: string }`; output contains no URLs or click-to-complete links.

- [ ] **T4.3** Implement the Nodemailer/Gmail SMTP transport wrapper.
  - Files: `lib/mailer/sendEmail.ts`
  - Done: function accepts `{ to, subject, text }` and sends via Gmail SMTP using env vars; throws on auth failure; calls `buildEmailContent` to construct the message rather than inlining content.

- [ ] **T4.4** Implement `POST /api/cron/send-due`: verify bearer-token secret (reject with 401 on mismatch); query `reminder_occurrences` where `send_at <= now()` and `status = 'pending'`; claim them (atomic status update to avoid double-send); call `sendEmail`; update status to `sent` or `failed`.
  - Files: `app/api/cron/send-due/route.ts`
  - Done: route returns 200 for a valid secret; 401 for wrong/missing secret; cron unit tests pass.

- [ ] **T4.5** Add pause-switch check: skip sending for users whose `profiles.paused = true`; leave their occurrences as `pending` (not `failed`).
  - Files: `app/api/cron/send-due/route.ts`
  - Done: paused-user test case passes.

- [ ] **T4.6** Add retry logic: on each cron run, increment `attempt_count` for a claimed occurrence; if `attempt_count` is below a configured maximum (`MAX_SEND_ATTEMPTS`, default 3), retry sending; once the maximum is reached, set status to `failed` permanently and stop retrying. Update `last_attempted_at` on each attempt.
  - Files: `app/api/cron/send-due/route.ts`
  - Done: retry-count test cases pass; `attempt_count` and `last_attempted_at` columns (defined in T2.4) are incremented/updated on each attempt; an occurrence that exceeds `MAX_SEND_ATTEMPTS` is not retried again.

- [ ] **T4.7** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Enable `pg_cron`/`pg_net` in Supabase; schedule the per-minute job pointing at the deployed cron route with the bearer-token secret.
  - Done: a manually inserted past-due occurrence triggers a real email within ~2 minutes.


---

## M5 — Auth & Isolation

**Pass/fail (from `WORKFLOW.md`):** Playwright test signs in as two seeded test users and confirms neither can read, edit, or complete the other's reminders.

**Parallel-agent opportunities:** None — auth middleware must exist before any protected server actions or pages can be built.

### Tasks

- [ ] **T5.1** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Configure Google OAuth provider in Supabase; add test users to the OAuth consent screen.

- [ ] **T5.2** Add Next.js middleware to protect all routes except `/login`; redirect unauthenticated requests to `/login`.
  - Files: `middleware.ts`
  - Done: `curl -I <URL>/` without a session cookie returns a redirect to `/login`.

- [ ] **T5.3** Implement sign-in page with a "Sign in with Google" button, and a sign-out server action.
  - Files: `app/login/page.tsx`, `app/actions/auth.ts`
  - Done: clicking the button initiates the Google OAuth flow; after sign-in the user lands on `/`; sign-out clears the session.

- [ ] **T5.4** On first login (post-OAuth callback), upsert a `profiles` row: detect the user's IANA time zone from the browser (passed via a form or cookie) and store it; default to `UTC` if undetectable.
  - Files: `app/api/auth/callback/route.ts` (or `app/actions/auth.ts`)
  - Done: after first sign-in, a `profiles` row exists with a non-null `timezone` and `paused = false`.

- [ ] **T5.5** *(Read-only for implementer — written by planning.)* Run the isolation Playwright test: sign in as user A, create a reminder, sign in as user B, confirm the reminder is not visible or accessible.
  - Files: `tests/e2e/isolation.spec.ts`
  - Done: test passes.

---

## M6 — Frontend

**Pass/fail (from `WORKFLOW.md`):** Manual + Playwright coverage of create, edit (re-arms schedule), mark done (cancels series), pause, delete.

**Parallel-agent opportunities:**
- **Reminder CRUD** (`app/reminders/`, `app/actions/reminders.ts`) and **Settings** (`app/settings/`, `app/actions/settings.ts`) share no files and no database tables with each other.
- They can be built by two concurrent agent sessions after M5 is complete.
- **Confirm with the human before running concurrently.**

### Tasks — Reminder CRUD (Agent A)

- [ ] **T6.1** Implement create-reminder form: title input, optional deadline date+time picker, one or more lead-time inputs (5-minute stepper, min 5 min, inline error if already past), repeat toggle + pattern selector (daily / weekly on chosen days / monthly).
  - Files: `app/reminders/new/page.tsx`, `app/reminders/new/ReminderForm.tsx`, `app/actions/reminders.ts`
  - Done: submitting inserts `reminders`, `reminder_offsets`, and computed `reminder_occurrences` rows; a past-at-creation offset shows an inline error and blocks submission.

- [ ] **T6.2** Implement reminder list view: title, next scheduled send time, and per-occurrence delivery status (pending / sent / failed with timestamp).
  - Files: `app/reminders/page.tsx`, `app/reminders/ReminderList.tsx`, `app/reminders/ReminderCard.tsx`
  - Done: list shows only the signed-in user's reminders; statuses are accurate.

- [ ] **T6.3** Implement edit-reminder form: changing the deadline calls `recomputeOnDeadlineEdit`; overdue offsets are cancelled, not burst-sent.
  - Files: `app/reminders/[id]/edit/page.tsx`, `app/actions/reminders.ts`
  - Done: deadline edit updates occurrences correctly; no overdue burst.

- [ ] **T6.4** Implement mark-done and reopen actions.
  - Files: `app/actions/reminders.ts`
  - Done: marking done cancels all `pending` occurrences; reopen sets reminder status to `active` without recomputing occurrences (per `WORKFLOW.md` open assumption).

### Tasks — Settings (Agent B — parallel with Agent A after M5)

- [ ] **T6.5** Implement settings page: IANA time zone selector (editable), pause toggle (stops all sending immediately), delete-account action.
  - Files: `app/settings/page.tsx`, `app/actions/settings.ts`, `app/api/account/delete/route.ts`
  - Done: time zone change updates `profiles.timezone`; pause toggle updates `profiles.paused`; the delete-account button calls `POST /api/account/delete`, which uses the admin client (`lib/supabase/admin.ts`) to delete the `auth.users` row (which cascades to all reminder data) and then signs the user out.
  - **Why a dedicated route:** deleting `auth.users` requires the service-role key. Per T2.6, only two files may import `lib/supabase/admin.ts` — the cron route and this route. A server action cannot hold the service-role key, so the deletion is isolated in its own narrow API route.

### Playwright Tests (read-only for implementer — written by planning before T6.1)

- [ ] **T6.6** Confirm E2E tests pass for create, edit (re-arms schedule), mark done, pause, and delete.
  - Files: `tests/e2e/reminders.spec.ts`, `tests/e2e/settings.spec.ts`
  - Done: all pass.

---

## M7 — End-to-End Tests

**Pass/fail (from `WORKFLOW.md`):** Full Playwright flow green in CI: sign up → create reminder → seed a due occurrence → confirm email arrives → mark done → confirm no further emails.

**Parallel-agent opportunities:** None — this milestone validates the complete integrated stack.

### Tasks

- [ ] **T7.1** *(Read-only for implementer — written by planning.)* Review the full-flow test to understand seeding and inbox-polling helpers needed.
  - Files: `tests/e2e/full-flow.spec.ts`

- [ ] **T7.2** Implement test helpers: DB occurrence seeder (uses service-role client to insert a past-due occurrence) and inbox poller (polls a test Gmail inbox via IMAP or the Gmail API until the expected email arrives or a timeout is hit).
  - Files: `tests/helpers/seedOccurrence.ts`, `tests/helpers/pollInbox.ts`
  - Done: helpers are importable from E2E tests; no existing test files are modified.

- [ ] **T7.3** Run the full Playwright suite in CI. Verify `git diff tests/` is empty.
  - Done: CI passes; no test files were modified by the implementer.

---

## M8 — Polish & Review

**Pass/fail (from `WORKFLOW.md`):** Manual checklist signed off.

**Parallel-agent opportunities:**
- **Empty/error states** (T8.1) and **mobile layout** (T8.2) are independent UI tasks — they can run in parallel.
- **Security pass** (T8.3–T8.5) must run after both UI tasks are complete, as it audits the full codebase.

### Tasks — UI Polish (can parallelize)

- [ ] **T8.1** Add empty state to the reminder list (shown when the user has no reminders) and inline error states for form submission failures and network errors.
  - Files: `app/reminders/page.tsx`, `app/reminders/ReminderList.tsx`, shared error/empty-state components as needed
  - Done: empty list shows a helpful call-to-action; form errors are surfaced inline without a full-page reload.

- [ ] **T8.2** Mobile layout audit: check all pages at 375 px viewport width; fix any horizontal overflow or tap-target issues (minimum 44 px).
  - Files: any layout or component files with issues discovered during audit
  - Done: no horizontal overflow at 375 px; all interactive targets are ≥ 44 px.

### Tasks — Security Pass (sequential, after UI polish)

- [ ] **T8.3** Confirm the Supabase service-role key is never imported outside the two permitted files: `lib/supabase/admin.ts`, `app/api/cron/send-due/route.ts`, and `app/api/account/delete/route.ts`.
  - Done: `grep -r SERVICE_ROLE app/ lib/ | grep -v 'admin\.ts\|send-due\|account/delete'` returns empty.

- [ ] **T8.4** Confirm RLS is enabled on all four tables (`profiles`, `reminders`, `reminder_offsets`, `reminder_occurrences`).
  - Done: Supabase dashboard or `supabase db diff` confirms `ENABLE ROW LEVEL SECURITY` on all four.

- [ ] **T8.5** Confirm `POST /api/cron/send-due` returns HTTP 401 for a request with a missing or wrong `Authorization` header.
  - Done: `curl -X POST <VERCEL_URL>/api/cron/send-due` (no header) returns 401; a request with a wrong token also returns 401.

- [ ] **T8.6** *(Human step.)* Sign off the manual checklist. Record the sign-off in the commit message body for the final deploy commit.
  - Done: human has verified T8.1–T8.5; final production deploy is live and stable.
