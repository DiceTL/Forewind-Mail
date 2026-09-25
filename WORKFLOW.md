# Build Workflow: Forewind Mail

This document covers *how* Forewind Mail gets built: the tool chain, the
order of work, how tests are used to keep AI-generated code honest, and
the manual setup steps no AI can do. Product requirements live in
`PRD.md`; this file assumes that document as its source of truth for
scope and behavior.

---

## Tool Chain

| Role | Tool (not yet fixed — pick per session) |
|---|---|
| Planning (writes the PRD, this doc, `AGENTS.md`, and per-milestone tests) | Antigravity, Cursor, or Kiro |
| Implementation (writes application code) | OpenCode, Freebuff, Kilo, or Codex |
| Human | Reviews diffs, runs the setup checklist, approves merges/deploys, runs `git add`/`git commit` |

Keeping planning and implementation in separate tools is deliberate: the
tool that writes a milestone's tests is never the tool that has to make
them pass, so there's no incentive (deliberate or accidental) to loosen
a test to get it green. This holds regardless of which specific tools
fill each role — the split matters, not the brand.

Whichever implementation tool is used, it must follow `AGENTS.md` (see
below), which governs code organization, commit behavior, and how it
locates relevant documentation before making changes.

**Rules for the implementer:**
- Never modify a file under the tests directory. If a test seems wrong,
  flag it back to planning rather than editing it directly.
- Treat `PRD.md` as fixed scope for the milestone in progress — don't
  add features not listed in it.

