# AGENTS.md — Forewind Mail

> Operating rules for every implementing agent (OpenCode, Freebuff, Kilo, Codex, or any other tool).
> Read this file **before** touching any file in the repo.
>
> - Product scope and acceptance criteria: `PRD.md`
> - Process, milestones, testing strategy, and commit protocol: `WORKFLOW.md`
> - Milestone task breakdown: `PLAN.md`

---

## Standard Operating Constraints

- Only edit files inside the project's source directories (`app/`, `lib/`, `components/`, `supabase/migrations/`, `public/`, `styles/`). When in doubt, ask.
- Never touch `.env*` files, lockfiles (`package-lock.json`), or CI config (`.github/`) unless **explicitly instructed** for that specific task.
- Exception: an agent may append entries to `.gitignore` when a tool generates local-only files that must never be committed (e.g. CLI caches like `supabase/.temp/`). Appending only — never remove existing entries, and never edit any other file outside the source directories.
- Never add a new npm dependency without flagging it first and getting human approval before installing.
- Stop and ask before any destructive or irreversible action: deleting a file, altering a database schema, or changing auth configuration.
- Treat `PRD.md` as fixed scope for the milestone in progress — do not add features not listed there.

---

## Modularity Constraint (hard rule)

One feature's logic, TypeScript types, and tests live together and are not scattered across shared "misc" or "utils" files. Unrelated features never share a file. Extract shared code only when **at least two** features already need the same logic — never preemptively.

This is a **hard rule**, not a suggestion. It is the basis for two project goals: small blast radius (a future change reads and touches the fewest possible files) and parallel agents (independent features can be built concurrently with no merge conflicts).

---

## Parallel-Agent Flagging

Before starting implementation on a milestone, identify and **explicitly state** which features (if any) are isolated enough — no shared files, no shared database tables, no sequential dependency — to be built by separate concurrent agent sessions. Print this assessment to the console before beginning.

Do not parallelize automatically. Only surface the option so the human can decide whether to run multiple sessions.

---

## Commit Protocol

**Never run `git add` or `git commit`.** The human runs all git commands.

At each natural commit point, print to the console:

1. A summary line: first check for a project- or tool-specific commit-rules skill and follow it if one is available; otherwise use a Conventional Commits–style summary (`type(scope): summary`, e.g. `feat(scheduling): add computeSendTime with Luxon`).
2. A body: what changed and why.
3. A co-author credit line:  
   `Co-authored-by: <model name> via <tool name>`
4. A change explanation in the following template, written for the human reviewer who must commit and operate this change but doesn't hold the implementation context. Fill every slot; write `None` rather than skipping one.
   > **Narrative:** <goal → approach → how the pieces depend on each other, in dependency order not file order, 2–4 sentences; name what breaks if any one piece were missing>
   > **Decisions:** <each choice that had more than one reasonable option as one line: chosen option / rejected alternative / why; include anything flagged back to planning>
   > **Verification:** <each command run plus its result — `tsc`, `lint`, `vitest`, `build`, parsers, manual checks; never claim green without the output>
   > **Your actions:** <the `git add` / `git commit` commands, any external setup the agent cannot run (dashboards, secrets, CLI commands), and any decision still owed — nothing the human must do may live only in chat>
   > Define a jargon term inline only when misunderstanding it would change a review decision; otherwise link the file and line (`path:line`) and move on.

5. Print the commit as a paste-ready bash command: `git add <paths>` followed by `git commit -m "<summary>" -m "<body>"` — one `-m` per paragraph, no heredocs — so the human can run it unedited.

---

## Documentation Lookup & Sync

Before starting any task, locate and read the `.md` files relevant to that task — not only `PRD.md` and `WORKFLOW.md`, but any others that have been added as the project grows (schema docs, API docs, etc.).

After making a change whose subject is described in one of those files, update that file **in the same change** — never leave a doc stale as a separate, forgotten follow-up.

### Doc-edit rules (exception to the source-dirs ban)

Docs rot when agents can't touch them, so agents may edit project docs (`PLAN.md`, `PRD.md`, `README.md`, `WORKFLOW.md`) and PLAN-required root files (`middleware.ts`, root `*.config.*`) only within these limits:

1. **Status only.** Tick task checkboxes; update status prose for completed work (milestone pointers, status-value lists, done outcomes). Never rewrite requirements, reword acceptance criteria, or change scope — anything scope-shaped stops and flags to planning/human.
2. **Same change.** Doc updates ride in the same commit as the code they describe.
3. **Evidence.** Tick a box only when its Done criteria were verified with command output in this session. Human-only steps (deploys, dashboard clicks, scheduled runs) stay unchecked until the human confirms.
4. **Minimal diff.** The checkbox character or the status sentence — nothing around it.

The human reviews `git diff *.md` first, before code.

---

## Testing Constraint

**Never modify any file under the `tests/` directory.**

"Modify" means changing an existing test file. Creating new helper files under `tests/` is permitted only when the milestone's PLAN task explicitly orders it (e.g. T7.2) — those new files are frozen the same way once written.

Before implementing any milestone, verify that milestone's test files already exist; if they are missing, stop and flag back to planning instead of writing code.

Tests are authored by the planning tool before each milestone's implementation begins (see `WORKFLOW.md` testing strategy). If a test appears incorrect or impossible to satisfy without modifying it, flag the issue back to planning instead of editing the test directly.
