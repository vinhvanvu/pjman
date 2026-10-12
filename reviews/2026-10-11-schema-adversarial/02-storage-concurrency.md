# Review 02 — storage and concurrency claims

*2026-10-11. Adversarial pass over SCHEMA.md (draft v2), THESIS.md "The substrate" and "Roadmap", DECISIONS.md 27–30, and the store at `.pjman/`. Every git outcome below was produced by running the scenario against a copy of the real store (git 2.39.3, default merge settings) in a scratch repository; nothing is speculated where it could be executed.*

## Verdict

The six claims are of three kinds, and only one kind holds. "The index is disposable and rebuildable from files" holds for authored state, because every edge is in the frontmatter of the record that made it. "Observed edges merge without arbitration" holds only at the level of two *different* session files, and the schema's own envelope (`updated` on every record) and filename rule (`<id8>` = a 65-second bucket of the UUID v7 timestamp) defeat it at the file level. The rest — files-in-git handle two machines, UUID v7 makes multi-writer safe, derived fields can be protected, the schema is independent of storage — do not hold as written. Git merges the *unsafe* cases cleanly (two binds of one source, two superseders of one decision, two records for one `(kind, key)`) and conflicts on the *safe* ones (any two edits to one record, because both bump `updated`; two appends to one session; two sessions started within the same minute). The schema's invariants are all stated as validation rules on a single store, and the file backend has no moment at which a single store exists across two writers; validation after `git pull` can only report that the invariant is already broken, and the schema says nothing about what a reader does with a store in that state. Derived-field drift ("match what their deriver last wrote") requires a baseline that lives either in the disposable index (then it is not disposable) or in git history (then git is load-bearing and the user-space store has no provenance at all). Layer 0 says "every record is a file: YAML frontmatter, Markdown body" and then defines folder layout, slug rules, filename rules, heading contracts and byte preservation as schema; a database implementation would have to fake all of it, and the "same library API" cannot be the same because the file backend's write succeeds locally and is invalidated at merge while a database rejects at commit.

## Scenarios that break

Each ran as: base commit = the real `.pjman/`; branch A and branch B diverge; `git merge B` into A.

### 1. Any two concurrent edits to one record conflict, because of `updated`

Steps: A appends a line to the body of `changes/schema/change.md`; B changes `status: active` → `review` in the same file. Both set `updated` as the envelope requires (different timestamps, since the writes happened at different moments).

Git: **CONFLICT** in `change.md` (S1c). Without the `updated` bump the identical edit pair merges cleanly (S1b). So the envelope converts git's best case (disjoint edits to one file) into a conflict on every concurrent edit of every record. Adjacent frontmatter edits conflict even without `updated`: A edits `title`, B edits `status` (next line) → **CONFLICT** (S1d). Two edits to `status` itself conflict with or without `updated` (S1a).

Invariant broken: none in the schema; the break is that the "mergeable, diffable" property claimed for files (decision 28, `records-truth-graph-index.md`: "Files are readable by any harness, diffable, mergeable") is false for the one case multi-machine use produces. The conflict lands in a file whose derived fields the human must now resolve by hand, which is by definition drift.

Schema would need to say: either `updated` is not a stored field on the file backend (it is `git log -1 --format=%cI -- <path>`, which is what Phase 0 already learned — its `commit()` skips writes that change only `updated`), or merges are resolved by the library with a stated rule (last `updated` wins per field? union for lists?) and the conflict markers never reach a person.

### 2. One source bound by two changes: merges clean, invariant silently broken

Steps: session on machine A binds source `vinhvanvu/pjman` into `changes/adapters/change.md`; session on machine B binds the same source into `changes/second-user/change.md`.

Git: **clean** (S2). After merge two files carry the same id in `binds`.

Invariant broken: "a source binds at most once" (layer 2 rules). The library validated each write against a store that did not contain the other write. The schema says the index "reports" invalid records "never silently skipped", but does not say which bind is the bind: the derived "a source's change" is now two changes, drift computation ("a bound source's `observed.status` ... disagreeing with the change's `status`") has two answers, and the thesis's own request-queue rule ("a source with no change bound is the queue") has to decide whether a doubly-bound source is in the queue.

Schema would need to say: binds-once is not enforceable on the file backend across writers; define the reconciliation (earliest `updated` wins and the other is demoted to `links`? both kept and reported, with the index refusing to derive "a source's change" until a person resolves?) and define what the index does with a record that fails a cross-record rule (excluded from the graph, or included and flagged).

