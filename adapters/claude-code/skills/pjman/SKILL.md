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
   record of what was decided, what was tried, and what is next. Given a ticket, a URL or a file instead, run
   `pjman get <it>`: it finds the change through the graph.
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

## Tickets

The project may name its tracker (`pjman where --json` shows `tracker`). A Linear ticket is reached through the
harness's own Linear MCP connection (this plugin declares it; the person signs in once with `/mcp`); pjman never
signs in anywhere. When a ticket is named, or the project's board should reflect the tracker:

1. Read it with the tracker's tools (Linear: `get_issue` for one, `list_issues` for the team; GitHub:
   the `gh api graphql` command that `pjman sync github` prints when run without `--from`; it carries sub-issue
   parents, which `gh issue list --json` does not) and hand pjman the answer,
   as JSON, exactly as the tool returned it (`pjman sync github --from -` for GitHub):
   ```
   pjman sync linear --from - <<'EOF'
   { …the tool's result… }
   EOF
   ```
   pjman makes the source (`linear:ABC-1234`, observed state under `ext.linear`) and the change that binds it;
   title, status and parent follow the ticket; `next`, the summary, the plan and the decisions stay pjman's.
2. Then `pjman get ABC-1234` or `pjman context change:abc-1234` and work as usual. A ticket named in the prompt binds
   its change when the store has one (for a GitHub issue the hook reads it with gh and syncs it itself); otherwise the
   hook tells you to read and sync it, and the sync creates the change. A pattern match alone never creates a record.

## The product tree

What the product *is* lives in a tree beside the work: a `product:<slug>` at the root, `feature:<slug>` records nested
beneath it (`--product` for a top-level feature, `--parent` below; the level label comes from the template, feature then
capability, or `--level`), projects attached to the product (`pjman set project:<slug> product=product:<slug>`). Owners
(`owners`, a list of actors) sit on any node and are inherited downward. A change names the features it adds, changes
or removes: `--features "adds feature:<slug>"`, `"feature:<slug>"` (changes), `"removes feature:<slug>"`. Name the most
specific node, the capability rather than the feature above it; state rolls up. A feature's state is derived from those
changes (live once an adding change is done, retired once a removing one is), so prefer the verb to writing a status.
A parent change is a milestone: its progress is its children done; goals such as a release or a second user are
milestones, not features. `pjman tree [product:…|feature:…]` renders the tree with roll-ups; `pjman activity <key>` the events
beneath any node. Create a feature only when the person names a capability; a ticket label is not a feature.

## Commands you will use

```
pjman context [change:<slug>] [--all]   this project's board (--all: every project), or one change with its decisions, sources and sessions
pjman get <ref>                          anything in (key, ticket id, URL, file path, slug): the record, its edges, and every change in reach
pjman sync linear|github --from -        apply tickets observed through the tracker's tools (JSON on stdin)
pjman refs <text>                        every reference in a text (a change, a ticket in any shape, a URL) and the change it leads to
pjman ls decision --status proposed      what is waiting on a person
pjman show <key>                         one record
pjman new change|decision|source …       create (refused if it would not validate)
pjman new product|feature …              the product tree: a root, then nested features
pjman tree [product:<slug>]              the product by features: levels, derived status, owners, backlog by project
pjman activity <key> [--days 14]         the events beneath a node and what they say: last moved, done, new, blocked, waiting
pjman set <key> field=value …            authored fields: title, status, next, links, binds, summary, plan; decision, why while proposed
pjman rm <key> [--detach]                remove a record you created by mistake; refused while anything refers to it
pjman validate                           run before committing a store that lives in the project
```
