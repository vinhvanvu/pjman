---
name: pjman
description: >-
  Working in a project that has a pjman store (`pjman where` succeeds). Use before starting, resuming or handing off
  work on a change, and before any choice that forecloses options: read the change's context, open a decision
  `proposed` before acting, keep the plan's steps true. Prescribes what gets recorded, never how the work is done.
---

## What the store is

A pjman store is the project's context graph: changes (units of work), decisions (what was chosen and why),
sources (tickets, PRs, docs, files), sessions (runs like this one) and actors. The session-start hook has
already put `pjman context` in front of you; this run's records carry `session:<id>` automatically.

Every write goes through the `pjman` command. Never edit a file under the store directly.

Keys are a namespace and a slug: a feature, a change and a decision are keyed under their product
(`change:<product>/<slug>`, `decision:<product>/<change>/<slug>`); people, projects, sessions and sources are keyed
in the store. Inside this project the slug alone names a record (`change:<slug>`, `feature:<slug>`), and that is how
the context prints them; write the full key only for something in another product. JSON output carries full keys.

## What a record is made of

A change and a decision read as a ladder (decision record-foundation/the-ladder): a **name** (one to four words:
which one in a crowd), a **gist** (one line: what it is and why), then the **foundation**, written in full and never
summarised. A change's foundation is its sections, in order of depth: **Origin** (where the work came from, as it was
said: the person's words quoted, or the key of the ticket, change or decision it came from, linked and never copied),
**Intent** (the need, and for whom; it opens with the need in a sentence or two), **Done when** (the outcome that
closes it), then as the work reaches them **Scope** (in, and deliberately out), the **plan** (steps as data, through
`pjman step`), **Open questions**, **Blocked on** (an outside blocker; a blocking change is `depends_on`), **Notes**.
A decision's foundation is a **thread**, append-only: the question, criteria, options with their case, the
recommendation with its reasoning, the person's comments in their own words, rejections, the acceptance. Status,
progress, the next step, what waits on whom and what happened since are derived; never write them as text. There is
no title, summary or next: a title is a name or a gist, a summary is the Intent, next is the plan's first open step.

The name and gist are written from the foundation. A write to Origin, Intent or Done when (a decision's question,
recommendation or acceptance) without them leaves them **stale**, and the context says so: rewrite them in the same
write. An ingested or migrated record says what it still **needs** (name, gist, intent, done when): write those before
working it.

## Rules

1. **Read before acting.** When a change is named or implied, run `pjman context change:<slug>` first. It is the
   record of what was decided, what was tried, and where the plan stands. Given a ticket, a URL or a file instead, run
   `pjman get <it>`: it finds the change through the graph. Its **Aspects** section, when there is one, is the
   contract the work is done under (how text reads, how the app moves, a shared component): follow the `aspect`
   skill for it, and for anything that creates or edits an aspect.
