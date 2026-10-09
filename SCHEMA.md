# pjman — schema (draft v0)

*2026-10-11. The record contract: five record types, their fields, the edge set, the status vocabulary, identity, location, validation. Storage-independent (thesis decision 28): Phase 1 implements it over files; later phases over a database. Fields are marked **A** (authored by a principal) or **D** (derived — written only by the tool that derives it, never by hand). Draft: every section is open to pushback until marked locked.*

## Principles the schema answers to

- Every field a tool reads is in frontmatter; prose is for people.
- Edges are declared on the record that made them; reverse edges are derived.
- Every record carries `id` (immutable), `writer`, `created`, `updated`.
- A principal is a person or an agent: `person:<handle>` or `agent:<name>`.
- Nothing harness-, tool- or vendor-specific in a record. Tools appear as *sources* (whose `kind` is data) and in configuration.
- Humans never type a UUID. Folders and prompts use the slug or external key; references inside records use ids.

## Records

### Product — `product.md` (one per store)

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | |
| `title` | A | string | |
| `owner` | A | principal | Defaults to the user |
| `writer`, `created`, `updated` | D | | |

Body: `## Summary`. Configuration (vocabulary mapping, adapters, location) lives in `pjman.yaml` beside it, not in the record.

### Change — `changes/<slug>/change.md`

A unit of work against the product. The slug is the bound external key (`ABC-1234`) or a short slug; it may be renamed freely because references use `id`.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | |
| `title` | A | string | |
| `status` | A | enum | From the vocabulary below |
| `owner` | A | principal | Defaults to the product owner |
| `writer`, `created`, `updated` | D | | |
| `parent` | A | change id | Optional. A milestone containing tickets; an epic |
| `binds` | A | [source id] | Identity: *this change is that ticket*. A source binds to at most one change |
| `links` | A | [source id] | Context: docs, threads, designs. Many-to-many |
| `touches` | A | [feature id] | May be empty in Phase 1 |
| `evidence` | A | [source id] | Sources that show the work: PRs, test runs, deploys |
| `next` | A | string | The handoff: the next action. What resume reads first |

Body sections: `## Summary` (required: what and why), `## Plan` (inline, or a link to `plan.md` in the same folder), `## Feedback` (review cycles, dated, newest first). There is no Conversations section: that is derived from sessions.

Decisions made in the course of a change live in `changes/<slug>/decisions/`.

### Decision — `changes/<slug>/decisions/<yyyy-mm-dd>-<slug>.md`, or `decisions/` at the store root for product-level decisions

The only record a human is expected to write. Designed so the decision is *made through* the record, not documented after it: a decision can be opened as `proposed` with a default and a due date, and becomes `decided` when a principal with authority sets it.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | |
| `title` | A | string | The decision in one line |
| `status` | A | enum | `proposed` · `decided` · `superseded` · `reverted` |
| `change` | A | change id | Optional for product-level decisions |
| `decided_by` | A | principal | The authority that set it. Required when `decided` |
| `decided_on` | A | date | Required when `decided` |
| `default` | A | string | Optional. What happens if nobody decides by `due` |
| `due` | A | date | Optional. With `default`, this is the bounded ask |
| `supersedes` | A | decision id | Optional |
| `touches` | A | [feature id] | Optional |
| `links` | A | [source id] | Optional |
| `writer`, `created`, `updated` | D | | |

Body sections: `## Decision` (what), `## Why` (rationale), `## Options` (optional, what was considered), `## Consequences` (optional).

### Source — `sources/<kind>/<key>.md`

An external thing: a ticket, an issue, a PR, a branch, a repo, a doc, a thread, a design. Small. Created on first mention, by the agent or the CLI. Holds what was last *observed* about the thing, which is how drift is detected.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | |
| `kind` | A | string | Data, from configuration: `linear-issue`, `github-issue`, `github-pr`, `git-branch`, `repo`, `doc`, `slack-thread`, `figma`, `url`, … |
| `key` | A | string | The external identifier: `ABC-1234`, `org/repo#123`, a URL |
| `url` | A | string | Optional |
| `title` | A/D | string | Authored on creation; refreshed by sync |
| `observed` | D | map | What the external system last showed: `status`, `title`, `assignee`, … Written only by a sync adapter |
| `observed_at` | D | timestamp | |
| `writer`, `created`, `updated` | D | | |

Body: optional notes. A source's `(kind, key)` is unique in the store.

### Session — `sessions/<yyyy-mm-dd>-<id8>.md`

