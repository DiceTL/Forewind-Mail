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

- [x] **T1.1** Initialize the repo with `create-next-app` (TypeScript, App Router, Tailwind, ESLint).
  - Files: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`
  - Done: `npm run build` exits 0.
  - Version floor: `next` / `eslint-config-next` must stay on a patched 15.5.x (≥15.5.26 at time of writing). Vercel hard-fails deploys on known-vulnerable Next.js releases (first hit: 15.5.4 blocked per CVE-2025-66478), so never pin or downgrade below a patched release.

- [x] **T1.2** Install and configure shadcn/ui.
  - Files: `components.json`, `app/globals.css`, `lib/utils.ts`
  - Done: at least one shadcn component (`Button`) renders on `app/page.tsx` without errors.

- [x] **T1.3** Install Prettier; add `.prettierrc`; wire `prettier` into the ESLint config.
  - Files: `.prettierrc`, `eslint.config.*`
  - Done: `npm run lint` exits 0 on the starter files.

- [x] **T1.4** Install Vitest and write one trivial passing unit test.
  - Files: `vitest.config.ts`, `tests/unit/smoke.test.ts`
  - Done: `npx vitest run` exits 0.

- [x] **T1.5** Install Playwright and write one trivial passing E2E test (page title check).
  - Files: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`
  - Done: `npx playwright test` exits 0 against `npm run dev`.

- [x] **T1.6** Add GitHub Actions workflow: install → lint → vitest → build → playwright.
  - Files: `.github/workflows/ci.yml`
  - Done: workflow YAML is valid; CI passes on push to main.

- [x] **T1.7** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Connect repo to Vercel; confirm bare page loads at the deployed URL.
  - Done: Vercel deployment succeeds; URL is publicly reachable.

- [x] **T1.8** Investigate Supabase's current free-tier inactivity-pause behavior. If projects can be paused after inactivity, add a scheduled GitHub Actions job that pings the Supabase REST endpoint once per day to keep the project active.
  - Files: `.github/workflows/keepalive.yml` (only if the ping is needed — omit the file if Supabase's current policy doesn't pause active projects)
  - Done: either the file exists and the scheduled job runs successfully, or a comment in this task documents that no ping is needed under the current Supabase free-tier policy and why.
  - **Why:** `WORKFLOW.md` lists a paused Supabase project as a named technical risk — "a paused project would silently stop all scheduling." This task resolves that risk before it can affect any later milestone.

---

## M2 — Schema & Contracts

**Pass/fail (from `WORKFLOW.md`):** Migrations apply cleanly to a fresh Supabase project; a manual insert as user A is invisible to user B via the client.

**Parallel-agent opportunities:** None — all migrations and types depend on the same schema being finalized first.

### Tasks

- [x] **T2.1** Write Supabase migration: create `profiles` table (`user_id` FK → auth.users, `timezone` text, `paused` bool default false). Add RLS policy: users may only read/write their own row.
  - Files: `supabase/migrations/<timestamp>_create_profiles.sql`
  - Done: `supabase db reset` applies cleanly; RLS rejects cross-user reads.

- [x] **T2.2** Write Supabase migration: create `reminders` table (`user_id` FK, `title` text, `deadline` timestamptz nullable, `repeat_rule` text nullable, `repeat_enabled` bool, `status` text check in ('active','done')). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminders.sql`
  - Done: migration applies; RLS in place.

- [x] **T2.3** Write Supabase migration: create `reminder_offsets` table (`reminder_id` FK, `offset_minutes` int with `CHECK (offset_minutes >= 5 AND offset_minutes % 5 = 0)`). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminder_offsets.sql`
  - Done: migration applies; inserting a 3-minute offset is rejected by the CHECK constraint.