2. **Open a decision `proposed` before acting on a choice that forecloses options** (a data model, a boundary, a
   dependency, a scope cut, anything a later reader would ask "why?" about), with the options laid out and one
   recommended:
   ```
   pjman decision <change-slug>/<decision-slug> --name "…" --gist "<the question and the recommended answer, in a line>" \
     --question "…" [--criterion "…"]… --option <id>="…" --option <id>="…" [--case <id>="what it costs, what it rules out"]… \
     --recommend <id>="why it beats the others"
   ```
   It is created `proposed`. The same command adds to it later: a reframed `--question`, a new `--option`, the
   person's words as `--comment "…" --by person:<handle>`, `--reject <id>="why"`, a moved `--recommend`; large ones as
   JSON on stdin (`--from -`). **Never accept a decision on your own judgment**; deciding is the person's. Say in your
   reply that a decision is open and what you recommend. **When the person decides in chat ("agreed", "go", "accept
   it"), that is the decision: record it at once**, never hand them the command:
   `pjman decision <change>/<slug> --accept <id>="<their words>" --by person:<handle> [--revisit "<when to look again>"]`.
   The agreement also covers what follows from it: the build, the merge once reviewed, the install, the worktree's
   removal, the change's status. Carry that chain out and report it; an approval that repeats one already given
   ties up the person. Ask only for what the agreement did not settle. A change or a decision that spawns new work
   is the new change's Origin.
3. **Keep the plan true.** The plan is steps written only through commands: `pjman step <change> add "…"`, `start
   <n>`, `done <n> [--note "…"]`, `drop <n>`, `note <n> "<where the work stands>"`, `move <n> --before <m>`. Before
   you stop on a change, leave the plan where the work stands: the step in progress noted, the next one first among
   the open ones, an outside blocker in `blocked-on=…`, and the status if it moved (`open, planning, active, blocked,
   review, done, dropped`). Whoever resumes reads the next step, not a handoff paragraph.
4. **A new unit of work is a change, filed through intake.** Follow the `intake` skill first: `pjman intake "<the
   request>"` shows what already exists (duplicates, the nodes it may alter, the milestones, the order's tail); then
   ```
   pjman new change <slug> --name "…" --gist "…" --origin "<the request in the person's words, or the key it came from>" \
     --intent "…" --done-when "…" [--scope "…"] [--open-questions "…"]
   ```
   with its answers; the tool binds this run to the change it
   creates. Otherwise a session binds only from what it does: a change the person's prompt names (one; a prompt naming
   several binds none), its branch. Never from your reply, and a write to a change does not bind it. Reading a change's
   context (`pjman context change:<slug>`) moves the session's focus, which the dock follows, so read it when the
   conversation moves to another change. Name the change as `change:<slug>` in your reply so the person can too. When
   the work is a change you did not create and the prompt did not name, bind it: `pjman session bind <session-id>
   change:<slug>` (the id is in the session-start context); one bound in error is backed out with `pjman session unbind`.
   On every prompt the harness hands you the brief: what others changed on your bound change, its milestone, its
   decisions and its dependencies since your last brief, and other live sessions near it. Act on what it says.
5. **Things outside the store are sources:** link them by key (`--links file:path`, `github-pr:owner/repo#1`,
   `url:https://…`); a record for a source is optional.
6. **Nothing harness-specific in a record.** No tool names, model names or session mechanics in titles, summaries or
   decisions. Those belong to this adapter.
7. **One worktree per change; the harness makes it, you name it, you clean it up.** Before the first edit on a change,
   enter a worktree named for it: the name is the change slug (`pjman context change:<slug>` shows it on the `branch:`
   line; `pjman new change` prints it), the harness creates the worktree and its branch (`claude --worktree <slug>`, or
   the enter-worktree tool in a running session). A session on a branch so named is bound to the change at start, with
   no prompt. Two sessions on one change share its worktree. When you stop, leave the worktree clean or committed so the
   harness can remove it on exit. Once the person has approved the work, merge the branch into main yourself, then remove
   the worktree and its branch before the change is set done (`git worktree remove <path> && git branch -d <branch>`;
   the project's own instructions say what an install after a merge takes); the session-start context names any
   worktree whose change is done and whose branch is merged, so a leftover is seen the next time someone sits down.
   pjman creates and removes no worktree itself.

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
   pjman makes the source (`linear:ABC-1234`, observed state under `ext.linear`) and, when no change binds it yet, the
   change: its Origin links the ticket, its gist is a draft from the ticket's title, and it says what it needs. pjman
   is the source of truth (decision record-foundation/pjman-is-the-source-of-truth): the ticket is one more source,
   often inaccurate or unfounded, so read it as input and write the change's name, intent and done-when from your own
   analysis before working it; status and parent are pjman's, and later syncs touch only the source, the binding and
   the owners.
2. Then `pjman get ABC-1234` or `pjman context change:abc-1234` and work as usual. A ticket named in the prompt binds
   its change when the store has one (for a GitHub issue the hook reads it with gh and syncs it itself); otherwise the
   hook tells you to read and sync it, and the sync creates the change. A pattern match alone never creates a record.

## The product tree

What the product *is* lives in a tree beside the work: a `product:<slug>` at the root, `feature:<slug>` records nested
beneath it (`--product` for a top-level feature, `--parent` below; the level label comes from the template, feature then
capability, or `--level`), projects attached to the product (`pjman set project:<slug> product=product:<slug>`).

The levels are defined by the question each answers and who asks it, never by size. **Product**: the thing with a name
and users; asked about by everyone. **Feature**: what the product does for a person, nameable in a sentence a user
would recognise; asked about by owners and users; the top level of the map. **Capability**: a distinct behaviour a
change can add, change or remove; asked about by builders and agents; the most specific node a change names. A
capability may hold capabilities (anything deeper keeps the last label); a product that outgrows one map may set its
own levels (`--levels area feature capability`). File by these definitions: a new behaviour inside a feature is a
capability beneath it, not a new feature; a thing a user would name on its own is a feature. Owners
(`owners`, a list of actors) sit on any node and are inherited downward. A change names the features it adds, changes
or removes: `--features "adds feature:<slug>"`, `"feature:<slug>"` (changes), `"removes feature:<slug>"`. Name the most
specific node, the capability rather than the feature above it; state rolls up. A feature's state is derived from those
changes (live once an adding change is done, retired once a removing one is), so prefer the verb to writing a status.
A parent change is a milestone: its progress is its children done; goals such as a release or a second user are
milestones, not features. `pjman tree [product:…|feature:…]` renders the tree with roll-ups; `pjman activity <key>` the events
beneath any node. Create a feature only when the person names a capability; a ticket label is not a feature. Give it `--name`, one to
three words: the label trees and chips show (the title stays the sentence). When `pjman context` opens with "no product
map", or the person asks for the map to be regrouped, follow the `map` skill: it surveys, proposes the whole tree in a
proposed decision, and applies it only on the go, as one batch. Never grow a map one guess at a time.

## Commands you will use

```
pjman context [change:<slug>] [--all]   this project's board (--all: every project), or one change with its decisions, sources and sessions
pjman get <ref>                          anything in (key, ticket id, URL, file path, slug): the record, its edges, and every change in reach
pjman sync linear|github --from -        apply tickets observed through the tracker's tools (JSON on stdin)
pjman refs <text>                        every reference in a text (a change, a ticket in any shape, a URL) and the change it leads to
pjman ls decision --status proposed      what is waiting on a person
pjman show <key>                         one record
pjman new change|source …                create (refused if it would not validate): a change with its name, gist, origin, intent, done-when
pjman decision <change>/<slug> …         a decision at any size, one commit: created, added to, accepted by the person, reopened
pjman step <change> add|start|done|drop|note|move|reopen …   the plan, steps as data; every move an event
pjman new product|feature …              the product tree: a root, then nested features
pjman tree [product:<slug>]              the product by features: levels, derived status, owners, backlog by project
pjman activity <key> [--days 14]         the events beneath a node and what they say: last moved, done, new, blocked, waiting
pjman set <key> field=value …            authored fields: name, gist, status, links, binds; the sections origin, intent, done-when, scope, open-questions, blocked-on, notes
pjman rm <key> [--detach]                remove a record you created by mistake; refused while anything refers to it
pjman mv <key> <new key>                 rename a change or a feature (the old slug stays an alias); every reference follows
pjman whoami [--verify]                  who the person is: handle, record, accounts (the first of a handle kind is primary); --verify asks the apps. A rename (pjman mv person:<old> person:<new>) or a claim of an account is the person's act: offer it, never run it unasked
pjman apply - --for <key>                many writes as one commit, the commands one per line on stdin; pjman undo reverts it
pjman note <change|session:<id>> <text>  a note to whoever works a change, or to one session; it arrives in full in the next brief
pjman validate                           run before committing a store that lives in the project
```
