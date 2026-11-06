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

A key is a namespace and a slug, nothing else. The namespace is the product for what is a product's vocabulary
(features, changes, decisions) and the store for what is identity or external (products, projects, people, agents,
sessions, sources). A record's place in any hierarchy (its parent, its depth, its level label, its milestone) is a field
on the record and never part of the key, so reparenting, regrouping or relabelling the levels changes no key. Keys are
relative to their store; a reference into another store is a source (`url:`), never a key. The full key is what the
store writes, in fields and in prose alike; inside a product the slug alone names a record, and the tool resolves that
short form through the scope at hand (the record being written, the session's bound change, the project's product,
the page's product), store-wide when exactly one product has the slug, and refuses it as ambiguous otherwise. Text
output read inside a project drops the product segment; JSON keeps it.

| Kind | Key form | Example |
|---|---|---|
| actor | `person:<handle>` · `agent:<handle>` | `person:vinh`, `agent:claude-code` |
| product | `product:<slug>` | `product:pjman` |
| feature | `feature:<product>/<slug>` (inside the product: `feature:<slug>`) | `feature:pjman/store` |
| aspect | `aspect:<product>/<slug>` (inside the product: `aspect:<slug>`) · a place under it: `aspect:<product>/<aspect>/<place>` (inside: `aspect:<aspect>/<place>`) | `aspect:pjman/text`, `aspect:pjman/text/dock-live` |
| project | `project:<slug>` | `project:pjman` |
| change | `change:<product>/<slug>` (inside the product: `change:<slug>`) | `change:pjman/schema` |
| decision | `decision:<product>/<change>/<slug>` (inside the product: `decision:<change>/<slug>`) · `decision:<product>/<slug>` at product level · `decision:/<slug>` at store level | `decision:pjman/schema/layered-minimal` |
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

### Product — `products/<slug>/product.md`

The fixed root of the product tree and the namespace of everything beneath it: its features, its changes and their decisions live in its folder, so a product is one directory in git and an organisation's store is the union of its products' directories. Projects and top-level features attach to it.

| field | kind | meaning |
|---|---|---|
| `title` | A | Required: the product in a sentence. |
| `name` | A | Optional short name, one to three words: what the rail, the switcher, the crumbs and the chips show (the title stays the sentence). Absent, the key's slug. |
| `owners` | A | Optional list of actor keys; inherited by every node beneath that names none. |
| `levels` | A | Optional list of level labels for the features beneath, by depth (default: the store's `tree_levels`, `feature` then `capability`; anything deeper takes the last label). |
| `sequence` | A | Optional ordered list of change keys: the roadmap's order, the deliverables as the person arranged them. A milestone on it is a column holding its children; a loose change is a column of one; a change not on it comes after, as later. No repeats; `pjman order` moves an entry. |
| `links` | A | Optional source keys. |
| `aliases` | A | Former slugs, appended by `pjman mv`; a key under the old segment still resolves. |
| body | A | `## Summary`, optional: the product in a paragraph. |

### Feature — `products/<product>/features/<slug>/feature.md`

One nestable kind for everything the product is and does, at any depth: a feature, a capability beneath it, a sub-capability beneath that. The level is a label, not a kind; each default label has one definition (a feature is what the product does for a person, nameable in a sentence a user would recognise; a capability is a distinct behaviour a change can add, change or remove, the most specific node a change names), and the README states them.

| field | kind | meaning |
|---|---|---|
| `title` | A | Required. |
| `status` | A | Optional authored state: `planned`, `building`, `live`, `retired`. The tool also derives one from the changes that affect the feature (below) and shows both when they differ. |
| `level` | A | Optional label; default from the product's `levels` or the store's `tree_levels` at this node's depth. |
| `product` | A | The product, for a top-level feature. A feature names `product` or `parent`. |
| `parent` | A | The feature above. Unbounded depth; a cycle is refused. |
| `owners` | A | Optional list of actor keys; inherited downward. |
| `links` | A | Optional source keys. |
| `aliases` | A | Former slugs, appended by `pjman mv`; a reference to one resolves and is reported as "resolves via alias". |
| body | A | `## Summary`, optional. |

Derived state: `retired` once a change that `removes` the feature is done; else `live` once a change that `adds` it is done; else `building` while any change affecting it is in flight (`active`, `review` or `blocked`; `planning` and `open` are not building); a child's `live` or `building` lifts its parent; else `planned`. The tree at any release is a replay of the done changes up to it.

### Aspect — `products/<product>/aspects/<slug>/aspect.md`

What applies across the product rather than at one place on the tree: how text reads, how the app moves, a component reused in many views. An aspect is its own tree under the product, beside the features and never inside them; the places it applies are links to existing features (below), so the feature tree keeps one parent per node and nothing rolls up twice.

| field | kind | meaning |
|---|---|---|
| `title` | A | Required. |
| `name` | A | Optional label, one to three words. |
| `parent` | A | Optional. The aspect above (text, then markdown beneath it); cycles refused; same product. |
| `owners` | A | Optional list of actor keys: who answers for the base. |
| `links` | A | Optional source keys. |
| body | A | The base: the one source of truth for what the aspect says, in markdown. The store imposes no shape on it; the aspect skill shapes it by the kind of aspect. |

Writing the base (`pjman set aspect:<slug> body=-`) prints every place it reaches with each fork in full, so the forks are reconciled with it in the same batch.

### Place — `products/<product>/aspects/<aspect>/places/<place>.md`

Where an aspect applies: one existing feature, at any depth. A place at a feature covers everything beneath it; a place nearer a feature layers over one above it.

| field | kind | meaning |
|---|---|---|
| `feature` | A | Required. The feature the aspect applies at, in the aspect's product. An aspect has one place per feature. |
| `links` | A | Optional source keys: the code that carries the aspect there (`file:ui/src/features/dock/Dock.tsx`). |
| body | A | The fork: only what differs at this place, in markdown. Empty: the base as it is. A place never copies the base. |

A place is read as the base, then the forks of the places at the features above it, outermost first, then its own, each marked with where it comes from (`pjman show aspect:<aspect>/<place>`). A feature with a place cannot be removed until the place is; renaming the feature rewrites the place; removing an aspect takes its places.

### Project — `projects/<slug>.md`

A repository, registered in the store by `pjman init`. The unit a change belongs to; a product over several projects is layer 3.

| Field | A/M | Notes |
|---|---|---|
| `title` | A | The repository's folder name unless named |
| `product` | A | Optional. The product this project belongs to. |
| `parent` | A | Optional. The project above (a platform over web and api); unbounded depth, cycles refused. |
| `owners` | A | Optional list of actor keys; inherited downward. |
| `tracker` | A | Optional. The source kind of the project's tickets (`linear`, `github-issue`). A bare ticket id with no references resolves through it; an adapter creates a change for a ticket only in a project that names one. The tracker's own binding sits under `ext.<tracker>` (`ext.linear.team: ABC` names the Linear team the sync pulls) |
| `map` | A | Optional. `propose` (the default `pjman init` records after asking): while the project's product has no feature, `pjman context` opens with one line saying the product has no map and the map skill proposes one. `skip` ends the line. |
| `links` | A | Optional. Source keys: the repository (`git-repo:owner/name`), its tracker, its docs |

The path of the repository on a machine is not in the record; it is in the user config's map (below).

### Actor — `actors/<handle>.md`, optional

A record for an actor exists only when there is something to say about one. References to `person:x` / `agent:x` do not require a record. **An actor is a definition; a session is a run; a spawn is a session, never an actor.**

| Field | A/M | Notes |
|---|---|---|
| `kind` | A | `person` · `agent` |
| `name` | A | Optional |
| `url` | A | Optional: a profile, an agent's definition. A scalar, not an edge |
| `links` | A | A person's accounts, each a source of an identity kind keyed as the outside world keys it: `github-user:<login>`, `linear-user:<id>`, `email:<address>`, `git-author:<name <email>>`. An account is one person's; two people claiming one is an error on both. A commit, a pull request, a ticket assignee or a review resolves to its person through the account; an account no person claims resolves to nothing and is never matched by name |
| `aliases` | A | Former handles, appended by `pjman mv person:<old> person:<new>`; the user config's actor follows |

A person's key is a handle of their own, unique in the store, suggested by `pjman init` in a fixed order, the forge login, else the committer name, else the machine's account name (so there is always an actor), and confirmed by the person; it belongs to no account, so two people with the same name have different handles and a person who leaves a forge keeps their key. The first link of a handle kind (a kind whose id is a login: `github-user`) is the person's primary account; a record with none is **provisional**: the handle came from the committer name, the machine or a hand edit and the person has not yet claimed an account, which `pjman whoami` and the session start say until they rename it or claim one. Verification (`pjman whoami --verify`, and `pjman init` on every run) asks one checker per account kind and gives each account a verdict, `verified`, `unknown` or `unchecked`; an unknown account is said and never dropped by the tool.

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
- Renames go through `pjman mv`. A change (`change:<old> change:<new>`) or a feature (`feature:<old> feature:<new>`): the folder moves, the old slug is appended to `aliases`, and every reference in the store (a feature's effects included) is rewritten in one commit. A product: the file moves and every `product:` field follows. A project: the file moves, every `project:` field follows, and the directories bound to it in the user config follow. A decision (`decision:<change>/<old> decision:<change>/<new>`, or to another change): the file moves, its date prefix kept, and every `supersedes` and link follows. Sources, actors and sessions are not renamed: their keys are external. Keys make renames a tool operation where ids made them free; `aliases` keeps stale references resolvable in between.
- Many writes as one commit go through `pjman apply [<file>|-] [--for <key>]`: the commands one per line as typed after `pjman` (`new`, `set`, `mv`, `rm`, `order`, `session`; blank lines and `#` comments skipped), run in order with every commit and event held, then one commit (`pjman: apply <n> writes for <key>`, the key as the `Pjman-For` trailer) and the held events with it, closed by one `applied` event on the record `--for` names (`store` when none). A line that fails refuses the whole batch: the store is reset to the commit before it and nothing is written. `pjman undo [<commit>]` reverts the last batch, or the commit named, as one commit (`pjman: undo <sha> (<subject>)`, trailers `Pjman-Undoes` and `Pjman-For`), emitting `removed`, `created` or `set` for each record put back and one `reverted` event; it is refused while a later commit touched a record of that batch. Both need a store the tool commits. A proposed product map is applied this way, so one commit is its boundary and one undo its rollback.
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

`pjman.yaml`: `name`, `layers: [core, sources, work]`, `vocabulary:` (organisation word → canonical status), `source_kinds:`, `version:` (the format the store is in: the pjman version that introduced its latest move, stamped by `pjman init` and by `pjman migrate`, never by an ordinary write; absent on a store from before the field, which reads as 0.1.0; a store stamped newer than the tool is refused for writing, naming the version to install, and one stamped older is told to migrate; decision releases-homebrew/store-names-its-version). `~/.pjman/config.yaml`: `actor`, and `stores[].projects[]` as `{path, project}`. Configuration is never in a record.

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

### Change — `products/<product>/changes/<slug>/change.md`

A change is keyed under the product its project names; `pjman set <change> project=` to a project of another product is refused, and `pjman mv change:<product>/<slug> change:<other>/<slug>` moves it (into that product's one project).

A change reads as a ladder (decision record-foundation/the-ladder): its `name`, its `gist`, then its foundation, the sections below in order of depth and the plan as steps. The name and gist are written from the foundation and record which one (`rungs_from`); the foundation written without them leaves them stale, which the context and the views say rather than hide. Status, progress, the next step, what waits on whom and what happened since are derived, never written.

| Field | A/M | Notes |
|---|---|---|
| `name` | A | Which one in a crowd: one to four words. Chips, crumbs, the roadmap's bars. Absent on a change the tool ingested from a ticket or mapped from the old shape until someone writes it |
| `gist` | A | What it is and why, in one line. Lists, cards, the lead line of the record |
| `status` | A | One canonical word from the vocabulary. `planning` and `active` are lifted by the tool after a write (decision status-from-the-plan/derive-or-write): an open change becomes `planning` once its plan has a step, an open or planning one `active` once a step has started or a session writes a file for it, each lift its own `set` event; `blocked`, `review`, `done` and `dropped` are written by hand, and nothing automatic moves a status back. `pjman lift` is the backfill |
| `project` | A | Project key: the repository the change belongs to. Filled by the tool from the directory the command runs in |
| `features` | A | Optional. The features this change adds, changes or removes: `adds feature:<slug>`, `feature:<slug>` (changes), `removes feature:<slug>`. Name the most specific node; state rolls up. A feature's derived state and the tree at any release come from these. |
| `aspects` | A | Optional. The aspects or places this change adds, changes or removes, in the same form as `features`: `adds aspect:<slug>`, `aspect:<aspect>/<place>` (changes). Its context then carries the aspect whole (the base and every place). |
| `owners` | A | Optional list of actor keys; a change without owners answers to its feature's or project's. |
| `binds` | A | Optional. Source keys this change *is*: `[linear:ABC-1234]`. A source binds at most one change; a second bind is a reported conflict |
| `links` | A | Optional. Source keys: PRs, branches, docs, threads, files. The kind says what each is |
| `kind` | A | Optional. `bug`: a change against something live, reported rather than planned. Absent means work. A sync sets it from the tracker's own issue type or label; it never sets the feature or the severity |
| `severity` | A | A bug's only. Where on the tree the behaviour is lost, from worst: `product` (nobody can use it), `feature` (a feature's sentence is false), `capability` (one behaviour is gone; deeper nesting reads as capability), `nuisance` (it works with a workaround), `cosmetic` (nothing is lost). Set at intake from the level of the node the bug names, raised when the blast radius is wider. Orders the bug pool, worst first then oldest; never a priority beside the sequence |
| `depends_on` | A | Optional list of change keys: what must land before this one. A cycle and a self-dependency are refused. The roadmap draws the edge on focus and checks it against the order; it warns and never reorders |
| `target` | A | Optional date: a milestone's target, set by a person, shown where present, never required and never inferred |
| `plan` | M | The plan as steps, written only through `pjman step`: a list of `{text, state, note, at}`, state one of `open`, `active`, `done`, `dropped`, the note where the work stands on it, `at` when it last moved. Every move is one event on the change (`fields: [plan, step <verb>]`). Derived from it: the next step (the active one, else the first open), the plan's progress (done over not dropped), the active step's note. There is no `next` field: the next step is the plan's |
| `parent` | A | Optional. The change this one is part of. Depth is unbounded; a cycle is an error; the parent may be in another project. Children are derived, never written. A change with children is a milestone: its progress is the children done over children, dropped excluded, derived |
| `aliases` | A | Former slugs, appended by `pjman mv` (`<product>/<slug>` for a key once held in another product; the flat slug from before keys were paths under the product, added by `pjman migrate`). A reference to an alias resolves and is reported as "resolves via alias" |
| `rungs_from` | M | The hash of the foundation (Origin, Intent, Done when) the name and gist were written from. Set whenever they are written; a foundation written without them leaves it behind, and the rungs read as stale |
| `migrated` | M | The date `pjman migrate` mapped the record from the old shape (a title, a Summary, a next). Dropped by the first write through the tool |

Body: the sections, each `## <name>`, in order of depth; the validator knows them and warns on any other. `## Origin` (required: where the work came from, as it was said: the person's words quoted and never edited, or `from <key>` for a ticket, a document, or the change or decision it spun off, linked and never copied, with the session it was made in), `## Intent` (the need, and for whom; it opens with the need in a sentence or two), `## Done when` (the outcome that closes it), `## Scope` (in, and deliberately out), `## Open questions` (one that needs a choice becomes a decision and links to it), `## Blocked on` (an outside blocker; a blocking change is `depends_on`), `## Notes` (free; `pjman note` appends a line). `pjman new change` requires the name, the gist, Origin, Intent and Done when; a change the tool ingested from a ticket, or mapped from the old shape, is valid without Intent and Done when and says what it needs until someone first works it. Decisions made in the course of the change live in `decisions/` beside it.

### Decision — `products/<product>/changes/<change>/decisions/<yyyy-mm-dd>-<slug>.md`; `products/<product>/decisions/…` at product level; `decisions/…` at the store root

Opened `proposed` before the work it governs, with its options laid out and one recommended; `decided` once a person accepts an option. A decision is an argument that converges (decision record-foundation/changes-sectioned-decisions-threaded): its foundation is a thread of typed entries, append-only and written only through `pjman decision`, so a rejected option, a recommendation that moved and the person's words at acceptance are part of its record. Its rungs are a `name` and a `gist`: one line of what is being decided, never a restatement of the recommendation, which the thread holds and every view marks once (change:decision-card). Its status, decider and date are maintained from the thread in the same write.

| Field | A/M | Notes |
|---|---|---|
| `name` | A | One to four words |
| `gist` | A | One line |
| `status` | M | `proposed` · `decided` · `superseded` · `reverted`. Proposed until the thread holds an acceptance in force; a `reopen` entry takes it back to proposed |
| `decided_by` | M | The person whose acceptance is in force; required when `decided`. An agent never accepts |
| `decided_on` | M | The date of that acceptance |
| `supersedes` | A | Optional decision key, or a list of them: the decisions this one replaces. Given at creation (`--supersedes`) or later (`pjman set … supersedes=<key>,…`, which only adds); each target is marked `superseded` in the same commit |
| `links` | A | Optional source keys |
| `thread` | M | The entries in order, each `{type, at, by, …}`: `question` (`text`; a later one reframes it), `criterion` (`text`: what the choice must satisfy), `option` (`id`, a slug; `text`: one line, what it is; `case`: its points, one per line, drawn as bullets), `recommendation` (`option`; `text`: the reasoning, one line; the latest stands), `comment` (`text`, `by`: the person's words, their Origin), `reject` (`option`; `text`: why), `accept` (`option`; `by`, a person; `text`: their words; `revisit`: when to look again), `reopen`. An option is defined before anything names it; a later `option` entry with the same id restates it (its text and case replace the earlier ones, the marks on it stay, the thread keeps both). Read off the thread: the current question, the criteria, every option with its marks, the recommendation, the comments, the acceptance in force |
| `rungs_from` | M | The hash of the question, recommendation and acceptance entries the name and gist were written from; a new one of those without them leaves the rungs stale |
| `migrated` | M | The date `pjman migrate` mapped the record from the old shape (a title, Decision and Why), its text one option with its case, accepted by whoever decided it or recommended while proposed. Dropped by the first write through the tool |

Body: `## Notes` only. The decision's text is its thread.

### Release — `products/<product>/releases/<version>.md`

A version the product shipped (decision releases-homebrew/release-is-a-record): keyed under the product by its version, `release:<product>/<version>` (`release:0.2.0` inside the product), written by `pjman new release` from the release command and never by hand. Its creation is the event a release is; what it shipped is read from it, so a change's shipped-in and the version a feature first went live in are derived through the graph.

| Field | A/M | Notes |
|---|---|---|
| `version` | M | Plain semver, the file name: `0.2.0` |
| `tag` | M | The git tag, `v<version>` |
| `level` | M | `patch` · `minor` · `major`: how the version moved, derived from the changes shipped (a bug a patch, a change naming a feature a minor, a store move at least a minor) or typed |
| `at` | M | The instant the release was cut |
| `commit` | M | The commit the release was cut from, on main |
| `url` | A | The published release (the tarball is attached to it) |
| `ships` | M | The changes it shipped, in order, each of this product; a change is listed once |
| `links` | A | Optional source keys |

Body: the release notes as published, one line per change in the words the change was written in, grouped Added, Changed, Fixed, Removed, Store, Also.

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

The canonical word is what is written in the file. `vocabulary:` in `pjman.yaml` maps an organisation's words (a tracker's state names, or its state types) onto it for adapters and views; a sync consults it by state name first, then by state type, then falls back to the built-in map of Linear state types. pjman is the source of truth (decision record-foundation/pjman-is-the-source-of-truth): a ticket is one more source, linked in the change's Origin. Ingesting it creates the change when none binds it, with a draft gist from the ticket's title and the status as the ticket stood then; afterwards a sync writes the source record, the binding and the owners, never the change's name, status or parent. Approval and in-effect states are Phase 3's.

---

## Edges, in one place

| Edge | From → To | Declared on | Rule |
|---|---|---|---|
| `project` | change → project | change | the project must exist |
| `parent` | change → change | change | the parent must exist; no cycles; any depth; any project |
| `depends_on` | change → change | change | every key must exist; no cycles; a constraint on the order, never a scheduler |
| `sequence` | product → change | product | the roadmap's order; every key must exist; no repeats |
| `binds` | change → source | change | a source binds at most one change |
| `product` | feature, project → product | the child | the fixed root of the product tree |
| `owners` | product, feature, aspect, project, change → actor | the node | inherited downward when a node names none |
| `adds`, `changes`, `removes` | change → feature | change | what the change does to the feature; derived state replays the done ones |
| `adds`, `changes`, `removes` | change → aspect, place | change (`aspects`) | what the change does to the aspect; its context carries it whole |
| `parent` | aspect → aspect | aspect | same product; no cycles |
| `feature` | place → feature | place | the feature must exist, in the aspect's product; one place per feature per aspect |
| `ships` | release → change | release | every change must exist, in the release's product, listed once; the reverse (a change's release) is derived |
| `links` | change · decision · source → source | the referrer | — |
| `supersedes` | decision → decision (one or many) | decision | the target becomes `superseded`; a target already superseded by another decision is refused; no cycles |
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
| `op` | `created` · `set` (a decision's thread appended to carries `fields: [thread, …]`, a step of a change's plan `[plan, step <verb>]`) · `log` · `bind` · `observe` · `moved` · `formatted` · `init` · `write` (a rebuild's word for a commit it cannot classify) · `applied` (a batch landed: the key is what it was for, `fields` its size) · `reverted` (a batch undone) · `migrated` (the layout or the foundation moved, once, on the store) |
| `key` | The record written; `store` for `init` |
| `type` | The record type; `store` for `init` |
| `path` | The record's path |
| `fields` | Names of the fields or sections that changed; absent on `created` |
| `writer` · `session` | The envelope of the write |
| `commit` | The commit the write made, when the tool commits |

A write that touches two records emits two events (a decision that supersedes another: `created` and `set status`). A hand edit outside the tool emits nothing; `validate` reports what it finds.

## The roadmap

Derived, never stored, in the scope (`/scope`): every change carries its `position` (its own index in the product's `sequence`, else its nearest sequenced ancestor's; absent is later), its `dependsOn` as live keys, its `target`, and `began` and `finished`, read from its status events (the first status change, and the last one when it is done). A bug carries its `home`: the node on its path at its severity's level (product severity on the product; feature severity on the top-level feature above the node it names; anything else on the node itself), where it is listed once; a product or feature node carries `bugs` (`here`, `beneath`, `worst`), rolled up with nothing repeated beneath. The scope's `bugs` is the queue beneath the node, worst first then oldest. The scope's `roadmap` is the product's sequence as it falls in the scope, `later` (the open, unsequenced, non-bug changes whose parent is not itself later), and `violations`: `order` (a dependant placed before what it depends on; later is after everything; the same column is fine), `target-dependency` (a dependant's effective target, its own or its nearest ancestor's, earlier than its dependency's), `target-order` (an entry later in the sequence with an earlier target than one before it), `overdue` (a target passed, the change not done). The tool warns and never reorders.

## The getter

`pjman get <ref>` resolves one reference and returns the record, every edge into and out of it (declared and observed, with the session that observed it), and the full context of every change within two hops. The order is fixed: a record key (`change:` with aliases, `decision:`, `project:`, `session:`, `person:`/`agent:`); a URL, matched against `url:` sources and the `url` field of any source record, then against the vendor shapes the tool knows (a Linear issue, a GitHub pull, issue or repository); a source key (`kind:key`, canonicalised); a short form of a ticket (`ABC-1234`, `#12`, `owner/repo#12`), only through its own kind's grammar (below): a form the store already references resolves; the project's tracker admits one it has no record of, within the project's scope; a qualified form (`owner/repo#12`) resolves anywhere; a bare slug as a change or project; a file path, made relative to the current project as `file:<path>`; a bare slug as a unique decision slug or session id prefix. The first match wins; nothing matched exits 1 and names the shapes tried. The getter never writes.

**Reference grammar.** How a source kind is referenced is data, in one table in the tool (`src/refs.ts`): the short form as people write it with its exclusions (`UTF-8` is not a ticket), the URL shape, how a short form becomes the canonical key given the project's scope (a repository for `#12`, from `ext.github.repo` or the `git-repo:` link; a team for a Linear id, from `ext.linear.team`), and the change slug a ticket implies (`abc-1234`, `app-12`). The getter, the text scanner (`pjman refs <text>`: every reference in a text in order, each with the change it leads to and whether it is a ticket of the tracker with no record yet) and the syncs read that table; adapters hand text to the tool and hold no pattern of their own. A shape of one tracker is never read through another's: in a GitHub project `ABC-1234` is a word. A change is created for a ticket only from what the tracker answered (the sync), never from a pattern match. A bare `#12` is weak: as often a list item as an issue, it is listed and resolved (`pjman get #12`) but never binds a session or creates a change; `owner/repo#12` and the issue's URL do. What an interface writes into a prompt for a pasted image or text (`[Image #2]`, `[Pasted text #1 +12 lines]`) is not a reference. A source key with no record is still an answer (`key`): the edges that cite it are its neighbourhood. Two hops is how far a reference sits from its change here: a source is cited by a change directly or by one of its decisions; a session names its changes.

## Backends

Phase 1 has one backend: files in git, as above. A later backend (a hosted database) must provide the same operations — read, write, validate, query, reconcile — and will have to supply what git supplies here: history, provenance, and merge with typed conflicts. That is a Phase 2 design, not a layer-0 claim.
