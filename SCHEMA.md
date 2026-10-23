# pjman — schema v3 (Phase 1)

*The record contract for Phase 1: layers 0–2, core, sources, work. Layer 3 (product, features) and layer 4 (authority) are Phase 2 and 3 and are not specified here. The tool (`README.md`) implements this contract; where the two disagree, the tool is wrong. Fields are marked **A** (authored by an actor on intent; may be hand-edited) or **M** (maintained by one named writer — an adapter or the tool; hand edits are reported, not forbidden). There is no "derived and checked" class: nothing in a record is verified against what a tool previously wrote.*

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
| project | `project:<slug>` | `project:pjman` |
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

### Product — `products/<slug>.md`

The fixed root of the product tree. Projects and top-level features attach to it.

| field | kind | meaning |
|---|---|---|
| `title` | A | Required. |
| `owners` | A | Optional list of actor keys; inherited by every node beneath that names none. |
| `levels` | A | Optional list of level labels for the features beneath, by depth (default: the store's `tree_levels`, `feature` then `capability`; anything deeper takes the last label). |
| `links` | A | Optional source keys. |
| body | A | `## Summary`, optional: the product in a paragraph. |

### Feature — `features/<slug>/feature.md`

One nestable kind for everything the product is and does, at any depth: a feature, a capability beneath it, a sub-capability beneath that. The level is a label, not a kind.

| field | kind | meaning |
|---|---|---|
| `title` | A | Required. |
| `status` | A | Optional authored state: `planned`, `building`, `live`, `retired`. The tool also derives one from the changes that affect the feature (below) and shows both when they differ. |
| `level` | A | Optional label; default from the product's `levels` or the store's `tree_levels` at this node's depth. |
| `product` | A | The product, for a top-level feature. A feature names `product` or `parent`. |
| `parent` | A | The feature above. Unbounded depth; a cycle is refused. |
| `owners` | A | Optional list of actor keys; inherited downward. |
| `links` | A | Optional source keys. |
| body | A | `## Summary`, optional. |

Derived state: `retired` once a change that `removes` the feature is done; else `live` once a change that `adds` it is done; else `building` while any change affecting it is in flight (`active`, `review` or `blocked`; `planning` and `open` are not building); a child's `live` or `building` lifts its parent; else `planned`. The tree at any release is a replay of the done changes up to it.

### Project — `projects/<slug>.md`

A repository, registered in the store by `pjman init`. The unit a change belongs to; a product over several projects is layer 3.

| Field | A/M | Notes |
|---|---|---|
| `title` | A | The repository's folder name unless named |
| `product` | A | Optional. The product this project belongs to. |
| `parent` | A | Optional. The project above (a platform over web and api); unbounded depth, cycles refused. |
| `owners` | A | Optional list of actor keys; inherited downward. |
| `tracker` | A | Optional. The source kind of the project's tickets (`linear`, `github-issue`). A bare ticket id with no references resolves through it; an adapter creates a change for a ticket only in a project that names one. The tracker's own binding sits under `ext.<tracker>` (`ext.linear.team: ABC` names the Linear team the sync pulls) |
| `links` | A | Optional. Source keys: the repository (`git-repo:owner/name`), its tracker, its docs |

The path of the repository on a machine is not in the record; it is in the user config's map (below).

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

- Frontmatter parses under the YAML rule: any scalar containing `: `, `#`, or starting with a special character is quoted. `pjman fmt` normalises, and repairs a record whose only fault is an unquoted scalar; `pjman validate` reports.
- Required fields present; enums in range; every referenced key resolves (sources exempt); a `superseded` decision is pointed at by a newer decision's `supersedes`; a `decided` decision has `decided_by` and `decided_on`.
- Uniqueness: one folder per change slug (the tool refuses a second; two machines creating the same slug meet a git add/add conflict at merge, visible, never silent); one decision slug per change folder; one source per canonical key (kind lower-cased; URL keys normalised; ticket keys verbatim); one actor record per handle.
- Removals go through `pjman rm <key>`: a change takes its decisions with it; the command is refused while any other record refers to the key, naming each referrer and field, and `--detach` drops the references that can be dropped (a key in `binds`, `links` or a session's `changes`; a `parent`; a `supersedes`; an observed edge) in the same commit. A change's `project`, a record's `writer` or `session` can never be dropped: remove or move those records first. The event is `removed`; the git history keeps the record.
- Renames go through `pjman mv`. A change (`change:<old> change:<new>`): the folder moves, the old slug is appended to `aliases`, and every reference in the store is rewritten in one commit. A project: the file moves, every `project:` field follows, and the directories bound to it in the user config follow. A decision (`decision:<change>/<old> decision:<change>/<new>`, or to another change): the file moves, its date prefix kept, and every `supersedes` and link follows. Sources, actors and sessions are not renamed: their keys are external. Keys make renames a tool operation where ids made them free; `aliases` keeps stale references resolvable in between.
- An invalid record is reported with its path and reason, never dropped silently; a reference to a record that exists but fails to parse is "resolved, invalid", not "missing".
- Nothing in `ext` is validated.

### The index

SQLite, in `index.db` at the store root, git-ignored, rebuilt from the records by `pjman index`, disposable. It mints and holds ids (UUID v7) for every record and maps keys to them; it holds reverse edges and the query surface. If two changes bind one source, or two records resolve to one key, the index records a **conflict** and reports it; nothing wins silently.

### Provenance

`writer` and `session` on records that adapters write; `parent`, `agent`, `on_behalf_of` on sessions; git for the rest. An adapter that commits records adds a `Pjman-Session: <id>` trailer. Provenance is a property of the Phase 1 backend (files in git), not a claim about every backend.

### Location and configuration

A **store** is a git repository holding `pjman.yaml`, `projects/`, `changes/`, `decisions/`, `sources/`, `sessions/`, `actors/`, and `index.db` (ignored). There is one per person, the **global store** at `~/.pjman/store`, its own repository; every repository the person works in is a **project** in it. `pjman init` in a repository creates the store the first time, registers the repository as `project:<slug>`, and maps the repository's path to that project in `~/.pjman/config.yaml`. The record never sits in the project's repository, and sessions never appear in product PRs.

Resolution: `--store` or `PJMAN_STORE`; else walk up from the working directory for a store root (`pjman.yaml` beside `changes/`, so the global store resolves from inside itself) or a `.pjman/`; else the user map, which also names the current project. A change created from inside a mapped directory belongs to that project; from inside the store itself the board is unscoped.

Dates (`created`, `decided_on`, the date in a decision's or session's file name) are the local calendar day of the write. Timestamps (`started`, log lines) are UTC instants.

Set aside: `pjman init --in-project` makes a store at `<repo>/.pjman/`, tracked with the project and never committed by the tool, for a repository that must carry its own record. The record shape is identical.

**Git policy.** The tool shells out to git for four things and wraps nothing else: `init` (initialise the store; ignore `index.db`), `mv` (stage the rename so history follows), reading history for views and provenance, and committing — the tool commits after every write it makes to the global store, with a `Pjman-Session:` trailer when a session is known; an in-project store it never commits, the project's own workflow does. Branches, remotes, push and merge are the user's. Git on `PATH` is the only dependency.

`pjman.yaml`: `name`, `layers: [core, sources, work]`, `vocabulary:` (organisation word → canonical status), `source_kinds:`. `~/.pjman/config.yaml`: `actor`, and `stores[].projects[]` as `{path, project}`. Configuration is never in a record.

---

## Layer 1 · Sources

### Source — `sources/<kind>/<key-slug>.md`, optional per source

A thing outside the store: a ticket, a PR, a branch, a repo, a doc, a thread, a file in the repository. **A source may exist only as a key** — `links: [github-pr:acme/app#123]` is complete without a file. A record is created when there is something to say about the source, or when a sync adapter has observed it: a synced ticket's record carries its observed state under `ext.<tracker>` (for Linear: `state`, `state_type`, `team`, `parent`, `updated_at`, `synced_at`), maintained by the sync and never hand-edited.

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
| `project` | A | Project key: the repository the change belongs to. Filled by the tool from the directory the command runs in |
| `features` | A | Optional list of effects on the product tree: `adds feature:<slug>`, `feature:<slug>` (changes), `removes feature:<slug>`. A feature's derived state and the tree at any release come from these. |
| `owners` | A | Optional list of actor keys; a change without owners answers to its feature's or project's. |
| `binds` | A | Optional. Source keys this change *is*: `[linear:ABC-1234]`. A source binds at most one change; a second bind is a reported conflict |
| `links` | A | Optional. Source keys: PRs, branches, docs, threads, files. The kind says what each is |
| `next` | A | The handoff: the next action. What resume reads first |
| `parent` | A | Optional. The change this one is part of. Depth is unbounded; a cycle is an error; the parent may be in another project. Children are derived, never written |
| `aliases` | A | Former slugs, appended by `pjman mv`. A reference to an alias resolves and is reported as "resolves via alias" |

Body: `## Summary` (required), `## Plan` (optional; or `plan.md` beside it), anything else free. Decisions made in the course of the change live in `changes/<slug>/decisions/`.

### Decision — `changes/<slug>/decisions/<yyyy-mm-dd>-<slug>.md`, or `decisions/<yyyy-mm-dd>-<slug>.md` at the store root

Opened `proposed` before the work it governs; `decided` when an actor sets it. A decision written after the fact is allowed and is the pattern the test tallies against.

| Field | A/M | Notes |
|---|---|---|
| `title` | A | |
| `status` | A | `proposed` · `decided` · `superseded` · `reverted` |
| `decided_by` | A | Actor key; required when `decided`. The tool defaults it to the writer only when the writer is a person; an agent is never the decider by default |
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

The canonical word is what is written in the file. `vocabulary:` in `pjman.yaml` maps an organisation's words (a tracker's state names, or its state types) onto it for adapters and views; a sync consults it by state name first, then by state type, then falls back to the built-in map of Linear state types. For a change that binds a ticket, the tracker owns `title`, `status` and `parent`; pjman owns `next`, the body and the decisions. Approval and in-effect states are Phase 3's.

---

## Edges, in one place

| Edge | From → To | Declared on | Rule |
|---|---|---|---|
| `project` | change → project | change | the project must exist |
| `parent` | change → change | change | the parent must exist; no cycles; any depth; any project |
| `binds` | change → source | change | a source binds at most one change |
| `product` | feature, project → product | the child | the fixed root of the product tree |
| `owners` | product, feature, project, change → actor | the node | inherited downward when a node names none |
| `adds`, `changes`, `removes` | change → feature | change | the change's effect on the feature; derived state replays the done ones |
| `links` | change · decision · source → source | the referrer | — |
| `supersedes` | decision → decision | decision | the target becomes `superseded`; no cycles |
| `parent` | session → session | session | — |
| `changes` | session → change | session | — |
| observed `{edge, from, to, at}` | session → an edge of any type above | session | evidence only; never satisfies or violates a rule |

Reverse edges (a project's changes, a change's children, a change's decisions, a source's change, a change's sessions, a decision's superseded-by) are never written; the index derives them.

## The event stream

Every write the tool makes appends one event per record written to `events.jsonl` at the store root, after validation passes and after the commit when the tool commits. The stream is derived and disposable like the index, git-ignored, and `pjman events rebuild` rewrites it from the store's git history. `pjman follow` prints events as they are appended; a view subscribes to it instead of watching files or being called by a harness. The shape is part of this contract; the transport (a file, a command that tails it) is not.

| Field | Notes |
|---|---|
| `seq` | Position in the stream, from 1; a rebuild renumbers |
| `at` | UTC instant of the write |
| `op` | `created` · `set` · `log` · `bind` · `observe` · `moved` · `formatted` · `init` · `write` (a rebuild's word for a commit it cannot classify) |
| `key` | The record written; `store` for `init` |
| `type` | The record type; `store` for `init` |
| `path` | The record's path |
| `fields` | Names of the fields or sections that changed; absent on `created` |
| `writer` · `session` | The envelope of the write |
| `commit` | The commit the write made, when the tool commits |

A write that touches two records emits two events (a decision that supersedes another: `created` and `set status`). A hand edit outside the tool emits nothing; `validate` reports what it finds.

## The getter

`pjman get <ref>` resolves one reference and returns the record, every edge into and out of it (declared and observed, with the session that observed it), and the full context of every change within two hops. The order is fixed: a record key (`change:` with aliases, `decision:`, `project:`, `session:`, `person:`/`agent:`); a URL, matched against `url:` sources and the `url` field of any source record, then against the vendor shapes the tool knows (a Linear issue, a GitHub pull, issue or repository); a source key (`kind:key`, canonicalised); a short form of a ticket (`ABC-1234`, `#12`, `owner/repo#12`), only through its own kind's grammar (below): a form the store already references resolves; the project's tracker admits one it has no record of, within the project's scope; a qualified form (`owner/repo#12`) resolves anywhere; a bare slug as a change or project; a file path, made relative to the current project as `file:<path>`; a bare slug as a unique decision slug or session id prefix. The first match wins; nothing matched exits 1 and names the shapes tried. The getter never writes.

**Reference grammar.** How a source kind is referenced is data, in one table in the tool (`src/refs.ts`): the short form as people write it with its exclusions (`UTF-8` is not a ticket), the URL shape, how a short form becomes the canonical key given the project's scope (a repository for `#12`, from `ext.github.repo` or the `git-repo:` link; a team for a Linear id, from `ext.linear.team`), and the change slug a ticket implies (`abc-1234`, `app-12`). The getter, the text scanner (`pjman refs <text>`: every reference in a text in order, each with the change it leads to and whether it is a ticket of the tracker with no record yet) and the syncs read that table; adapters hand text to the tool and hold no pattern of their own. A shape of one tracker is never read through another's: in a GitHub project `ABC-1234` is a word. A change is created for a ticket only from what the tracker answered (the sync), never from a pattern match. A source key with no record is still an answer (`key`): the edges that cite it are its neighbourhood. Two hops is how far a reference sits from its change here: a source is cited by a change directly or by one of its decisions; a session names its changes.

## Backends

Phase 1 has one backend: files in git, as above. A later backend (a hosted database) must provide the same operations — read, write, validate, query, reconcile — and will have to supply what git supplies here: history, provenance, and merge with typed conflicts. That is a Phase 2 design, not a layer-0 claim.
