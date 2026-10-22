---
name: pjman
description: >-
  Working in a project that has a pjman store (`pjman where` succeeds). Use before starting, resuming or handing off
  work on a change, and before any choice that forecloses options: read the change's context, open a decision
  `proposed` before acting, keep `next` current. Prescribes what gets recorded, never how the work is done.
---

## What the store is

A pjman store is the project's context graph: changes (units of work), decisions (what was chosen and why),
sources (tickets, PRs, docs, files), sessions (runs like this one) and actors. The session-start hook has
already put `pjman context` in front of you; this run's records carry `session:<id>` automatically.

Every write goes through the `pjman` command. Never edit a file under the store directly.

## Rules

1. **Read before acting.** When a change is named or implied, run `pjman context change:<slug>` first. It is the
   record of what was decided, what was tried, and what is next.
2. **Open a decision `proposed` before acting on a choice that forecloses options** (a data model, a boundary, a
   dependency, a scope cut, anything a later reader would ask "why?" about):
   ```
   pjman new decision <change-slug>/<decision-slug> --title "…" --decision "…" --why "…"
   ```
   It is created `proposed`. **Never set a decision `decided`**; that is the person's. Say in your reply that a
   decision is open and what you recommend. If the person decides in chat, record it:
   `pjman set decision:<change>/<slug> status=decided decided_by=person:<handle> decided_on=<yyyy-mm-dd>`.
3. **Keep `next` true.** Before you stop on a change, set the handoff:
   `pjman set change:<slug> "next=…"` and the status if it moved (`open, planning, active, blocked, review, done, dropped`).
4. **A new unit of work is a change:** `pjman new change <slug> --title "…" --summary "…"`, then bind this run to it:
   `pjman session bind <session-id> change:<slug>` (the id is in the session-start context). The hook binds only what
   the person's prompt names, never your reply. Name the change as `change:<slug>` in your reply so the person can too.
5. **Things outside the store are sources:** link them by key (`--links file:path`, `github-pr:owner/repo#1`,
   `url:https://…`); a record for a source is optional.
6. **Nothing harness-specific in a record.** No tool names, model names or session mechanics in titles, summaries or
   decisions. Those belong to this adapter.

## Commands you will use

```
pjman context [change:<slug>]           the board, or one change with its decisions, sources and sessions
pjman ls decision --status proposed      what is waiting on a person
pjman show <key>                         one record
pjman new change|decision|source …       create (refused if it would not validate)
pjman set <key> field=value …            authored fields: title, status, next, links, binds, summary, plan; decision, why while proposed
pjman validate                           run before committing a store that lives in the project
```