### 3. Two actors create the same `(kind, key)` source: add/add conflict or silent duplicate

Steps (a): both machines create `sources/linear-issue/abc-1234.md` for `ABC-1234`, each with its own fresh UUID.

Git: **CONFLICT** (add/add, S3a). Resolution by a human must pick one id; every record on the losing side that already references the losing id (a `binds`, a `links`, an observed edge in an append-only session) now dangles. The session cannot be edited to fix it ("a session is never hand-edited"), so it is invalid forever.

Steps (b): same key, but one writer was given the URL and the other the key, and they slug differently (`abc-1234.md` vs the hashed-URL filename the schema prescribes for "long keys").

Git: **clean** (S3b). Two sources with the same `(kind, key)` and different ids.

Invariant broken: "`(kind, key)` unique among sources". The schema's "created on first mention" plus id-only references turns every duplicate creation into a permanent split: references are to the id, not the key, so merging two records is a rewrite of every referrer. Compare actors, where the schema makes the "one deliberate exception" and references by handle: an add/add on `actors/vinh.md` resolves to one file and no referrer breaks. The exception that was made for readability is the only one that is merge-safe, and sources — the record type most likely to be created concurrently, by construction — got the fragile form.

Schema would need to say: a merge/tombstone operation (`merged_into: <id>` on a source, honoured by the index when resolving references) so that duplicate creation is repairable without rewriting referrers; and a canonical key form per kind so (b) cannot happen (is `ABC-1234` the key or `https://linear.app/.../ABC-1234`? is key comparison case-sensitive? none is stated).

### 4. Folder rename on one machine, edit on the other

Steps (a): A `git mv changes/schema changes/record-contract`; B edits `status` in `changes/schema/change.md`.

Git: **clean** (S4a) — rename detection carries B's edit into the renamed folder. This is the one scenario the "ids are stable, paths are not" rule actually earns.

Steps (b): A renames the folder *and* rewrites the Summary (a plausible single commit: "re-scoped the change"); B edits `status` and adds a new decision file under `changes/schema/decisions/`.

Git: **CONFLICT (file location)** (S4b): "added in B inside a directory that was renamed in HEAD, suggesting it should perhaps be moved to …". The default `merge.directoryRenames=conflict` leaves the new decision for a human to place; with `=false` it lands in `changes/schema/decisions/` beside no `change.md`, a shape the layout rule cannot express.

Invariant broken: not a schema invariant, but the layout *double-encodes* the decision→change edge: once in the folder (`changes/<slug>/decisions/`) and once in the `change:` field. The schema has no rule for the two disagreeing (a decision file under `changes/schema/` whose `change:` points at `library-cli`), and the index "re-resolves by id", so the folder is meaningless to the index and meaningful to every human and every `ls`.

Schema would need to say: the folder is a view, the field is the edge, and a disagreement is a validation error (or: decisions are never nested under changes; one `decisions/` folder, which also removes the rename hazard).

### 5. A decision superseded on both sides: conflict if `updated` is bumped, a forked chain if not

Steps: both machines set D1 (`four-nouns`) to `status: superseded` and each creates its own superseding decision (`five-nouns` on A, `three-nouns` on B) with `supersedes: <D1>`.

Git: with `updated` bumped on D1 → **CONFLICT** on D1 (S5a), an identical status edit blocked by two timestamps. Without the bump → **clean** (S5b): D1 is superseded by two decisions.

Invariant broken: "a `superseded` decision is pointed at by a newer one's `supersedes`" is satisfied twice. The derived "superseded-by" is a list; nothing says a chain is linear, so nothing says which decision is current, and layer 4 (approvals, "who decided what") will read the chain. Both decisions are `decided` by actors with authority, so the alignment layer has two valid, contradictory decisions and no rule.

Schema would need to say: supersession is a chain (one successor; a second superseder of the same decision is invalid and the later-`decided_on` one must supersede the earlier *successor*, not the original), and state the reconciliation when the file backend produces the fork anyway.

### 6. Append-only session files are not conflict-free in git

