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

1. A Conventional Commits–style summary line: `type(scope): summary`  
   (e.g. `feat(scheduling): add computeSendTime with Luxon`)
2. A body: what changed and why.
3. A co-author credit line:  
   `Co-authored-by: <model name> via <tool name>`

---

## Documentation Lookup & Sync

Before starting any task, locate and read the `.md` files relevant to that task — not only `PRD.md` and `WORKFLOW.md`, but any others that have been added as the project grows (schema docs, API docs, etc.).

After making a change whose subject is described in one of those files, update that file **in the same change** — never leave a doc stale as a separate, forgotten follow-up.

---

## Testing Constraint

**Never modify any file under the `tests/` directory.**

Tests are authored by the planning tool before each milestone's implementation begins (see `WORKFLOW.md` testing strategy). If a test appears incorrect or impossible to satisfy without modifying it, flag the issue back to planning instead of editing the test directly.
