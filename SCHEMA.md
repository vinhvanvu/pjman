# pjman — schema v3 (Phase 1)

*2026-10-12. The record contract for Phase 1, after adversarial round 1 (`reviews/2026-10-11-schema-adversarial/`). Phase 1 is layers 0–2: core, sources, work. Layer 3 (product, features) and layer 4 (authority) are not specified here; the Phase 2 target that includes them is `SCHEMA-PHASE2.md` when it is written. Fields are marked **A** (authored by an actor on intent; may be hand-edited) or **M** (maintained by one named writer — an adapter or the tool; hand edits are reported, not forbidden). There is no "derived and checked" class: nothing in a record is verified against what a tool previously wrote.*

```
2 · Work      change, decision, the status vocabulary
1 · Sources   source
0 · Core      references, actors, sessions, the envelope, validation, the index, location, configuration
```

A record may reference records of its own layer or a lower one. The envelope's `writer` and `session` are provenance, not domain edges, and are exempt. An observed edge is a record *of* an edge between two other records; it must be a valid edge type between its endpoints' layers, and it is evidence, never truth.

---

## Layer 0 · Core

### References are keys, not ids

Inside records, every reference is a human-readable key. Ids exist only in the index.

| Kind | Key form | Example |
|---|---|---|
| actor | `person:<handle>` · `agent:<handle>` | `person:vinh`, `agent:claude-code` |
| change | `change:<slug>` | `change:schema` |
| decision | `decision:<change-slug>/<decision-slug>` · `decision:/<slug>` for store-level | `decision:schema/layered-minimal` |
| source | `<kind>:<key>` | `linear:ABC-1234`, `github-pr:acme/app#123`, `file:THESIS.md`, `url:https://…` |
| session | `session:<harness-session-id>` | `session:8b4adf71-…` |

A key is resolved by the tool; a reference to a record that does not exist is a validation error — except a **source**, which may exist only as a key (see layer 1).

### The envelope — every record

| Field | A/M | Notes |
|---|---|---|
| `writer` | M | The actor that created the record, when a tool or adapter created it. Absent on a hand-written record |
| `session` | M | The session that created it, when an adapter created it. Absent otherwise |
| `created` | M | Date. Set by the tool at creation; a hand-written record may set it |
| `ext` | — | Extension namespace, `ext.<owner>.<field>`, one writer per `<owner>` subtree. Preserved structurally (a YAML round-trip may reformat it); never validated |

No `id`, no `type` (the folder is the type), no `updated` (git has it).

### Actor — `actors/<handle>.md`, optional

A record for an actor exists only when there is something to say about one. References to `person:x` / `agent:x` do not require a record. **An actor is a definition; a session is a run; a spawn is a session, never an actor.**

| Field | A/M | Notes |
|---|---|---|
| `kind` | A | `person` · `agent` |
| `name` | A | Optional |
| `url` | A | Optional: a profile, an agent's definition. A scalar, not an edge |

### Session — `sessions/<yyyy-mm-dd>-<harness-session-id>.md`