Steps (a): the same session file receives one observed edge from each of two processes (the thesis's "appended to that session's record").

Git: **CONFLICT** (S6a). Two insertions at the same point of a YAML list are a textbook git conflict; "append-only" is a property of the writer's intent, not of the diff. Add the envelope's `updated` (which an append changes) and the conflict is guaranteed even if the lists were disjointly ordered.

Steps (b): two *different* sessions, each a new file — the case the claim is really about.

Git: **CONFLICT** (S6b) — because both started inside the same 65.5-second window and the filename is `<yyyy-mm-dd>-<id8>.md`, where `id8` is the top 32 bits of the 48-bit millisecond timestamp. Two sessions one minute apart share a filename. A fan-out (parent spawns three subagents in the same second — the schema's own "a fan-out is a tree") collides by construction. In the real store, 21 of 22 records share `01a127d2`; the shortest unique prefix among them is 14–15 hex characters, so "the CLI accepts a unique prefix" means typing 15 characters of a UUID.

Invariant broken: one file per record. "Merge without arbitration" is true of the *edges* (they are disjoint facts with provenance) and false of the *files* that carry them.

Schema would need to say: the session filename uses the low (random) bits or the full id, never a timestamp prefix; a session has exactly one writing *process*, not one writing actor (a resumed session on another machine is a new session with `parent`); and `updated` on a session is not stored (it is the `at` of the last observed edge).

Note that Phase 0 does not append: `commit()` rebuilds the whole record and rewrites the file after every state change. The append-only claim has no running precedent.

### 7. Case-folding filesystems make a clean merge produce a ghost record

Steps: A creates `changes/Schema-V3/change.md`, B creates `changes/schema-v3/change.md` (distinct ids). macOS default filesystem, the founder's machine.

Git: **clean** (S7). The tree holds two paths; the working directory holds one folder; immediately after the merge `git status` shows `Schema-V3/change.md` as modified, with B's id in it. The index, walking the filesystem, sees one record; git sees two; the next commit from this machine silently rewrites one of them.

Schema would need to say: slugs are lower-case, and the library refuses to create a path that differs only by case from an existing one. The slug rule currently says "lower-case" for sources only; change and feature slugs and actor handles have no case rule.

### 8. The store rides on branches, worktrees and uncommitted state

Not a merge scenario but the same failure in time. `.pjman/` in the repository means: a change set to `review` on branch `feat/x` is `active` on `main` until the PR merges; the index built on `main` reports the wrong status and nothing in the schema says the index is rebuilt on checkout. Sessions run in per-ticket worktrees (Phase 0 does; `DESIGN.md` "a ticket's worktree"), so with a repo-resident store each worktree has its own `.pjman/`, the "walk up for `.pjman/`" rule finds the worktree's copy, and a board across sessions sees one worktree. Squash-merging a branch discards every `Pjman-Session:` trailer, which is the only provenance mechanism named. Records an agent writes and a human never commits (the common case; nothing says who commits records or when) are on no branch at all. Abandoning a branch deletes its sessions and the decisions made in them.

Schema would need to say: whether the graph is branch-scoped (then it is many stores and the schema must say how they reconcile) or not (then it cannot live in the working tree; it needs its own branch, its own repo, or user space); and a commit policy for records.

## File-specific assumptions hiding in a "storage-independent" schema

Each of these is stated in SCHEMA.md as schema, not as the Phase 1 backend's convention.

1. Layer 0, "The envelope": "Every record is a file: YAML frontmatter, Markdown body." The storage format is in the storage-independent layer.
2. Folder layout per type as the record's address: `actors/<handle>.md`, `sources/<kind>/<key-slug>.md`, `sessions/<yyyy-mm-dd>-<id8>.md`, `changes/<slug>/change.md`, `changes/<slug>/decisions/<date>-<slug>.md`, `decisions/`, `features/<slug>/feature.md`, `product.md`.
3. Slug rules: lower-casing, dot/slash/space → hyphen, "long keys (URLs) hashed to a short stable token" (threshold and hash unspecified; two writers can slug one key two ways — scenario 3b).
4. The session filename's date prefix: from `created` or `started`? (the bootstrap uses `created`: 10-10, with `started` 10-05); in whose timezone? Two machines in different zones name the same session differently.
5. The decision→change edge encoded twice: folder nesting and the `change:` field.
6. Markdown heading contracts as validation: `## Summary` required on a change, `## Decision` / `## Why` on a decision. A database has a text column; the "section" is a parse of prose, which the thesis says never carries structure ("nothing structural lives in prose").
7. `ext:` "preserved byte-for-byte". A YAML round-trip is not byte-preserving in any mainstream library: the store uses flow mappings (`{edge: links, from: …}`), unquoted dates (`decided_on: 2026-10-10`, auto-typed by YAML 1.1 parsers) and timestamps with offsets, all of which re-emit differently; `binds: []` versus an absent key (both forms exist in the store: `decisions-as-view` omits it) is a normalisation choice that will churn every diff. In a database `ext` is a JSON column with no byte identity at all. The honest contract is "preserved structurally", and that is weaker than promised.
8. Provenance: "git provides the rest for free: `git blame` gives field-level history, and an adapter that commits records writes a `Pjman-Session:` trailer". No commit in this repository carries the trailer. `git blame` is per line, and a whole-record rewrite (the only write path Phase 0 has) attributes every line to the last writer. The user-space store (`~/.pjman/stores/<slug>/`) is not said to be a git repository, so Phase 1 already has two backends with different provenance, before Phase 2.
9. Location and resolution: walk up for `.pjman/`, `~/.pjman/config.yaml` mapping paths to stores.
10. Configuration "never in a record": `pjman.yaml` holds the product id, the vocabulary and the source kinds, has no envelope, no writer, no history, and silently relabels drift for all time when `vocabulary:` changes. A database must hold it as rows, with provenance the file form never had.
11. "Hand edits are validated at the next index build" and "folders may be moved or renamed": the whole drift-on-derived-fields half of layer 0 presumes a path around the library. A database either has none (then the rules are dead code) or has SQL (then the rules are unenforceable in a different way).
12. "Append-only" as a property of a file. Files have no append-only; only git history can witness it, and only if the record was committed after every append.
13. Uniqueness rules (`(kind, key)`, binds-once, handle) stated as validation. A database enforces them at write with a unique index and rejects the second writer; the file backend accepts both and finds out at merge. The *same library API* therefore has different semantics per backend: `write()` on files returns success and may later be invalidated by a `git pull` the library never sees; `write()` on a database returns a constraint error. Either the API gains an explicit reconcile step and a "conflict" result that the database never produces, or the database backend emulates files by dropping its constraints. The claim survives only as a shared type signature.
14. Timestamps as ISO 8601 strings with local offsets (`-07:00` throughout the store). Lexical order of such strings is not time order across zones; the index must parse to compare.
15. The Phase 2 flip ("files become the export") makes files an edited export that must sync back — the bidirectional sync the thesis says integrations should *end*, now applied to pjman's own format, with scenarios 1–7 as its merge problem.

## Hidden second sources of truth

1. **The drift baseline for derived fields.** "Derived fields match what their deriver last wrote" needs the deriver's last write. Where is it? (a) In the index: then `rm index.db && pjman index` makes every hand edit canon with no report — the index is not disposable, and drift is hidden, which the tenet forbids. (b) In git: then the validator reads `git log`/`blame` for a `Pjman-Session:` trailer per line, which fails for uncommitted edits (agent writes, human edits before the commit, one commit results), squash merges, amends, rebases, whole-file rewrites, and any store not in git. (c) In the record, as a signature over the derived fields (`ext.pjman.sig` or a core field): the only option that needs no second store, and it is not in the schema. (d) By re-derivation: only for fields that are functions of other data. `id`, `created`, `writer`, `session`, `type` are not derived from anything; they are *fixed at creation*. `observed` is derived from an external system and re-deriving it at validation time means a network call. The schema's single "D" conflates three different things — write-once, recomputable, and adapter-maintained — and only the second can be checked without a baseline.

2. **`updated` versus git.** On the file backend `updated` is written by whoever last wrote and is wrong after every hand edit (a hand may not write a D field, so a legitimate hand edit to `status` leaves `updated` stale by rule). The correct value is the commit time. Two clocks, and the schema names the wrong one as the field. Phase 0 already special-cases it.

3. **Two timestamps inside every UUID v7 record.** In the real store the ids decode to `2026-10-10T21:57:47.287Z` (14:57 PDT — the second the bootstrap commit `d76fbd8` was made) while `created` says `18:00-07:00`, three hours later; `decisions-as-view` has an id 56 seconds after its siblings and a `created` thirty minutes after. "Time-ordered" ids and `created` are two clocks that already disagree, and the schema does not say which is creation. A view sorted by id and a view sorted by `created` show different orders for the same records.

4. **The folder and the field** for decision→change (scenario 4), and the folder name and the bound key for a change's identity ("the slug is the bound external key or a short slug" — rebind the change and the folder lies).

5. **`pjman.yaml`** for the product id, with `product.md` also carrying `id`; the config can point at a product record that does not exist or differs.

6. **The handle→actor map.** `writer: person:vinh` resolves through `actors/` plus `aliases`. Two actor files claiming the same alias (an actor renamed on two machines to two handles, each listing the old one) resolve in file-iteration order; the rebuild is not deterministic.

7. **Observed-edge attribution.** An observed edge is `{edge, from, to, at}` with ids. Attribution "to the change bound at that moment" is reconstructible from files only if the adapter resolved the external key to a change id *at write time* and wrote that id in `from`. If it wrote the source id (what it actually observed — a ticket key in a prompt) and the index derives the change through `binds`, the rebuild attributes to the *current* bind, which changes when a change is re-bound or when scenario 2 leaves two binds. Phase 0's sessions "move tickets" mid-session, so this is the normal case. The schema does not say which the adapter writes; it must, and the answer that keeps the rebuild deterministic (write the change id) makes the edge record a resolution, not an observation.

## What must change before code

1. **Drop `updated` from the stored envelope on the file backend**, or define it as not-conflicting (derived from git at index time; absent on a hand-written record). Without this, every concurrent edit to any record conflicts and "mergeable" is false. Scenario 1.
2. **Split "D" into three marks**: fixed-at-creation (immutable; validated as unchanged against a signature carried in the record), derived (recomputable; validated by recomputation), adapter-maintained (`observed`, `title` refreshed by sync; validated only for shape). State where the baseline for the first lives. Without this, derived-field protection is unimplementable and the bootstrap store (21 hand-written records whose D fields have no deriver, only one marked `ext.bootstrap`) fails its own first validation or passes it vacuously.
3. **Say what the index does with a store that violates a cross-record invariant** after a merge: for binds-once, `(kind, key)`, supersedes, and dangling references in append-only sessions. "Reported, never skipped" is a logging policy, not a semantics. Scenarios 2, 3, 5.
4. **Add a tombstone/merge primitive** (`merged_into` on any record, honoured by reference resolution) so duplicate creation — guaranteed under "created on first mention" with two writers — is repairable without rewriting referrers or editing sessions. Scenario 3.
5. **Fix the session filename**: no timestamp-prefix `id8`; use the full id or the random low bits; define the date's source and timezone. One session per writing process. Scenario 6.
6. **Canonical key per source kind** (URL or key, which; case-sensitivity), lower-case rule for *all* slugs and handles, and a library refusal to create a case-colliding path. Scenarios 3b, 7.
7. **One location for decisions** (or a validation rule that folder and `change:` agree). Scenario 4.
8. **Decide whether the graph is branch-scoped.** If `.pjman/` stays in the working tree: say that a branch is a fork of the graph, say who commits records and when, forbid squash-merging the store or stop relying on trailers, and say how worktrees share a store. If not: move it (own branch, own repo, or user space) and drop the claim that git provides provenance for free. Scenario 8.
9. **Rewrite the storage-independence claim honestly.** Move items 1–12 of the file-specific list into a "Phase 1 file backend" section of the schema; keep in layer 0 only entities, fields, edge types, the three validation classes and the invariants. Then state the API contract that differs per backend: on files, `write()` is accepted-locally and the library exposes `reconcile()` after a pull with a typed conflict result; on a database, `write()` can reject. If that difference is unacceptable, the "same library API" is the thing to give up, not to assert.
10. **State the id contract** beyond "UUID v7": monotonic counter within a millisecond or not; whether `created` must equal the id's timestamp (then the bootstrap is invalid and the field is redundant) or is independent (then ids are not "time-ordered" in any sense a view may rely on); minimum prefix length the CLI will accept (the real store needs 14–15 hex characters); and that two machines' ids carry no causal order, so no validation may compare ids across writers.
11. **Replace the `ext:` byte-for-byte promise** with "structurally preserved; key order and formatting are not", and specify the YAML dialect (1.2, no implicit typing of dates/times) and the canonical emitter, so that a library rewrite of an untouched record produces no diff. Otherwise the first `pjman` write to this store rewrites 22 files.
