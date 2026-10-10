# pjman — schema (draft v1, layered)

*2026-10-10. The record contract, organised in five layers. Each layer adds record types, edges and validation rules, and depends only on the layers below it — upper layers reference lower ones, never the reverse, which is what the edge rule ("declared on the record that made it") guarantees. A store enables layers in `pjman.yaml`; the validator enforces only the enabled ones. Storage-independent (thesis decision 28). Fields are marked **A** (authored by a principal) or **D** (derived — written only by the tool that derives it, never by hand). Draft: every section is open until marked locked.*

```
4 · Authority   owners beyond the default, authorities, rubrics, approvals, bounded asks, maturity levels   (Phase 3)
3 · Product     product, feature, parents, affects, touches, claim                                          (Phase 1: present, optional)
2 · Work        change, decision, binds, evidence, parent                                                    (Phase 1: the product)
1 · Sources     source, session, links, observed edges                                                      (Phase 1: the foundation)
0 · Core        identity, principals, record envelope, index, validation                                    (Phase 1)
```

Phase 1 ships layers 0–2 with 3 available. Layer 4 is specified here only where it settles a lower layer's field.

---

## Layer 0 · Core

No records of its own. What every record and every layer shares.

**Record envelope.** Every record is a file with YAML frontmatter and a Markdown body, and carries:

| Field | A/D | Type | Notes |
|---|---|---|---|
| `id` | D | uuid v7 | Generated at creation, immutable, the only thing references point at |
| `writer` | D | principal | The principal that created the record |
| `created`, `updated` | D | timestamp | ISO 8601; `updated` moves on any write |

**Principals.** `person:<handle>` or `agent:<name>`. A person and an agent are the same kind of participant (thesis decision 30).

**Identity.** Folders are named by slug or external key and may be moved or renamed; the index re-resolves by `id`. The CLI accepts a full id, a unique prefix, a slug, or a bound external key. Humans never type a UUID.

**Edges.** Declared in the frontmatter of the record that made them, as lists of ids. Reverse edges are derived and never written. The set of edge types is data; each layer below adds its own.

**Index.** Rebuilt from the records; disposable; the only thing queries hit. Delete it and nothing is lost.

**Validation (the CLI is the schema).** Frontmatter parses; required fields present; enums in range; ids well-formed; every referenced id exists in the store; derived fields match what their deriver last wrote (a hand edit to a derived field is reported as drift); invalid records are reported, never silently skipped. Each layer adds rules.

**Location.** A *store* is a directory holding `pjman.yaml` plus the enabled layers' folders.
- In the repository: `.pjman/` at the repository root.
- In user space: `~/.pjman/stores/<slug>/`, with `~/.pjman/config.yaml` mapping paths or repositories to stores.
- Resolution: walk up from the working directory for `.pjman/`; else the user map; else none. The same record shape in either.

**Configuration — `pjman.yaml`:** `layers:` enabled; `vocabulary:` mapping (layer 2); `source_kinds:` (layer 1); adapters. Configuration is never in a record.

---

## Layer 1 · Sources

The foundation: the things you work with, and how they turn out to be related as agents touch them. Standalone, this is an artefact graph; anything with a kind and a key can enter it, including other tools' graphs.

### Source — `sources/<kind>/<key>.md`

An external thing: a ticket, an issue, a PR, a branch, a repo, a doc, a thread, a design, another graph's node. Small. Created on first mention, by an agent or the CLI. Holds what was last *observed* about the thing.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `kind` | A | string | From `source_kinds` in configuration: `linear-issue`, `github-issue`, `github-pr`, `git-branch`, `repo`, `doc`, `slack-thread`, `figma`, `url`, … |
| `key` | A | string | The external identifier: `ABC-1234`, `org/repo#123`, a URL |
| `url` | A | string | Optional |
| `title` | A/D | string | Authored on creation; refreshed by a sync adapter |
| `links` | A | [source id] | Sources this source refers to (a doc that cites a ticket) |
| `observed` | D | map | What the external system last showed: `status`, `title`, `assignee`, … Written only by a sync adapter |
| `observed_at` | D | timestamp | |

Body: optional notes. Filename rule: `key` is slugified for the path (URLs hashed to a short stable token); the real `key` lives in frontmatter.

### Session — `sessions/<yyyy-mm-dd>-<id8>.md`

Derived, one writer (the harness adapter that produced it), append-only. What a session was about, what it did, what it observed. The contract fixes only the shape other tools read.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `agent` | D | principal | `agent:<name>` |
| `on_behalf_of` | D | principal | The person the session ran for |
| `started` | D | timestamp | |
| `goal` | D | string | |
| `next` | D | string | What the machine thinks is next. If layer 2 is enabled, the bound change's `next` is authoritative |
| `observed` | D | [edge] | Observed edges: `{edge, from, to, at}`. In layer 1 alone, `from` and `to` are sources |

Body: `## Log` (numbered, one entry per turn that took action, append-only), `## Links`.

**Edges added:** `links` (source → source); observed edges (session → any edge, with provenance).

**Rules added:** `(kind, key)` unique among sources; `kind` is in configuration; a session's fields are never hand-edited.

---

## Layer 2 · Work

The record of a unit of work, and the decisions made in it. This is Phase 1's product; the founder's session board lives here.

### Change — `changes/<slug>/change.md`