- [x] **T2.4** Write Supabase migration: create `reminder_occurrences` table (`reminder_id` FK, `send_at` timestamptz, `status` text check in ('pending','sent','failed','cancelled'), `sent_at` timestamptz nullable, `attempt_count` int not null default 0, `last_attempted_at` timestamptz nullable). Add RLS.
  - Files: `supabase/migrations/<timestamp>_create_reminder_occurrences.sql`
  - Done: migration applies; RLS in place; `attempt_count` and `last_attempted_at` columns exist and are readable from the server client.
  - **Why:** `attempt_count` is required by T4.5's "retry up to a configured maximum" logic — without it there is no durable place to track how many times an occurrence has been retried across separate cron runs.

- [x] **T2.5** Generate TypeScript types from the Supabase schema.
  - Files: `lib/database.types.ts`
  - Done: file produced via `supabase gen types typescript`; no TypeScript errors in dependent files.

- [x] **T2.6** Add typed Supabase client helpers: browser client (anon key only), server client (anon key + auth cookie), admin client (service-role key — server only).
  - Files: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
  - Done: `client.ts` imports no server-only env vars; `admin.ts` is imported **only** by `app/api/cron/send-due/route.ts` and `app/api/account/delete/route.ts` — no other file under `app/` or `lib/` may import it.
  - **Why the account-deletion exception:** deleting a `auth.users` row requires the service-role key. Rather than spread that import, a single dedicated server route (`app/api/account/delete/route.ts`, added in T6.5) is the sole additional permitted importer. The security audit in T8.3 is updated accordingly.

---

## M3 — Scheduling Core (Test-First)

**Pass/fail (from `WORKFLOW.md`):** Vitest suite covers normal cases, boundary cases (exact 5-minute minimum, offset = time remaining), repeats, time zone/DST transitions, and "done cancels the series" — all green, all written before the functions and not modified after.

> **Testing constraint:** Per `WORKFLOW.md`, tests for this milestone are **written by planning before implementation starts**. The implementing agent must not modify any file under `tests/`. If a test appears wrong, flag it back to planning.

**Parallel-agent opportunities:** `computeSendTime` (T3.2) and `validateOffset` (T3.3) are independent pure functions in separate files with no shared state — they can be built concurrently. `cancelOccurrences` (T3.6) is DB-backed (sets `status = 'cancelled'` via the server client), not pure, but shares no files or state with the others so it can also be built concurrently. `computeNextOccurrence` (T3.4) and `recomputeOnDeadlineEdit` (T3.5) depend on the output of the others and must follow sequentially. **Confirm with the human before running concurrently.**

### Tasks

- [x] **T3.1** *(Read-only for implementer — written by planning.)* Review the test file to understand the expected signatures and behavior before writing any code.
  - Files: `tests/unit/scheduling.test.ts`

- [x] **T3.2** Implement `computeSendTime(deadline: DateTime, offsetMinutes: number): DateTime` using Luxon.
  - Files: `lib/scheduling/computeSendTime.ts`
  - Done: all `computeSendTime` tests in `tests/unit/scheduling.test.ts` pass.

- [x] **T3.3** Implement `validateOffset(offsetMinutes: number, deadline: DateTime | null, now: DateTime): ValidationResult`.
  - Files: `lib/scheduling/validateOffset.ts`
  - Done: 5-minute-minimum and past-at-creation rejection tests pass.

- [x] **T3.4** Implement `computeNextOccurrence(rule: RRule, after: DateTime): DateTime | null` using `rrule`.
  - Files: `lib/scheduling/computeNextOccurrence.ts`
  - Done: daily, weekly (chosen days), and monthly repeat tests pass; no-end-date case passes.

- [x] **T3.5** Implement `recomputeOnDeadlineEdit(reminderId: string, newDeadline: DateTime, now: DateTime): OccurrenceUpdate[]`.
  - Files: `lib/scheduling/recomputeOnDeadlineEdit.ts`
  - Done: overdue-lead-times-are-cancelled (not burst-sent) test passes.