A run. Written by one adapter; append-only; never hand-edited (a store's bootstrap session, if any, says so in its body).

| Field | A/M | Notes |
|---|---|---|
| `agent` | M | Actor key |
| `on_behalf_of` | M | Actor key: the person the run worked for |
| `started` | M | Timestamp |
| `parent` | M | Session key, optional: the run that spawned this one |
| `changes` | M | Change keys bound during the run, in order |
| `observed` | M | List of `{edge, from, to, at}` — edges the run noticed; keys, not ids |

Body: `## Log`, append-only, one entry per turn that took action. Code decides whether a turn took action; a model may write the sentence.

### Validation — the tool is the schema

- Frontmatter parses under the YAML rule: any scalar containing `: `, `#`, or starting with a special character is quoted. `pjman fmt` normalises; `pjman validate` reports.
- Required fields present; enums in range; every referenced key resolves (sources exempt); a `superseded` decision is pointed at by a newer decision's `supersedes`; a `decided` decision has `decided_by` and `decided_on`.
- Uniqueness: one folder per change slug (the tool refuses a second; two machines creating the same slug meet a git add/add conflict at merge, visible, never silent); one decision slug per change folder; one source per canonical key (kind lower-cased; URL keys normalised; ticket keys verbatim); one actor record per handle.
- Renames go through `pjman mv <old> <new>`: the folder moves, the old slug is appended to `aliases`, and every reference in the store is rewritten in one commit. Keys make renames a tool operation where ids made them free; `aliases` keeps stale references resolvable in between.
- An invalid record is reported with its path and reason, never dropped silently; a reference to a record that exists but fails to parse is "resolved, invalid", not "missing".
- Nothing in `ext` is validated.

### The index

SQLite, in `.pjman/index.db`, git-ignored, rebuilt from the records by `pjman index`, disposable. It mints and holds ids (UUID v7) for every record and maps keys to them; it holds reverse edges and the query surface. If two changes bind one source, or two records resolve to one key, the index records a **conflict** and reports it; nothing wins silently.

### Provenance

`writer` and `session` on records that adapters write; `parent`, `agent`, `on_behalf_of` on sessions; git for the rest. An adapter that commits records adds a `Pjman-Session: <id>` trailer. Provenance is a property of the Phase 1 backend (files in git), not a claim about every backend.

### Location and configuration

A **store** is a git repository (or a tracked directory within one) holding `pjman.yaml`, `changes/`, `decisions/`, `sources/`, `sessions/`, `actors/`, and `index.db` (ignored). Which repository is a choice made at `pjman init`:

| Mode | Where | History |
|---|---|---|
| **In-project** | `<repo>/.pjman/`, tracked | The project's commits; a decision can be reviewed in the same PR as the work |
| **Standalone** | `~/.pjman/stores/<name>/`, its own repository, bound to one or more project paths in `~/.pjman/config.yaml` | Its own; pushed to its own private remote or not at all. The project repository is untouched; sessions never appear in product PRs |

Resolution: walk up from the working directory for a tracked `.pjman/`; else the user map; else none. The record shape is identical in both modes. Everything this schema says about provenance, history and merge holds in either; only whose history differs.

`pjman.yaml`: `name`, `layers: [core, sources, work]`, `vocabulary:` (organisation word → canonical status), `source_kinds:`. Configuration is never in a record.

---

## Layer 1 · Sources

### Source — `sources/<kind>/<key-slug>.md`, optional per source

A thing outside the store: a ticket, a PR, a branch, a repo, a doc, a thread, a file in the repository. **A source may exist only as a key** — `links: [github-pr:acme/app#123]` is complete without a file. A record is created when there is something to say about the source, or when a sync adapter (Phase 2) has observed it.

| Field | A/M | Notes |
|---|---|---|
| `kind` | A | From `source_kinds` |
| `key` | A | Verbatim external identifier |
| `title` | A | Optional |
| `url` | A | Optional |
| `links` | A | Optional: source keys this source refers to |

Filename: `kind` lower-cased; key slugified (dots, slashes, spaces → hyphens, lower-cased); URL keys hashed to a short token. The verbatim key is in frontmatter. Observed state (`observed`, `observed_at`) is Phase 2, with the first sync adapter; until then a source holds nothing an adapter wrote.

---

## Layer 2 · Work

### Change — `changes/<slug>/change.md`

| Field | A/M | Notes |
|---|---|---|
| `title` | A | |
| `status` | A | One canonical word from the vocabulary |
| `binds` | A | Optional. Source keys this change *is*: `[linear:ABC-1234]`. A source binds at most one change; a second bind is a reported conflict |
| `links` | A | Optional. Source keys: PRs, branches, docs, threads, files. The kind says what each is |
| `next` | A | The handoff: the next action. What resume reads first |
| `aliases` | A | Former slugs, appended by `pjman mv`. A reference to an alias resolves and is reported as "resolves via alias" |

Body: `## Summary` (required), `## Plan` (optional; or `plan.md` beside it), anything else free. Decisions made in the course of the change live in `changes/<slug>/decisions/`.

### Decision — `changes/<slug>/decisions/<yyyy-mm-dd>-<slug>.md`, or `decisions/<yyyy-mm-dd>-<slug>.md` at the store root

Opened `proposed` before the work it governs; `decided` when an actor sets it. A decision written after the fact is allowed and is the pattern the test tallies against.

| Field | A/M | Notes |
|---|---|---|
| `title` | A | |
| `status` | A | `proposed` · `decided` · `superseded` · `reverted` |
| `decided_by` | A | Actor key; required when `decided` |
| `decided_on` | A | Date; required when `decided` |
| `supersedes` | A | Optional decision key |
| `links` | A | Optional source keys |

Body: `## Decision`, `## Why`; anything else free.

### Status vocabulary

| Status | Meaning |
|---|---|
| `open` | Declared; nobody working on it |
| `planning` | Being shaped |
| `active` | Work underway |
| `blocked` | Waiting on something named in `next` |
| `review` | Work complete, awaiting acceptance |
| `done` | Accepted |
| `dropped` | Closed without acceptance |

The canonical word is what is written in the file. `vocabulary:` in `pjman.yaml` maps an organisation's words (a tracker's state names) onto it for adapters and views. Approval and in-effect states are Phase 3's.

---

## Edges, in one place

| Edge | From → To | Declared on | Rule |
|---|---|---|---|
| `binds` | change → source | change | a source binds at most one change |
| `links` | change · decision · source → source | the referrer | — |
| `supersedes` | decision → decision | decision | the target becomes `superseded`; no cycles |
| `parent` | session → session | session | — |
| `changes` | session → change | session | — |
| observed `{edge, from, to, at}` | session → an edge of any type above | session | evidence only; never satisfies or violates a rule |

Reverse edges (a change's decisions, a source's change, a change's sessions, a decision's superseded-by) are never written; the index derives them.

## Backends

Phase 1 has one backend: files in git, as above. A later backend (a hosted database) must provide the same operations — read, write, validate, query, reconcile — and will have to supply what git supplies here: history, provenance, and merge with typed conflicts. That is a Phase 2 design, not a layer-0 claim.

## What changed from v2, and why

Ids left the files (tokens, readability, agent error rate; reports 01–04). `updated` and the derived-field drift rule were deleted (unimplementable without a baseline; merge conflicts; 01, 02). The layer rule was restated with the envelope exempt and observed edges as evidence (01). `type` and `id` left the envelope (the folder is the type; the index holds ids). Sources became optional records that may exist as keys only (03). `next` returned; `owner`, actors' `aliases` and `links`, layer 3 and 4, two storage locations and "schema independent of storage" moved to Phase 2 (05, 06). `on_behalf_of` returned (06). Session filenames use the harness's id (01, 02). The YAML quoting rule and `pjman fmt` were added (03). The index became a stated SQLite backend with conflict records (02). After review of v3: `aliases` and `pjman mv` were added so keys survive renames; the store became a git repository in either of two modes, in-project or standalone, since a standalone store is what the founder's job requires and what Phase 2 syncs with.