A unit of work. The slug is the bound external key (`ABC-1234`) or a short slug, renameable because references use `id`.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `title` | A | string | |
| `status` | A | enum | From the vocabulary below |
| `owner` | A | principal | Defaults to the store's user. Layer 4 gives it meaning beyond a default |
| `parent` | A | change id | Optional. A milestone containing tickets; an epic |
| `binds` | A | [source id] | Identity: *this change is that ticket*. A source binds to at most one change |
| `links` | A | [source id] | Context: docs, threads, designs. Many-to-many |
| `evidence` | A | [source id] | Sources that show the work: PRs, test runs, deploys. Its own field because acceptance reads it |
| `next` | A | string | The handoff: the next action. What resume reads first |

Body sections: `## Summary` (required: what and why), `## Plan` (inline, or a link to `plan.md` in the same folder), `## Feedback` (review cycles, dated, newest first). No Conversations section: derived from sessions.

Decisions made in the course of the change live in `changes/<slug>/decisions/`.

### Decision — `changes/<slug>/decisions/<yyyy-mm-dd>-<slug>.md`, or `decisions/` at the store root for product-level decisions

The only record a human is expected to write. In layer 2 a decision is opened as `proposed` and becomes `decided` when a principal sets it; layer 4 adds the default and the deadline that make it a bounded ask.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `title` | A | string | The decision in one line |
| `status` | A | enum | `proposed` · `decided` · `superseded` · `reverted` |
| `change` | A | change id | Optional for product-level decisions |
| `decided_by` | A | principal | Required when `decided` |
| `decided_on` | A | date | Required when `decided` |
| `supersedes` | A | decision id | Optional |
| `links` | A | [source id] | Optional |

Body sections: `## Decision` (what), `## Why` (rationale), `## Options` (optional), `## Consequences` (optional).

### Status vocabulary (default; mapped by configuration)

| Status | Meaning |
|---|---|
| `open` | Declared; nobody working on it |
| `planning` | Being shaped; a plan is forming |
| `active` | Work underway |
| `blocked` | Waiting on something named in `next` |
| `review` | Work complete, awaiting acceptance |
| `done` | Accepted |
| `dropped` | Closed without acceptance |

`pjman.yaml` maps an organisation's words onto these (`implementing: active`, `merged: done`, Linear's and Jira's state names); views read the canonical set. A bound source's `observed.status` is mapped the same way; where it disagrees with the change's `status`, that is **drift**, reported by the index.

**Edges added:** `binds` (change → source, a source bound at most once), `evidence` (change → source), `links` (change · decision → source), `parent` (change → change), `change` (decision → change), `supersedes` (decision → decision). Session `observed` edges may now have a change as `from`, attributed to the change bound at that moment.

**Derived:** a change's decisions; a source's change; a change's sessions; a decision's superseded-by.

**Rules added:** a source binds to at most one change; a `decided` decision has `decided_by` and `decided_on`; a `superseded` decision is pointed at by a newer decision's `supersedes`; `status` is in the vocabulary.

---

## Layer 3 · Product

The tree: what changes are to. Present in Phase 1 so `touches` has a target and the tree arrives without a migration; optional until someone declares a feature.

### Product — `product.md` (one per store)

| Field | A/D | Type | Notes |
|---|---|---|---|
| `title` | A | string | |
| `owner` | A | principal | Defaults to the store's user |

Body: `## Summary`.

### Feature — `features/<slug>/feature.md`

Not defined; only its contract is (thesis decision 25). Size and meaning are the author's; no `kind`, no typed hierarchy; unlimited depth.

| Field | A/D | Type | Notes |
|---|---|---|---|
| `title` | A | string | |
| `parents` | A | [feature id] | Zero or more; the cross-cut as people draw it |
| `owner` | A | principal | Inherits along a single parent line; required when several parents |
| `affects` | A | [feature id] | |
| `claim` | A | string | Optional maturity claim: `prototype`, `holds 1k users`. Layer 4 grades it |
| `evidence` | A | [source id] | Optional; what supports the claim |
| `links` | A | [source id] | Optional |

Body: `## Summary`.

**Edges added:** `touches` (change · decision → feature), `parents` (feature → feature), `affects` (feature → feature), `evidence` and `links` (feature → source).

**Derived:** a feature's children; where-used (every feature that lists it in `parents` or `affects`); a feature's changes and decisions.

**Rules added:** a feature with several `parents` names its own `owner`; no cycle in `parents`; mappings to code are derived and never create features (decision 25).

---

## Layer 4 · Authority (Phase 3 — sketched only where it settles a lower layer's field)

- `owner` on a change or feature becomes the principal whose signature a change needs; approvers are derived from what a change `touches` and `affects`, and from each discipline's **authority** record with a scope over the tree.
- **Decision** gains `default` (what happens if nobody decides) and `due` (when the default applies): the bounded ask.
- **Rubric** records: an owner's or authority's criteria, versioned; a **maturity level** is a rubric plus a required evidence grade; `claim` on a feature is graded against `evidence` (telemetry > simulation > analysis).
- Which scopes require a human is policy on the tree (decision 30).

---

## Open points in this draft

1. `next` on the change (authored) *and* on the session (derived): both kept, with the change's authoritative. Confirm.
2. `parent` on a change: kept in layer 2 (needed for milestones; costs nothing). Confirm.
3. `evidence` as its own field: kept (acceptance reads it). Least certain choice.
4. Observed edges carry no confidence. Enough for Phase 1?
5. Source filename rule for URL keys: slugify, hash long keys. Confirm.