- [x] **T3.6** Implement `cancelOccurrences(reminderId: string): void` — marks all `pending` occurrences for a reminder as cancelled in the DB using the server client.
  - Files: `lib/scheduling/cancelOccurrences.ts`
  - Done: "done cancels the series" tests pass.

- [x] **T3.7** Run the full Vitest suite; confirm all scheduling tests are green. Verify `git diff tests/` is empty.
  - Done: `npx vitest run` exits 0; no test files were modified.

---

## M4 — Delivery Pipeline

**Pass/fail (from `WORKFLOW.md`):** A manually inserted occurrence with a past `send_at` results in a real email arriving within ~2 minutes when the cron fires.

**Parallel-agent opportunities:** None — the cron route depends on the scheduling functions (M3) and DB schema (M2).

### Tasks

- [x] **T4.1** *(Read-only for implementer — written by planning.)* Review the cron unit test file for expected behavior.
  - Files: `tests/unit/cron.test.ts`

- [x] **T4.2** Implement the reminder email template: given a reminder title, deadline (formatted in the user's local time zone), and lead time, produce a plain-text email subject and body. No action links (per `PRD.md` security requirements).
  - Files: `lib/mailer/buildEmailContent.ts`
  - Done: function accepts `{ title: string, deadline: DateTime | null, offsetMinutes: number, timezone: string }` and returns `{ subject: string, text: string }`; output contains no URLs or click-to-complete links.

- [x] **T4.3** Implement the Nodemailer/Gmail SMTP transport wrapper.
  - Files: `lib/mailer/sendEmail.ts`
  - Done: function accepts `{ to, subject, text }` and sends via Gmail SMTP using env vars; throws on auth failure; calls `buildEmailContent` to construct the message rather than inlining content.

- [x] **T4.4** Implement `POST /api/cron/send-due`: verify bearer-token secret (reject with 401 on mismatch); query `reminder_occurrences` where `send_at <= now()` and `status = 'pending'`; claim them (atomic status update to avoid double-send); call `sendEmail`; update status to `sent` or `failed`.
  - Files: `app/api/cron/send-due/route.ts`
  - Done: route returns 200 for a valid secret; 401 for wrong/missing secret; cron unit tests pass.

- [x] **T4.5** Add pause-switch check: skip sending for users whose `profiles.paused = true`; leave their occurrences as `pending` (not `failed`).
  - Files: `app/api/cron/send-due/route.ts`
  - Done: paused-user test case passes.

- [x] **T4.6** Add retry logic: on each cron run, increment `attempt_count` for a claimed occurrence; if `attempt_count` is below a configured maximum (`MAX_SEND_ATTEMPTS`, default 3), retry sending; once the maximum is reached, set status to `failed` permanently and stop retrying. Update `last_attempted_at` on each attempt.
  - Files: `app/api/cron/send-due/route.ts`
  - Done: retry-count test cases pass; `attempt_count` and `last_attempted_at` columns (defined in T2.4) are incremented/updated on each attempt; an occurrence that exceeds `MAX_SEND_ATTEMPTS` is not retried again.

- [x] **T4.7** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Enable `pg_cron`/`pg_net` in Supabase; schedule the per-minute job pointing at the deployed cron route with the bearer-token secret.
  - Done: a manually inserted past-due occurrence triggers a real email within ~2 minutes.


---

## M5 — Auth & Isolation

**Pass/fail (from `WORKFLOW.md`):** Playwright test signs in as two seeded test users and confirms neither can read, edit, or complete the other's reminders.

**Parallel-agent opportunities:** None — auth middleware must exist before any protected server actions or pages can be built.

### Tasks

- [x] **T5.1** *(Human step — see `WORKFLOW.md` Human Setup Checklist.)* Configure Google OAuth provider in Supabase; add test users to the OAuth consent screen.

- [x] **T5.2** Add Next.js middleware to protect all routes except `/login`; redirect unauthenticated requests to `/login`.
  - Files: `middleware.ts`
  - Done: `curl -I <URL>/` without a session cookie returns a redirect to `/login`.

- [x] **T5.3** Implement sign-in page with a "Sign in with Google" button, and a sign-out server action.
  - Files: `app/login/page.tsx`, `app/actions/auth.ts`
  - Done: clicking the button initiates the Google OAuth flow; after sign-in the user lands on `/`; sign-out clears the session.

- [x] **T5.4** On first login (post-OAuth callback), upsert a `profiles` row: detect the user's IANA time zone from the browser (passed via a form or cookie) and store it; default to `UTC` if undetectable.
  - Files: `app/api/auth/callback/route.ts` (or `app/actions/auth.ts`)
  - Done: after first sign-in, a `profiles` row exists with a non-null `timezone` and `paused = false`.

- [x] **T5.5** *(Read-only for implementer — written by planning.)* Run the isolation Playwright test: sign in as user A, create a reminder, sign in as user B, confirm the reminder is not visible or accessible.
  - Files: `tests/e2e/isolation.spec.ts`, `tests/helpers/e2eAuth.ts`, `tests/helpers/seedReminder.ts`
  - Done: test passes.

---

## M6 — Frontend

**Pass/fail (from `WORKFLOW.md`):** All four M6 Playwright spec files green; manual verification of create, edit (re-arms schedule), mark done (cancels series), pause, delete.

**Parallel-agent opportunities:** None — human directs sequential build.

**Build order (strictly sequential):** T6.7 → T6.8 → T6.1 → T6.2 → T6.3 → T6.4 → T6.5 → T6.10 → T6.11 → T6.12.

> **Testing constraint:** Per `WORKFLOW.md`, all M6 E2E tests are planning-frozen and must not be modified by the implementing agent. If a test appears wrong, flag it back to planning. Do not write a `DESIGN.md`, do not choose a color palette, typeface, or visual world — styling uses shadcn tokens from `app/globals.css` only. Visual direction, comps, polish, and a11y audit are a human manual phase after T6.12 is green, one page at a time with its spec re-run after each visual change.

### T6.7 — Static Assets

- [x] **T6.7** Create `public/assets/` directory with a placeholder SVG wordmark and an OG image stub (1200×630 px placeholder). This directory is the canonical home for all static UI assets used by the landing page, onboarding flow, and HTML email.
  - Files: `public/assets/wordmark.svg`, `public/assets/og-image.png`
  - Done: `GET /assets/wordmark.svg` returns HTTP 200 with a `content-type` matching `svg` or `xml` (asserted by `landing.spec.ts`); `public/assets/og-image.png` exists at 1200×630 px.
  - **Implementation:** both assets are hand-built via code only with no new npm dependency. `wordmark.svg` is a minimal inline SVG `<text>` element (e.g. `<text>Forewind Mail</text>`); `og-image.png` is a 1200×630 placeholder PNG produced with the local `magick` binary (already installed on this machine), e.g. a neutral background with the product name and tagline — neutral black-on-white is sufficient. **Do not use `impeccable generate`, any image-generation API, or `OPENAI_API_KEY`.** The agent must not choose a brand palette or font; that is the human visual phase.

### T6.8 — Landing Page + Middleware (two-tier)

- [x] **T6.8** Repurpose `app/page.tsx` as the public marketing landing page. Carve `/` out of the middleware auth guard so unauthenticated users reach this page. Signed-in users hitting `/` are redirected to `/reminders`.
  - Files: `app/page.tsx`, `middleware.ts`
  - Middleware public allowlist (no auth required): `["/", "/login"]`
  - Middleware signed-in redirect: authenticated `GET /` → `302 /reminders`
  - Done (contract from `tests/e2e/landing.spec.ts`):
    - Unauthenticated `GET /` → HTTP 200, URL stays on `/`.
    - Page has `role="heading" level=1` with accessible name `"Forewind Mail"`.
    - Page contains visible text matching `/email reminder/i`.
    - Page has `role="link"` with accessible name `/sign in/i` and `href` matching `/login`.
    - Authenticated `GET /` → redirected to `/reminders`.
  - **Styling:** shadcn tokens from `app/globals.css` only. Readable, structurally correct HTML — no palette choice, no DESIGN.md.
  - **Middleware ownership:** T6.8 is the **sole owner** of `middleware.ts` in M6. T8.9 (M8) supersedes this with 3-tier onboarding routing — T8.9 must not start until T6.8 is merged. Do not run T6.8 and T8.9 concurrently.

### T6.1–T6.4 — Reminder CRUD

- [x] **T6.1** Implement create-reminder server action and form page: title input (label `"Title"`), optional deadline datetime-local input (label `"Deadline"`), one or more lead-time inputs (label `"Lead time (minutes)"`, 5-minute stepper, min 5 min), repeat toggle + pattern selector (daily / weekly on chosen days / monthly). Submit button label `"Create reminder"`.
  - Files: `app/reminders/new/page.tsx`, `app/reminders/new/ReminderForm.tsx`, `app/actions/reminders.ts`
  - Done (contract from `tests/e2e/reminders.spec.ts`):
    - Route `/reminders/new` renders with labels `"Title"`, `"Deadline"`, `"Lead time (minutes)"` and button `"Create reminder"`.
    - Successful submission inserts one `reminders` row, one `reminder_offsets` row (with the entered `offset_minutes`), and one or more `reminder_occurrences` rows with `status = 'pending'` and `send_at` equal to `deadline − offset_minutes` (within 60 s tolerance) using `computeSendTime` math.
    - After success, browser navigates to `/reminders` and the new title is visible.
    - A lead time whose computed `send_at` is already in the past at creation time surfaces a `role="alert"` element, keeps the browser on `/reminders/new`, and inserts nothing into any table.

- [x] **T6.2** Implement reminder list view: title, next scheduled send time, and per-occurrence delivery status.
  - Files: `app/reminders/page.tsx`, `app/reminders/ReminderList.tsx`, `app/reminders/ReminderCard.tsx`
  - Done (contract from `tests/e2e/reminders.spec.ts`):
    - Route `/reminders` is auth-protected.
    - Each reminder renders as `role="article"` with accessible name equal to the reminder title.
    - Each card exposes a `role="status"` element with accessible name `"Active"` or `"Done"` matching the reminder's current DB status.
    - Cards include a `role="button"` named `"Mark done"` (when active) and `"Reopen"` (when done).
    - List shows only the signed-in user's reminders.

- [x] **T6.3** Implement edit-reminder form page and server action. Changing the deadline calls `recomputeOnDeadlineEdit`; overdue offsets are cancelled, not burst-sent. Save button label `"Save reminder"`.
  - Files: `app/reminders/[id]/edit/page.tsx`, `app/actions/reminders.ts`
  - Done (contract from `tests/e2e/reminders.spec.ts`):
    - Route `/reminders/[id]/edit` renders with label `"Deadline"` and button `"Save reminder"`.
    - After saving a new deadline that is far enough in the future: existing pending occurrences have their `send_at` updated to `newDeadline − offset_minutes` (within 60 s) and remain `"pending"`.
    - After saving a deadline so close that the lead time is already overdue: the affected occurrence's `status` becomes `"cancelled"` — not queued for burst sending.
    - After success, browser navigates to `/reminders`.

- [x] **T6.4** Implement mark-done and reopen server actions wired to the list card buttons.
  - Files: `app/actions/reminders.ts` (additive to T6.1/T6.3 work)
  - Done (contract from `tests/e2e/reminders.spec.ts`):
    - Clicking `"Mark done"`: `reminders.status` → `"done"`; all `pending` occurrences for that reminder → `"cancelled"`; card's `role="status"` shows `"Done"`.
    - Clicking `"Reopen"`: `reminders.status` → `"active"`; occurrence statuses are **not** recomputed (per `WORKFLOW.md` open assumption — cancelled stays cancelled); card's `role="status"` shows `"Active"`.

### T6.5 — Settings

- [x] **T6.5** Implement settings page: IANA time zone selector, pause-emails switch, and delete-account action with confirmation step.
  - Files: `app/settings/page.tsx`, `app/actions/settings.ts`, `app/api/account/delete/route.ts`
  - Done (contract from `tests/e2e/settings.spec.ts`):
    - Route `/settings` renders with a `<select>` labelled `"Time zone"` populated with IANA zone options; selecting a zone updates `profiles.timezone` in the DB.
    - Page renders a `role="switch"` element with accessible name `"Pause emails"`; initial `aria-checked` reflects `profiles.paused`; clicking it toggles `profiles.paused` in the DB.
    - Page renders a `role="button"` named `"Delete account"`; clicking it shows a `role="button"` named `"Confirm delete"`; clicking confirm calls `POST /api/account/delete`, which uses `lib/supabase/admin.ts` to delete the `auth.users` row (cascading all reminder data), signs the user out, and redirects to `/login`; the auth user no longer exists in the DB.
  - **Admin client constraint (from T2.6):** `lib/supabase/admin.ts` may be imported only by `app/api/cron/send-due/route.ts` and `app/api/account/delete/route.ts`.
  - **Note:** `profiles.onboarded` column (T6.9) is already present; T6.5 does not need to interact with it. The redirect to `/onboarding` for new users is governed by middleware in T8.9.

### T6.9 — `onboarded` Migration (already done)

- [x] **T6.9** Write Supabase migration: add `onboarded bool default false` to `profiles`. This column gates the first-login onboarding redirect (implemented in M8) and is added here so M6 agents can rely on it.
  - Files: `supabase/migrations/<timestamp>_add_onboarded_to_profiles.sql`, `lib/database.types.ts` (regenerated)
  - Done: migration applies cleanly; `profiles` rows have an `onboarded` column; existing rows default to `false`.

### T6.10 — Stats Page

- [x] **T6.10** Implement the `/stats` page: a server component that queries `reminders`, `reminder_offsets`, and `reminder_occurrences` for the signed-in user and displays a statistics grid. No new tables or API routes — use the existing server Supabase client.
  - Metrics: total reminders created; active vs done count; total emails sent / failed / pending; on-time delivery rate (occurrences where `sent_at − send_at < 2 minutes`); most-used lead time (mode of `offset_minutes` across `reminder_offsets`); reminders created per week (data list or table — no charting library required).
  - Files: `app/stats/page.tsx`, `app/stats/StatsGrid.tsx`, `app/stats/StatsCard.tsx`
  - Done (contract from `tests/e2e/stats.spec.ts`):
    - Unauthenticated `GET /stats` redirects to `/login`.
    - Authenticated page renders `role="heading"` with name matching `/stats|statistics/i`.
    - Empty state (zero reminders): `role="status"` with accessible name `/no reminders yet/i` is visible.
    - Populated grid: 8 `role="article"` elements with accessible names `"Total reminders"`, `"Active reminders"`, `"Done reminders"`, `"Emails sent"`, `"Emails failed"`, `"Emails pending"`, `"On-time delivery rate"`, `"Most-used lead time"` — each containing the correct count as visible text.
    - A `role="region"` with accessible name matching `/reminders created per week/i` is visible.
  - **Styling:** shadcn tokens only; no palette choice; layout details are the human visual phase.

### T6.11 — HTML Email

- [x] **T6.11** Add a branded HTML email template to `buildEmailContent`. The `html` field is additive — `text` stays unchanged so existing cron unit tests pass.
  - Files: `lib/mailer/buildEmailContent.ts`, `lib/mailer/sendEmail.ts`
  - Type change: `EmailContent` gains `html?: string`.
  - Required HTML structure (inline, no external resources): header mark (`"Forewind Mail"` as plain text or inline SVG — no external image URLs); prominent title block; deadline callout block (omitted when no deadline); lead-time badge; footer with the app URL as plain-text only — no `<a href>` constituting a state-changing link (per PRD security rule).
  - Done: `buildEmailContent` returns a non-empty `html` string for both deadline and no-deadline cases; `sendEmail` passes it to Nodemailer alongside `text`; existing cron unit tests remain green; no external image URLs in the HTML. Inline color accents may use neutral defaults — visual direction is the human phase.

### T6.12 — E2E Confirmation

- [ ] **T6.12** Run the full E2E suite. All M6 spec files must pass.
  - Files (read-only — do not modify): `tests/e2e/reminders.spec.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/landing.spec.ts`, `tests/e2e/stats.spec.ts`
  - Done: `npx playwright test` exits 0 on all four files; `git diff tests/` is empty.
  - **Planning note:** `tests/e2e/isolation.spec.ts` asserts unauthenticated `/reminders` → `/login` (not `/`), so it stays compatible with the T6.8 two-tier middleware. Implementing agents must not modify any test file; if a test appears wrong, flag it to planning.
  - **After T6.12 is green:** visual direction, design comps, theme tokens, polish, and a11y audit are a **human manual phase**, one page at a time with its spec re-run after each visual change. The implementing agent must not begin that phase, must not write a `DESIGN.md`, and must not choose a color palette, typeface, or visual world.


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

**Pass/fail (from `WORKFLOW.md`):** Manual checklist signed off — including T8.11 first-login onboarding flow verified by the human on a real browser.

**Parallel-agent opportunities:**
- **Empty/error states** (T8.1) and **mobile layout** (T8.2) are independent UI tasks — they can run in parallel.
- **Onboarding UI + action** (T8.7, T8.8, T8.10 — `app/onboarding/` and `app/actions/onboarding.ts` only) can run concurrently with T8.1 and T8.2. These tasks do **not** touch `middleware.ts`.
- **T8.9** (`middleware.ts` 3-tier routing) is **sequential** — it must start only after T6.8 (M6) is merged, because T6.8 and T8.9 are both sole owners of `middleware.ts` at their respective milestones. T8.9 replaces T6.8's 2-tier logic; running them concurrently causes a conflict.
- **Security pass** (T8.3–T8.5) must run after all UI tasks are complete, as it audits the full codebase.

### Tasks — UI Polish (can parallelize)

- [ ] **T8.1** Add empty state to the reminder list (shown when the user has no reminders) and inline error states for form submission failures and network errors.
  - Files: `app/reminders/page.tsx`, `app/reminders/ReminderList.tsx`, shared error/empty-state components as needed
  - Done: empty list shows a helpful call-to-action; form errors are surfaced inline without a full-page reload.
  - **Human-led visual phase:** visual styling, copywriting, and UI polish for these states are a human manual phase — the agent delivers structurally correct, accessible markup only.

- [ ] **T8.2** Mobile layout audit: check all pages at 375 px viewport width; fix any horizontal overflow or tap-target issues (minimum 44 px).
  - Files: any layout or component files with issues discovered during audit
  - Done: no horizontal overflow at 375 px; all interactive targets are ≥ 44 px.
  - **Human-led visual phase:** theme, color, and font decisions for the mobile layout are a human manual phase — the agent fixes overflow and tap-target dimensions only.

### Tasks — Security Pass (sequential, after UI polish)

- [ ] **T8.3** Confirm the Supabase service-role key is never imported outside the two permitted files: `lib/supabase/admin.ts`, `app/api/cron/send-due/route.ts`, and `app/api/account/delete/route.ts`.
  - Done: `grep -r SERVICE_ROLE app/ lib/ | grep -v 'admin\.ts\|send-due\|account/delete'` returns empty.

- [ ] **T8.4** Confirm RLS is enabled on all four tables (`profiles`, `reminders`, `reminder_offsets`, `reminder_occurrences`).
  - Done: Supabase dashboard or `supabase db diff` confirms `ENABLE ROW LEVEL SECURITY` on all four.

- [ ] **T8.5** Confirm `POST /api/cron/send-due` returns HTTP 401 for a request with a missing or wrong `Authorization` header.
  - Done: `curl -X POST <VERCEL_URL>/api/cron/send-due` (no header) returns 401; a request with a wrong token also returns 401.

### Tasks — Onboarding Flow (can parallelize with T8.1 and T8.2)

- [ ] **T8.7** Implement `app/onboarding/page.tsx` and `app/onboarding/OnboardingFlow.tsx`: a step-by-step interactive tutorial with at least three steps — (1) explain what Forewind Mail does, (2) simulate creating a reminder with a lead time, (3) simulate marking it done. A "Skip" button is visible at every step and jumps directly to the redirect at T8.8. The tutorial does **not** insert real data — it is purely instructional UI.
  - Files: `app/onboarding/page.tsx`, `app/onboarding/OnboardingFlow.tsx`
  - Done: all steps render; "Next" and "Skip" navigation work; the final step triggers the completion action in T8.8.
  - **Human-led visual phase:** visual design, comps, and polish for the onboarding flow are a human manual phase — the agent delivers structurally correct, accessible, skippable tutorial markup only; do not choose a color palette, illustration style, or animation scheme.

- [ ] **T8.8** Implement the onboarding completion server action: sets `profiles.onboarded = true` for the signed-in user, then redirects to `/reminders`. Called by both "Finish" (end of flow) and "Skip".
  - Files: `app/actions/onboarding.ts`
  - Done: after completion or skip, `profiles.onboarded` is `true` and the user is on `/reminders`; revisiting `/onboarding` while already onboarded redirects immediately to `/reminders`.

- [ ] **T8.9** Update `middleware.ts` to implement the full three-tier routing logic:
  - Public routes `["/", "/login"]` — no auth required; signed-in users hitting `/` are redirected to `/reminders`.
  - Onboarding route `["/onboarding"]` — must be authenticated; NOT subject to the onboarded guard (prevents redirect loop).
  - All other routes — must be authenticated; if `profiles.onboarded = false`, redirect to `/onboarding`.
  - Files: `middleware.ts`
  - Done: an unauthenticated user hitting `/reminders` is redirected to `/`; a newly signed-in user (onboarded = false) hitting `/reminders` is redirected to `/onboarding`; a returning user (onboarded = true) reaches `/reminders` normally.

- [ ] **T8.10** Address any a11y and mobile layout issues in the onboarding pages flagged during manual review.
  - Files: `app/onboarding/page.tsx`, `app/onboarding/OnboardingFlow.tsx` (and any other files flagged)
  - Done: no critical a11y violations remain; mobile layout is clean at 375 px.
  - **Human-led visual phase:** visual polish, comps, and design audit for the onboarding flow (palette, animation, illustration) are a human manual phase — run by the human after T8.7–T8.9 are structurally complete, not by the implementing agent.

- [ ] **T8.11** *(Human step.)* Create a fresh test account; verify the full first-login experience: landing page → sign in → onboarding tutorial → complete/skip → reminders page. Verify a returning login skips onboarding. Record sign-off in the commit message body.
  - Done: human has verified the flow end-to-end on a real browser.

- [ ] **T8.6** *(Human step.)* Sign off the full manual checklist (T8.1–T8.5 and T8.11). Record the sign-off in the commit message body for the final deploy commit.
  - Done: human has verified all tasks; final production deploy is live and stable.
