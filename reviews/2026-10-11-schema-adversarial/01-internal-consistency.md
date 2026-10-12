# Adversarial review 01 — internal consistency and implementability of SCHEMA.md (draft v2)

*2026-10-11. Read in order: `SCHEMA.md` (307 lines), the 22 records plus `pjman.yaml` under `.pjman/`, `DECISIONS.md` 25–30. Line numbers are `SCHEMA.md` unless a file is named. Git history was consulted only to test the schema's own provenance and drift claims against its own store.*

## Verdict

The schema does not hold as written. Its organising promise — "each depends only on the ones below (upper layers reference lower, never the reverse — the edge rule guarantees it)" (L3) — is broken three times by the text itself: the layer-0 envelope points at a layer-1 session (L24, diagram L219), the layer-0 actor points at layer-1 sources (L40), and a layer-1 session carries edges whose endpoints are layer-2 changes (L169). The `touches` edge is named in three places (L7, L177, L200) and declared on no table, so under the extension rule it can only exist as `ext.touches`, which validation ignores. The A/D marking is unimplementable as defined: every envelope field is D, "written only by the tool that derives it" (L3), yet the schema expects hand-written records (L24, L137, L307); and the drift rule "derived fields match what their deriver last wrote" (L66) needs memory the schema forbids ("Index … disposable", L62). The store confirms it: twenty-one of twenty-two records carry a `session` the text says a hand-written record must not have, every `created` timestamp is three hours later than the git commit that created the file, the session's `writer` is false, and the last commit hand-edited the derived `type` field on two records without moving `updated` — a drift the schema cannot detect and the walk-through did not notice. Before code: (1) decide what D means on a hand-written record and what "last wrote" is stored as; (2) either drop the layer-dependency claim or move `session`, actor `links`, and observed edges to where the claim is true; (3) give `touches` a field; (4) specify observed edges as a typed, validated structure or remove the "any edge type" clause; (5) regenerate the store's envelopes from a tool, since a hand-built store cannot test a schema whose core fields are tool-only.

## Contradictions

1. **Layer rule vs the envelope's `session` field.** L3: "each depends only on the ones below (upper layers reference lower, never the reverse — the edge rule guarantees it)". L24: `session | D | session id | Optional: the run that created it`. L295: "layer 0 is the envelope and `ACTOR`; layer 1 is `SOURCE` and `SESSION` … Every arrow points from a higher layer to the same or a lower one." L219: `ENVELOPE ||--o{ SESSION : "session"` — a layer-0 → layer-1 arrow in the diagram directly under the sentence that denies it. Layer 0 cannot be implemented without layer 1.

2. **Layer rule vs actor `links`.** L40: `links | A | [source id] | Optional: a profile, an email, an agent's definition file`. Actor is layer 0 (L295); source is layer 1. The edge appears in no layer's "**Edges:**" line (L112, L169, L200) and not in the diagram.

3. **Layer rule vs observed edges.** L101: a session "Exists as the home for observed edges"; L112: "observed edges (session → any edge type, with provenance)"; L169: "Session `observed` edges may have a change as `from`." A layer-1 record holding layer-2 ids. L3 says "the edge rule guarantees it", but the edge rule (L58, "Declared in the frontmatter of the record that made them") is precisely what an observed edge breaks: the session did not make the `links` edge from change to source; it noticed it. Both cannot stand.

4. **`touches` has no field.** L7 lists `touches` as a layer-3 noun; L177 "Present so `touches` has a target"; L200 "**Edges:** `touches` (change · decision → feature)"; diagram L228–229. The Change table (L123–129) and Decision table (L139–147) have no `touches` row. By L58 it must be declared on the change or decision; by L50 any key the schema does not define "is allowed … ignored by validation … under one namespace: `ext:`". So `touches` is either unwritable or unvalidated, and layer 4's "approvers derived from `touches`" (L208) has nothing to read.