Derived, one writer (the harness adapter that produced it), append-only. What a session was about, what it did, what it observed. Belongs to the adapters' world; the contract fixes only the shape other tools read.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | string | The harness's session id |
| `agent` | D | principal | `agent:<name>` |
| `on_behalf_of` | D | principal | The person the session ran for |
| `started`, `updated` | D | timestamp | |
| `change` | D | change id | Currently bound change, or none |
| `changes` | D | [change id] | Every change bound, in order |
| `goal` | D | string | |
| `next` | D | string | What the machine thinks is next; the change's `next` is authoritative |
| `observed` | D | [edge] | Observed edges: `{edge, from, to, at}` — e.g. `{edge: links, from: <change>, to: <source>, at: …}` |

Body: `## Log` (numbered, one entry per turn that took action, append-only; each entry notes the bound change), `## Links`.

### Feature — `features/<slug>/feature.md`

Minimal in Phase 1; present so changes can point at it and the tree arrives without a migration.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | |
| `title` | A | string | |
| `parents` | A | [feature id] | Zero or more (thesis decision 25) |
| `owner` | A | principal | Inherits along a single parent line; required when several parents |
| `affects` | A | [feature id] | |
| `claim` | A | string | Optional maturity claim, e.g. `prototype`, `holds 1k users` |
| `evidence` | A | [source id] | Optional |
| `writer`, `created`, `updated` | D | | |

Body: `## Summary`.

## Edges

Declared on the record that made them. The set is data; this is the default.

| Edge | From → To | Cardinality | Declared on |
|---|---|---|---|
| `binds` | change → source | source: at most one change | change |
| `links` | change · decision · feature → source | many-to-many | the referrer |
| `evidence` | change · feature → source | many-to-many | the referrer |
| `touches` | change · decision → feature | many-to-many | the referrer |
| `parent` | change → change | one | change |
| `parents` | feature → feature | many | feature |
| `affects` | feature → feature | many | feature |
| `change` | decision → change | one | decision |
| `supersedes` | decision → decision | one | decision |
| observed `{edge, from, to}` | session → any of the above | append-only | session |

Derived (never written): a change's decisions; a source's change; a feature's children and where-used; a change's sessions; a decision's superseded-by.

## Status vocabulary (default; mapped by configuration)

| Status | Meaning |
|---|---|
| `open` | Declared; nobody working on it |
| `planning` | Being shaped; a plan is forming |
| `active` | Work underway |
| `blocked` | Waiting on something named in `next` |
| `review` | Work complete, awaiting acceptance |
| `done` | Accepted |
| `dropped` | Closed without acceptance |

`pjman.yaml` maps an organisation's words onto these (`implementing: active`, `merged: done`, Linear's and Jira's state names); views read the canonical set. A source's `observed.status` is the external system's word, mapped the same way; where it disagrees with the change's `status`, that is drift.

## Identity

- `id` is a UUID v7, generated at creation, immutable, the only thing references point at.
- Folders are named by slug or external key and may be moved or renamed; the index re-resolves by `id`.
- The CLI accepts a full id, a unique prefix, a slug, or a bound external key.

## Location

A **store** is a directory holding `pjman.yaml`, `product.md`, `changes/`, `decisions/`, `sources/`, `sessions/`, `features/`.

- **In the repository:** `.pjman/` at the repository root.
- **In user space:** `~/.pjman/stores/<product-slug>/`, with `~/.pjman/config.yaml` mapping paths (or repositories) to stores.
- Resolution: walk up from the working directory for `.pjman/`; else consult the user map; else none.
- The same record shape in either.

## Validation (the CLI is the schema)

- Frontmatter parses; required fields present; enums in range; ids well-formed; timestamps ISO 8601.
- Every referenced id exists in the store.
- A source binds to at most one change; `(kind, key)` unique among sources.
- A `decided` decision has `decided_by` and `decided_on`; a `superseded` one is pointed at by a newer decision's `supersedes`.
- A feature with several `parents` names its own `owner`.
- Derived fields are never changed by hand: the index compares each record's derived fields with what the deriver last wrote and reports a mismatch as drift.
- Invalid records are reported, never silently skipped.

## Open points in this draft

1. `next` on the change (authored) *and* on the session (derived) — both, or one?
2. `parent` on a change: needed in Phase 1, or scope creep until milestones exist?
3. `evidence` as its own field versus a `links` entry whose source kind says it's evidence. Own field, because acceptance reads it — least certain choice here.
4. Decisions opened as `proposed` with `default` and `due`: the bounded ask, single-player. Keep, or defer to Phase 3?
5. Session `observed` edges: attributed per entry to the change bound at that moment. Enough, or does an observed edge need a confidence?
6. `sources/<kind>/<key>.md` where `key` can be a URL — needs a safe filename rule.