**Rules for the human reviewer:**
- After each milestone, check `git diff` scoped to the tests directory
  before anything else. It should be empty (planning wrote them before
  the milestone started, and the implementer didn't touch them).
- Only merge/deploy a milestone once CI is green.

---

## Testing Strategy: Contracts First, Tests Per Milestone

Tests are **not** written all at once before any code exists. Contracts
(database schema, function signatures, API routes) are defined once, up
front, in the PRD's Technical Specifications section. Then, before each
milestone begins, planning writes that milestone's tests against those
already-defined contracts. This avoids two failure modes: tests written
against guessed interfaces that don't match what gets built, and UI
tests written before any UI exists.

**Where tests matter most:** the scheduling logic (offset math, minimum
lead time, offsets longer than time remaining, repeats, time zones and
daylight saving, deadline edits re-arming reminders, "done" canceling a
series) is the core of the product and the hardest part to verify by
eye. It gets the deepest test coverage. The email sender is tested with
a fake clock and a fake mailer. The frontend gets a handful of
end-to-end tests of the main flows, not exhaustive coverage.

Every test:
- Runs in CI (GitHub Actions) on every push.
- Tests observable behavior ("editing the deadline re-arms reminders"),
  not implementation details, so honest refactors don't break it.
- Blocks deployment when it fails — Vercel deploys only after CI passes.

---

## Modularity & Parallel Agents

`AGENTS.md` (generated separately — see "Generating AGENTS.md and the
Plan" below) is the binding source of truth for code organization. In
summary: code, files, and directories must be split so that a typical
change touches the fewest possible files, and so that unrelated
features never share a file. This isn't just tidiness — it's what
makes two things possible:

- **Small blast radius.** When something needs to change later, an AI
  agent should be able to find and touch only the directly relevant
  files, not reason about the whole codebase.
- **Parallel agents.** Once two features are truly independent (no
  shared files, no shared database tables, no sequential dependency),
  separate agent sessions can work on them at the same time.

**Whoever is planning a milestone must flag, before implementation
starts, which of that milestone's features are isolated enough to
build in parallel** — naming the specific features and confirming they
share no files or tables — so the human can decide whether to run
multiple agent sessions concurrently. Don't parallelize by default;
only when the planner has explicitly confirmed isolation.

---

## Commit Protocol

Atomic commits: one logical change per commit, so history is easy to
navigate and revert. The human runs every `git add` and `git commit` —
no AI tool executes git commands. Instead, whenever an implementing
agent reaches a point that should be committed, it prints to the
console:

- A short summary of what changed and why (the commit message body).
- Which AI model and which agent/tool produced the change (e.g.
  `Co-authored-by: <model> via <tool>`), so history shows authorship
  the way a human co-author would be credited.

The implementing agent follows the Conventional Commits format
(`type(scope): summary`, e.g. `feat(reminders): add 5-minute offset
validation`) for the message it prints. No commit-convention skill was
found in the available skill catalog for this to defer to, so
Conventional Commits — a public, well-established standard — is the
fallback used instead; `AGENTS.md` should still direct the agent to
check for a project- or tool-specific commit-rules skill first, in
case one becomes available later.

---

## Keeping Documentation in Sync

As more documents get added later (schema docs, API docs, etc.),
`AGENTS.md` requires that before starting any task, the agent locates
the `.md` files relevant to that task (not just the PRD and this
Workflow doc), and that after making a change whose subject is
described in one of those files, the agent updates that file in the
same change — never leaving a doc stale as a separate, forgotten
follow-up.

---

## Generating AGENTS.md and the Plan

`ANTIGRAVITY-PROMPT.md` is a standalone prompt for the planning tool to
generate `AGENTS.md` and a milestone-by-milestone plan from the PRD and
this Workflow doc. Run it once at project start, and again if the PRD
or this doc changes significantly enough to warrant regenerating them.

---

## Milestones

Each milestone ships a working, deployed increment.

### M1 — Boilerplate & deploy skeleton
Next.js + TypeScript, Tailwind, shadcn/ui, ESLint + Prettier, Vitest +
Playwright installed with one trivial passing test each. GitHub Actions
runs install/lint/test/build on every push. Repo connected to Vercel; a
bare page deploys successfully.
**Pass/fail:** CI green; live Vercel URL loads.

### M2 — Schema & contracts
All tables from the PRD's data model created as Supabase migrations,
with row-level security policies and check constraints (5-minute
increment rule on offsets). TypeScript types written to match.
**Pass/fail:** migrations apply cleanly to a fresh Supabase project; a
manual insert as user A is invisible to user B via the client.

### M3 — Scheduling core (test-first)
Pure functions: compute send time from deadline + offset; validate
offsets; compute the next occurrence from a repeat rule; recompute
occurrences on deadline edit; cancel occurrences on "done."
**Pass/fail:** Vitest suite covers normal cases, boundary cases (exact
5-minute minimum, offset equal to time remaining), repeats, time
zone/DST transitions, and "done cancels the series" — all green, all
written before the functions and not modified after.

### M4 — Delivery pipeline
`POST /api/cron/send-due`, protected by a secret. Claims due pending
occurrences, sends via Gmail SMTP, updates delivery state, retries
failures, respects the pause switch. `pg_cron` scheduled to call it
every minute.
**Pass/fail:** a manually inserted occurrence with a past send time
results in a real email arriving within ~2 minutes when the cron fires.

### M5 — Auth & isolation
Google sign-in; a profile row created on first login with detected
time zone. Every page and server action checks the authenticated user.
**Pass/fail:** Playwright test signs in as two seeded test users and
confirms neither can read, edit, or complete the other's reminders.

### M6 — Frontend
Create/edit reminder form (title, optional deadline, multiple lead
times with a 5-minute stepper, repeat toggle + pattern). List view with
next send time and delivery status per occurrence. Mark done / reopen.
Settings: time zone, pause, delete account.
**Pass/fail:** manual + Playwright coverage of create, edit (re-arms
schedule), mark done (cancels series), pause, delete.

### M7 — End-to-end tests
Full Playwright flow: sign up → create reminder → seed a due occurrence
→ confirm email arrives → mark done → confirm no further emails.
**Pass/fail:** full suite green in CI.

### M8 — Polish & review
Empty/error states, mobile layout check. Security pass: confirm the
service-role key never reaches the client, confirm RLS on every table,
confirm the cron route rejects a missing/wrong secret.
**Pass/fail:** manual checklist signed off.

---

## Human Setup Checklist

Steps no AI tool can do, because they involve external accounts and
secrets. Complete 1–5 before Milestone 1; 6 after the first deploy.

1. **GitHub** — create a private repo. Confirm `.env*` is gitignored
   from the first commit.
2. **Supabase** — create a free project. Save the project URL, the
   anon key, and the service-role key (server-only, never exposed to
   the browser).
3. **Google OAuth** — in Google Cloud, create a project, configure the
   OAuth consent screen, and create a Web OAuth client using Supabase's
   callback URL as the redirect URI. Enable the Google provider in
   Supabase with that client ID/secret. Add test users while the app is
   in "Testing" publishing status.
4. **Sender Gmail account** — a brand-new **personal** Google account
   (not a paid Google Workspace/business account, and not your own
   personal address), used only for sending these emails. Enable
   2-step verification, generate an app password, and store the app
   password as a secret (not the account password).
5. **Test accounts** — at least two more Gmail accounts, to verify
   isolation between users.
6. **Vercel** — connect the GitHub repo, add all environment variables
   (Supabase keys, Gmail credentials, a random cron secret). After the
   first deploy, enable `pg_cron`/`pg_net` in Supabase and schedule the
   per-minute job to call the cron route with that secret. Check
   Supabase's current free-tier inactivity-pause behavior and add a
   keep-alive ping (e.g. a scheduled GitHub Actions job) if needed.

---

## Open Assumptions

These are working assumptions, not settled requirements — flag if any
should change:
- A reopened "done" reminder requires manual review of the deadline
  before it resumes sending; reopening doesn't recompute automatically.
- "Not late" (PRD Success Criteria) is defined as sent within ~1–2
  minutes of the scheduled time, with automatic retry and catch-up
  after downtime — not a hard real-time guarantee.