5. **D-marked envelope vs hand-written records.** L3: "**D** = derived, written only by the tool that derives it." L21–25 mark `id`, `type`, `writer`, `session`, `created`, `updated` D. L24: "Absent on a hand-written record" (so hand-written records exist). L137: "The only record a person is expected to write." L307: "written by hand: twenty-two records." A hand-written record cannot carry `id` or `type` without a person writing a D field, and without them fails "required fields present" (L66).

6. **Drift on derived fields vs a disposable index.** L66: "derived fields match what their deriver last wrote (a hand edit to a derived field is drift)". L62: "Index: Rebuilt from the records; disposable; the only thing queries hit." What the deriver last wrote must be remembered somewhere that is neither the (editable) record nor the (disposable) index. The only candidate the text offers is git (L46), which contradicts "Storage-independent" (L3) and the hosted case in the same paragraph. For `title` (L92, `A/D`) there is no answer even with git: an authored edit and a sync refresh are indistinguishable.

7. **Bootstrap exception keyed on `ext` vs `ext` never validated.** L113: "a session is never hand-edited — with one exception: a store's bootstrap session … marked `ext.bootstrap: true`." L50: `ext:` is "ignored by validation"; L66: "`ext:` is never validated". The validator must read `ext.bootstrap` to apply the exception. One rule yields. And because any session may set the flag, the exception is a universal bypass.

8. **Feature `owner`: decision 25 vs the table.** `.pjman/decisions/2026-10-09-feature-contract-not-definition.md` L17: "Every feature has a name, zero or more parents, an owner". L194: `owner | A | actor ref | Optional; inherits along a single parent line; required with several parents`. `DECISIONS.md` 25 adds "(defaulting to the single user in single-player)", a default the schema does not have.

9. **Decision location vs the `change` field.** L133: "Decisions made in the course of the change live in `changes/<slug>/decisions/`." L145: `change | A | change id | Optional`. L54: "Folders … may be moved or renamed; the index re-resolves by `id`." Decision 28 (`DECISIONS.md` L37): edges are "declared on the record that made them in frontmatter, never in prose". A folder is a third declaration channel. A decision in `changes/a/decisions/` with `change:` = b, or with no `change:`, is valid under every rule and means two different things.

10. **"Humans never type a UUID" vs the one record a person writes.** L54: "Humans never type a UUID." L137: decisions are "The only record a person is expected to write." A decision's `change`, `supersedes` and `links` (L145–147) are ids. Without the CLI (which Phase 1 is building, `changes/library-cli`), the person types UUIDs; the store's seven decisions were produced that way.

11. **"DECISIONS.md duplicates decision records" (L307) is false; they diverge.** `DECISIONS.md` 27 is "(2026-10-09, provisional)"; `.pjman/decisions/2026-10-09-identity-uuid-v7.md` L9 is `status: decided`. `DECISIONS.md` 28 names edges "`binds` … `links`; `evidence`; `parent`; `affects`; `touches`; `decided`"; L299 prunes `evidence` and `parent`, and `decided` is nowhere in the schema; the record omits the edge list. `DECISIONS.md` 25 "revised 2026-10-09 from one-parent to many-parents" is a revision the schema says is a `supersedes` chain (L146, L171); the record folds it into one `decided` record dated 2026-10-10.

12. **Session as "derived, one writer (the adapter that produced it)" (L101) vs session as the provenance root for every record (L24, L46).** If sessions "belong to the adapters, not the contract" (`DECISIONS.md` L35) they cannot also be the layer-0 provenance requirement "not a feature" (L46).

## Ambiguities

1. **Required vs optional per type.** The Change `links` row (L129) carries no "Optional" while `binds` (L128) does; Counts (L303) says change has two required fields, so `links` must be optional, contradicting the table's silence. Session `observed` (L108) is unmarked; Counts says session has two. Source `observed_at` (L95) has an empty Notes cell. Feature `parents` "Zero or more" — must the key be present as `[]`? Is a body section (`## Summary` L131, `## Decision`/`## Why` L149, `## Summary` L198) a "required field" under L66, which only lists frontmatter checks?

