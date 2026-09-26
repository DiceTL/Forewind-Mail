# Product Requirements Document: Forewind Mail

## 1. Executive Summary

**Problem Statement:** People forget deadlines and commitments not because they lack tools, but because existing tools either bury reminders inside a calendar or task app they don't check, require paid SMS, or bundle so many features that setting a single reminder is more friction than it's worth.

**Proposed Solution:** Forewind Mail is a lightweight web app where a signed-in user creates a reminder — with or without a deadline — sets one or more custom lead times ("X before"), and receives a plain email at each lead time. Marking a reminder done stops all remaining emails for it, including for repeating reminders.

**Success Criteria:**
- Scheduled emails are sent within 2 minutes of their configured send time, ≥99% of the time, measured over any 30-day window.
- Zero cross-user data leaks: the row-level-security test suite has 0 failures.
- A first-time user can create a working reminder in under 2 minutes without instructions.
- Marking a reminder done cancels 100% of its remaining scheduled emails (verified by automated test).
- Runs at $0/month infrastructure cost for up to 20 active users, on free-tier Supabase, Vercel, and Gmail SMTP.

---

## 2. User Experience & Functionality

### User Persona
**The self-reminder user** — anyone who wants to be emailed ahead of something they've decided matters: a deadline, a class, an appointment, a task with no fixed date. No sub-personas or roles; every account behaves identically.

### User Stories & Acceptance Criteria

**Story 1.** As a user, I want to sign in with Google so I don't need a new password and my reminder emails go to an address I already check.
- AC: Sign-in uses Google OAuth only.
- AC: The account's Google email is used as the reminder destination and cannot be changed to a different address.

**Story 2.** As a user, I want to create a reminder with a title, an optional deadline, and one or more custom lead times, so I get warned before things are due, not at the moment they're due.
- AC: Lead times are configurable per reminder, entered in 5-minute increments, minimum 5 minutes.
- AC: A lead time that would already be in the past at creation is rejected with an inline error.
- AC: A reminder can be created with no deadline at all — just a single alert time.

**Story 3.** As a user, I want a reminder to repeat (daily, weekly on chosen days, or monthly) with no end date, so recurring things like "class tomorrow" don't need to be re-created each time.
- AC: A repeat toggle controls whether the series continues; turning it off stops future occurrences without deleting history.
- AC: Repeats have no required end date.

**Story 4.** As a user, I want to mark a reminder done from the website, so I stop receiving emails about something I've already finished.
- AC: Marking done cancels every pending scheduled email for that reminder, including the rest of a repeating series.
- AC: Emails contain no click-to-complete link; completion happens only inside the app.

**Story 5.** As a user, I want editing a reminder's deadline to reschedule its emails automatically, so I don't get a reminder timed against a deadline that no longer exists.
- AC: Changing the deadline recalculates every not-yet-sent email from the new date.
- AC: Lead times that would already be overdue at the moment of the edit are canceled, not sent as an immediate burst.

**Story 6.** As a user, I want to see whether each of my reminder emails actually sent, so I can trust the system or know when to check my inbox settings.
- AC: Each reminder's occurrences show a status: pending, sent, failed, or cancelled, with a timestamp.

**Story 7.** As a user, I want to pause all emails or delete my account, so I'm in control of a tool that has my email address.
- AC: A pause switch stops all sending immediately without deleting data.
- AC: Account deletion removes all of the user's reminders and history.

### Non-Goals (v1)
- Push notifications, SMS, or any channel other than email.
- Calendar sync or import/export (Google Calendar, ICS).
- Sharing a reminder with, or sending a reminder to, another person.
- Categories, tags, or projects.
- Native mobile apps (the web app must be usable on a phone browser, but no app-store build).
- Multi-language support.

---

## 3. Technical Specifications

### Architecture Overview
A Next.js web app (hosted on Vercel) reads and writes reminder data directly to Supabase Postgres from the client and via server actions, protected by row-level security. A database-native scheduler (`pg_cron`) calls one protected API route on the deployed app every minute; that route finds due, unsent reminder emails and sends them via Gmail SMTP, then records the result. No other backend service is required.

```
User -> Next.js (Vercel) -> Supabase (Postgres + Auth)
                                  ^
                    pg_cron (every 1 min, in Supabase)
                                  |
                    POST /api/cron/send-due (Vercel, secret-protected)
                                  |
                          Gmail SMTP -> user's inbox
```

### Integration Points
- **Auth:** Supabase Auth, Google provider only.
- **Database:** Supabase Postgres, accessed via `supabase-js` on the client and server, with row-level security enforced on every table.
- **Scheduling:** Supabase `pg_cron` + `pg_net`, calling `POST /api/cron/send-due` once per minute with a bearer-token secret.
- **Email delivery:** Gmail SMTP via a dedicated sender account, authenticated with an app password (not the account password).

### Data Model (summary — see schema migrations for authoritative definitions)
- `profiles` — one row per user: time zone, pause switch.
- `reminders` — title, optional deadline, repeat rule and toggle, status (active/done).
- `reminder_offsets` — one or more lead times per reminder.
- `reminder_occurrences` — one row per email that needs to be sent, computed from a reminder's deadline and offsets; carries send time and delivery state (pending/sent/failed/cancelled).

All timestamps are stored in UTC; each user's time zone is detected at first login (editable later) and used to convert every input and display.

### Security & Privacy
- Row-level security on every table: a user can only read or write rows tied to their own `user_id`.
- The cron route is the only endpoint that bypasses row-level security (via the service-role key), and only to send due emails across all users — it never returns user data to a caller.
- The cron route rejects any request without the correct bearer-token secret.
- The Gmail app password and Supabase service-role key are stored as server-side environment variables only, never exposed to the browser or committed to the repository.
- Emails contain no state-changing links, to avoid both phishing-lookalike risk and accidental triggering by email link-scanners.

---

## 4. Risks & Roadmap

### Phased Rollout
- **MVP (v1):** Everything in Section 2 — Google sign-in, one-off and repeating reminders, custom lead times, done/reopen, pause, delete, delivery status.
- **v1.1:** Notification preferences (e.g. a daily digest instead of separate emails), reminder search/filter as the list grows.
- **v2.0:** Optional second channel (e.g. browser push), shared/team reminders, calendar import.

### Technical Risks
- **Gmail sending limits.** A free Gmail account has daily sending caps and can be throttled if it looks automated. *Mitigation:* keep usage well under documented limits at the current scale (~20 users), and design the sender behind a swappable interface so a transactional provider (e.g. Resend, once a domain exists) can replace it without touching the rest of the app.
- **Supabase free-tier inactivity pause.** A paused project would silently stop all scheduling. *Mitigation:* verify current pause behavior before launch and add a lightweight keep-alive ping if needed.
- **Vercel serverless execution limits.** The cron route must finish sending all due emails within the platform's execution time limit. *Mitigation:* keep the per-minute batch small at this scale, and design the route to be safely re-run if it doesn't finish (no double-sends).
- **Timing precision.** "Sent within 2 minutes" depends on `pg_cron` firing reliably every minute. *Mitigation:* log every run and alert (manually, at this scale) on missed executions.