2. **What an observed edge is.** L108 gives `{edge, from, to, at}`. Is `edge` drawn from the authored set (`links`, `binds`, `change`, `supersedes`, `touches`, `parents`, `affects`), the envelope set (`writer`, `session`), or "any" string (L112)? May `from`/`to` be a handle ref? Is `at` required? May one session record the same edge twice? Does an observed `binds` count toward "a source binds at most once" (L171)? Does an observed `links` that duplicates an authored one (the store's session does exactly this, `sessions/2026-10-10-01a127d2.md` L10–11 vs `changes/schema/change.md` L14–16) confirm, conflict, or nothing?

3. **`binds` uniqueness scope.** Across all `changes/*/change.md` in one store, presumably. Across the repository store and a user-space store mapped to the same path (L72–73)? Within one change (`binds: [X, X]`)? The same id in both `binds` and `links`?

4. **`updated` on a derived write.** L25 marks it D. Does a sync adapter writing `observed`, `observed_at`, `title` bump `updated`? Does a person editing a decision body (they may not write D fields) bump it? If sync bumps it, `updated` cannot mean "authored content changed"; if it does not, `updated` is stale after every hand edit.

5. **"A hand edit to a derived field is drift" — mechanically.** See Contradiction 6. The implementer has three choices (git blame, a persisted ledger, a digest in the record) and the text picks none.

6. **`status` on a change: canonical or organisation word?** L126 "From the vocabulary"; L163 the vocabulary "maps an organisation's words onto these … Views read the canonical set"; L167 maps `observed.status` "through the vocabulary". May a record hold `merged`? May `vocabulary:` remap a canonical word (`done: dropped`)? What happens when `observed.status` has no mapping — drift, error, or ignore?

7. **Two `observed` shapes.** Source `observed | D | map` (L94); Session `observed | D | [edge]` (L108). Same key, two types; a query "readable through the index" (L50) must branch on record type. `observed.status` (L167) is an undocumented required key of an untyped map.

8. **Which date in a filename.** Decision `<yyyy-mm-dd>-<slug>.md` (L135): `created`, `decided_on`, or the day the decision was actually made? The store uses all three differently (filename 10-09, `decided_on` 10-10, `DECISIONS.md` 10-08). Session `<yyyy-mm-dd>-<id8>.md` (L99): `started` or `created`? The store's session has `started` 10-05, `created` 10-10, filename 10-10. Timezone unspecified; `created` uses −07:00 while the id encodes UTC.

9. **Actor ref prefix vs `kind`.** L42 refs are `person:<handle>` / `agent:<handle>`; L36 `kind` is a field. Must they agree? Are handles unique across kinds (folder `actors/<handle>.md`, L30, says one namespace) or per kind (the prefix implies two)? Does `aliases` (L39) resolve refs only, or folder names too?

10. **Session `writer` vs `agent`.** L23 `writer` is "the actor that created the record"; L105 `agent` is an actor ref with no note. When do they differ? For a spawned subagent (L32, "a session with a `parent`") what is `agent` — the parent's agent, the harness, or a named agent definition? L32 forbids it being a new actor, so a one-off subagent has no distinct identity at all.

11. **`superseded` / `reverted` without having been decided.** L143–144 require `decided_by`/`decided_on` only "when `decided`". A decision may go `proposed` → `superseded`. `reverted` records nothing about who or when. L171 "a newer one's `supersedes`" — newer by `created`, `decided_on`, or id order?

12. **Layer names and their dependencies in `pjman.yaml`.** L77 says only "`layers:` enabled". The store uses `core, sources, work, product`; the schema never names them. Is `core` implicit? May `work` be enabled without `sources` when `binds` and `links` point at sources? What does the validator do with folders of a disabled layer — ignore, reject, or read for id resolution?

13. **Source filename vs key.** L97: "long keys (URLs) hashed to a short stable token" — how long, which hash? Is the filename validated against `key`, or free (L54)? `THESIS.md`, `thesis.md` and `thesis-md` are three distinct `(kind, key)` pairs with one filename. Is `key` compared case-sensitively?

14. **`session` on a record hand-written during the bootstrap.** L24 "Absent on a hand-written record." The store does both: actors omit it, the other nineteen include it.

15. **`id` time vs `created`.** L21 "Generated at creation". Must the v7 timestamp agree with `created`? The store's differ by three hours (see nonconformances).

16. **Owner inheritance can bottom out.** L194: a single-parent feature inherits. A chain ending at a parentless feature with no `owner`, in a product with no `owner` (L184 optional), has no owner. Valid or not?

## Missing or unimplementable rules

1. **No cycle rule for `supersedes`.** L171 only requires "a `superseded` decision is pointed at by a newer one's `supersedes`". A ↔ B with both `superseded` satisfies it.
2. **No converse for `supersedes`.** `supersedes: X` does not require `X.status == superseded`; X stays `decided` and two live decisions coexist. A `proposed` decision may `supersedes` a `decided` one — effective now or on decision? Unstated.
3. **No cycle rule for `affects`.** Layer 4 derives approvers and where-used from `affects` (L201, L208); a cycle makes that derivation unbounded.
4. **Reference scope is unspecified.** "every referenced id or handle exists" (L66) — in this store only? Resolution (L73) finds one store. A `change:` pointing at another store's change is either an error or silently unresolvable; the schema does not say which, and uuids are global so the implementer will be tempted to resolve across stores.
5. **No alias uniqueness.** Nothing requires `handle ∪ aliases` to be disjoint across actors, an alias to differ from another actor's handle, or an actor not to list its own handle as an alias.
6. **No prefix/`kind` agreement check** (`writer: person:claude-code` passes "handle exists").
7. **No key normalisation for `(kind, key)` uniqueness.** The same external thing under two kinds (`git-repo: vinhvanvu/pjman`, `url: https://github.com/vinhvanvu/pjman`) or two spellings (`vinhvanvu/pjman`, `vinhvanvu/pjman.git`) is two sources, and "binds at most once" is evaded without a rule being touched.
8. **Observed edges are under no rule at all.** Not type-checked against the enabled layers' edge set; `from`/`to` types not checked against the edge's declared endpoints (L112 "any edge type"); not subject to binds-once or `parents` acyclicity; `at` unordered relative to `created` of the endpoints.
9. **"Derived fields match what their deriver last wrote" is unimplementable as stated** (Contradiction 6). Either store a digest or downgrade to "D fields are tool-owned; validation checks shape only".
10. **"A session is never hand-edited" is undetectable from the record.** It needs the `Pjman-Session: <id>` commit trailer (L46). No commit in this repository carries one, including the bootstrap commit 35fe788 that wrote the session — so the schema's own provenance requirement is unmet by its own store.
11. **Session filename `<id8>` is not a discriminator.** The first eight hex characters of a UUID v7 are the top 32 bits of a 48-bit millisecond timestamp: a 65.5-second bucket. Two sessions in one fan-out (L107 "A fan-out is a tree") collide on filename. In this store all 22 ids share their first thirteen characters (`01a127d2-7897-7`), so "a unique prefix" (L54) is fifteen characters long.
12. **No schema version anywhere.** Commit 7c4b946 changed the `type` enum (`principal` → `actor`) by hand-editing a D field on two records (`.pjman/actors/*.md`) without moving `updated`. The validator cannot tell a v2 store from a renamed one, and the drift rule (L66) fires on the schema's own rename.
13. **`pjman.yaml` is underspecified.** L77 lists `layers`, `vocabulary`, `source_kinds`, adapters. The store adds `product: <uuid>`, which L77 does not define and which puts a record reference in configuration against "Configuration is never in a record" read the other way. `adapters: []` has no shape. No `ext:` escape hatch for configuration.
14. **"one per store" for `product.md` (L179) has no validation**, and since `type` is "self-describing when a file moves" (L22), `features/x/feature.md` with `type: product` is legal. More generally the text never says whether folder path participates in validation (`sources/<kind>/` vs `kind:`, `changes/<slug>/change.md`, `changes/<slug>/decisions/` vs `change:`).
15. **No ordering rules on dates.** `decided_on` in the future; `decided_on` before the `change` it belongs to was created; `started` before the `agent` record existed (the store does this); `observed[].at` before the endpoints existed (the store does this).
16. **Bootstrap circularity.** `actors/vinh.md` L4 `writer: person:vinh` resolves to itself. "every referenced … handle exists" passes only if actors are loaded before validation; order unstated.
17. **Body sections are not in the validation list.** L66 enumerates frontmatter checks only; `## Summary` "required" (L131) is unenforced unless the validator parses Markdown, which the text does not say.
18. **`title` A/D (L92) has no conflict rule.** If authored and sync disagree, L167 covers `status` only.

## Store nonconformances

Mechanical checks passed: all 22 ids are well-formed v7 (version nibble 7, variant 8–b), unique, and every referenced id and handle resolves; `kind` values are in `source_kinds`; source filenames match the slug rule; every change has `## Summary`, every decision `## Decision` and `## Why`; the one change-scoped decision's `change:` matches its folder.

**All 22 records**
- `created` is later than the git commit that introduced the file. Bootstrap commit 35fe788 is dated 2026-10-10 14:58:10 −07:00; every record says `created: 2026-10-10T18:00:00-07:00`. The ids encode 2026-10-10T21:57:47Z (14:57:47 −07:00), i.e. the genuine mint time; `created` is a round number three hours in the commit's future. L21 "Generated at creation" and L25 are both violated by one of the two.
- Twenty of 22 carry `session: 01a127d2-…fc78` on a record the walk-through calls hand-written; L24: "Absent on a hand-written record". The two actor records omit it. Either twenty records or two are wrong.

**`.pjman/pjman.yaml`**
- `product:` key not defined by L77.
- Layer names `core, sources, work, product` not defined by the schema.
- `adapters: []` shape undefined.
- No schema version.

**`.pjman/product.md`** — `session` on a hand-written record (L24). Otherwise conforms.

**`.pjman/actors/claude-code.md`**
- `type` hand-edited `principal` → `actor` (commit 7c4b946) with `updated` unchanged: a hand edit to a D field, the exact case L66 calls drift.
- Omits `session` while every sibling record of the same bootstrap carries one.

**`.pjman/actors/vinh.md`**
- Same hand edit to `type` without `updated`.
- `writer: person:vinh` is self-referential (Missing 16).

**`.pjman/sources/doc/claude-session-board.md`** — `key: claude-session-board` is a local folder name, not "The external identifier: `ABC-1234`, `org/repo#123`, a URL" (L90); no `url`. `session` on a hand-written record.

**`.pjman/sources/file/layers-md.md`, `thesis-md.md`, `reports-pjman-worth-building-analysis.md`, `.pjman/sources/git-repo/vinhvanvu-pjman.md`** — `session` on a hand-written record; otherwise conform. (`vinhvanvu/pjman` keys a repository that per its own body "is not yet created".)

**`.pjman/sessions/2026-10-10-01a127d2.md`**
- `writer: agent:claude-code` is false: the body (L24 of the file) says "Hand-written during bootstrap", by the person. L23 defines `writer` as "The actor that created the record".
- The hand-edit exception rests on `ext.bootstrap: true`, which validation may not read (Contradiction 7).
- `started: 2026-10-05` precedes `created` of the `agent` it names (`actors/claude-code.md`, 2026-10-10) and of every record it claims to have created.
- Both `observed` edges (`links` from the schema change to two sources, `at: 2026-10-09`) duplicate authored edges already on `changes/schema/change.md` L14–16, and are dated before either endpoint's `created` (2026-10-10) and before the ids were minted.
- No `Pjman-Session:` trailer on commit 35fe788 (L46).

**`.pjman/changes/adapters/change.md`, `library-cli/change.md`, `public/change.md`, `schema/change.md`, `second-user/change.md`** — `session` on a hand-written record; otherwise conform.

**`.pjman/changes/decisions-as-view/change.md`**
- `created: 2026-10-10T18:30:00-07:00`; its id encodes 21:58:43Z = 14:58:43 −07:00, exactly commit d76fbd8's time. Same fabrication as above, independently.
- Summary says "Blocked on the CLI being able to render"; `status: open` ("Declared; nobody working on it", L155), not `blocked` (L158). Status and body disagree.
- `session` on a hand-written record.

**`.pjman/changes/schema/decisions/2026-10-10-layered-minimal.md`** — `session` on a hand-written record; otherwise conforms.

**`.pjman/decisions/2026-10-09-feature-contract-not-definition.md`**
- Filename date 2026-10-09; `decided_on: 2026-10-10`; `DECISIONS.md` 25 says 2026-10-08 revised 2026-10-09. Three dates, one decision.
- Body "an owner" (required) contradicts the schema's optional `owner` (Contradiction 8).
- The 2026-10-09 revision is folded in, not a `supersedes` chain.

**`.pjman/decisions/2026-10-09-four-nouns.md`** — filename 10-09 vs `decided_on` 10-10 (`DECISIONS.md` 26: 2026-10-09).

**`.pjman/decisions/2026-10-09-identity-uuid-v7.md`** — filename 10-09 vs `decided_on` 10-10; `status: decided` where `DECISIONS.md` 27 is "provisional" (should be `proposed`, or the log is wrong).

**`.pjman/decisions/2026-10-10-humans-and-agents-same-participant.md`, `records-truth-graph-index.md`, `substrate-and-layer.md`** — conform apart from `session`; `records-truth-graph-index.md` diverges in content from `DECISIONS.md` 28 (Contradiction 11).

**Placement.** Decisions 25, 26, 27 were made "in the course of" the schema change (L133) and sit at the store root with no `change:`; only `layered-minimal` is under `changes/schema/decisions/`. Legal under every rule, which is the problem (Contradiction 9).

## Evil records

Each passes every rule written in `SCHEMA.md`.

**E1 — one external thing, two sources, two binds.** Rule evaded: "`(kind, key)` unique among sources" (L113) and "A source binds at most once" (L128, L171) — no key normalisation, no cross-kind identity.

```yaml
# sources/git-repo/vinhvanvu-pjman.md       (exists)
kind: git-repo
key: vinhvanvu/pjman
# sources/url/<hash>.md                      (new)
kind: url
key: https://github.com/vinhvanvu/pjman
# changes/library-cli/change.md
binds: [<id of git-repo source>]
# changes/public/change.md
binds: [<id of url source>]
```
Both changes now "are" the same repository. The drift rule (L167) fires twice against two `observed.status` values that a sync adapter will have to fetch from one place.

**E2 — two actors answer to one ref.** Rule evaded: `aliases` "resolves renames" (L42) with no uniqueness across actors (Missing 5).

```yaml
# actors/vinh.md         handle: vinh
# actors/vinh-old.md     handle: vinh-old
                         aliases: [vinh]
```
`writer: person:vinh` on every record in the store now resolves to two actors. "every referenced … handle exists" (L66) is satisfied; provenance (L46) is not. Variant: `writer: person:claude-code` on a record — handle exists, `kind: agent`, no rule compares prefix to kind.

**E3 — an observed edge that does what the authored rules forbid.** Rule evaded: `observed` is "session → any edge type" (L112) and is under no layer-2 or layer-3 rule.

```yaml
# sessions/2026-10-11-xxxxxxxx.md
observed:
  - {edge: binds,   from: <change A>, to: <source S already bound by change B>, at: …}
  - {edge: parents, from: <feature F>, to: <feature F>, at: …}
  - {edge: touches, from: <decision D>, to: <actor vinh's id>, at: …}
```
First line: S is bound twice, authored-once rule (L171) checks only `binds` fields. Second: a `parents` cycle, "no cycle in `parents`" (L202) checks only `parents` fields. Third: `touches` to a non-feature; nothing types `to`. In a store with `layers: [core, sources]` the same session may observe `touches` with the product layer disabled; "The set of edge types is data; each layer adds its own" (L58) never says which layer's set is in force.

**E4 — mutual supersession, both superseded.** Rule evaded: L171 "a `superseded` decision is pointed at by a newer one's `supersedes`" — satisfied for both, no cycle check, "newer" undefined.

```yaml
# decisions/a.md   status: superseded   supersedes: <b>
# decisions/b.md   status: superseded   supersedes: <a>
```
Variant: `decisions/c.md status: proposed supersedes: <a decided decision>` — the decided decision is now both in force and superseded-in-waiting; and `decisions/d.md status: decided supersedes: <d>` self-supersession.

**E5 — the self-exempting session.** Rule evaded: L113's exception.

```yaml
# sessions/2026-10-11-deadbeef.md
writer: person:vinh
agent: agent:claude-code
ext: {bootstrap: true}
observed: [ …anything… ]
```
"a session is never hand-edited" has a flag that any hand can set, in a namespace validation may not inspect.

**E6 — a canonical word remapped.** Rule evaded: `vocabulary:` (L163) is a free map; nothing forbids canonical words as keys.

```yaml
# pjman.yaml
vocabulary: {done: dropped, dropped: done}
```
Every view that "reads the canonical set" now reads the opposite of what the organisation means, and drift (L167) inverts.

**E7 — the second product.** Rule evaded: "one per store" (L179) is prose; `type` is "self-describing when a file moves" (L22).

```yaml
# features/x/feature.md
type: product
title: another root
```
`pjman.yaml`'s `product:` pointer (itself undefined) is the only thing that could disambiguate, and the schema does not say it is consulted.

## Diagram vs tables

Edges in tables, absent from the diagram:
- `ACTOR.links → SOURCE` (L40).
- `DECISION.links → SOURCE` (L147). The diagram has `CHANGE–SOURCE` (L223) and `SOURCE–SOURCE` (L224) but no `DECISION–SOURCE` line.
- `FEATURE.links → SOURCE` (L196).
- `SESSION.observed` (L108) — the one edge kind the whole provenance story rests on is not drawn; "Every arrow points from a higher layer to the same or a lower one" (L295) is only true because the arrows that would break it are missing.

Edges in the diagram, absent from the tables:
- `PRODUCT ||--o{ FEATURE : "contains"` (L232). No field on Product or Feature declares it; a feature with zero `parents` (L193) is implicitly a root, but "contains" is not derived from anything listed under **Derived** (L201) and "Reverse edges are derived and never written" (L58) does not cover it.
- `CHANGE }o--o{ FEATURE : "touches"`, `DECISION }o--o{ FEATURE : "touches"` (L228–229): no field (Contradiction 4).

Cardinalities that disagree with the rules:
- `ENVELOPE ||--o{ ACTOR : "writer"` (L218) reads "one envelope, many actors". `writer` is one actor per record; many records per actor: should be `ENVELOPE }o--|| ACTOR`.
- `ENVELOPE ||--o{ SESSION : "session"` (L219): same inversion, and `session` is optional (L24): `ENVELOPE }o--o| SESSION`.
- `CHANGE }o--|| ACTOR : "owner"` (L222): `owner` is optional (L127): `}o--o|`.
- `DECISION }o--|| ACTOR : "decided_by"` (L226): required only when `decided` (L143): `}o--o|`.
- `CHANGE }o--o{ SOURCE : "binds (once), links"` (L223): one line for two edges with different cardinalities; `binds` is many-changes-to-one-source **forbidden** (L171), so the `binds` half is `}o--o|` from the source side (`SOURCE o|--o{ CHANGE`), which the drawn `}o--o{` denies.
- `PRODUCT ||--o{ FEATURE` (L232): asserts every feature belongs to exactly one product; nothing in the Feature table gives a feature a product, and multi-store resolution (L73) never loads two products, so "exactly one" is unenforceable, not false.

Type labels: `ENVELOPE { uuid session }` (L239) vs table "session id" (L24) and `ref writer` vs "actor ref" — consistent in intent, but the diagram has `DECISION { uuid change, uuid supersedes }` while `SESSION { uuid parent }` — fine — and `ACTOR { list links }` with no target type, which is where the layer violation hides.

The sentence under the diagram, "Every arrow points from a higher layer to the same or a lower one" (L295), is false for L219 as drawn and would be false for three more arrows if the diagram were complete.
