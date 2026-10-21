# 04 · The null hypothesis: a folder is enough

*Adversarial review, 2026-10-11. Lens: the research report's own framing — Phase 1's competitor is "a `docs/decisions` folder plus AGENTS.md", and the only question is whether a typed decision record in git, read by an agent, beats that folder on the founder's own work. This review argues it does not. Inputs: `THESIS.md`, `SCHEMA.md` (v2), `reports/pjman worth building analysis.md`, the `.pjman/` store, and the session board at `~/Downloads/claude-session-board/`.*

## Verdict

The folder is enough for Phase 1 with about 80 % probability, and the founder's own repository is the evidence. The schema's distinguishing machinery — supersession edges, `binds`, observed edges with provenance, UUID identity, a disposable index, a library as sole writer — exists to arbitrate between writers, tools and stores. In `.pjman/` there is one writer, one tool and one store, and the machinery is correspondingly unused: `supersedes` appears in zero of seven decisions (the one decision that *was* revised, feature contract 25, records its revision as a prose aside, exactly as `DECISIONS.md` did), `binds` is `[]` on all five changes, every decision is `decided` and none was ever `proposed`, all seven carry `decided_on: 2026-10-10` for decisions `DECISIONS.md` dates between 10-05 and 10-10, and each `## Why` ends by citing the prose log it was transcribed from (`(DECISIONS.md 28.)`). Of 296 non-blank lines in the store, 237 are frontmatter, 129 of those are envelope, and 59 are content; there are 57 UUID occurrences that no human can read and that the schema promises no human will type. The store is a transcription of a markdown file into a shape that the only reader — an agent — could read before the transcription. Phase 0 is already a folder convention with a 57-line skill, a 58-line template and a 29-line CLAUDE.md paragraph, in daily use. What v2 adds on top is almost entirely what a second person, a second harness or a hosted database would need, and the report's gate — "an agent reads a prior decision and honours it in a way the folder would not have managed" — has no mechanism in the Phase 1 schema that produces that outcome: the one documented failure mode of the folder (Davidson's stale ADR) is a decision drifting from *code*, and the schema's drift object only compares a change's `status` with a ticket's `status`. The remaining 20 % is the founder-as-adapter-author: a library pays off for someone writing a pane and a sidebar against the records, which is him and nobody else in Phase 1.

## The best no-schema alternative

What follows is the README of the alternative, written to be adopted tomorrow. It is Phase 0 moved into the repository with two additions (a decisions file with status words, and a drift sentence in the agent instructions) and nothing else.

---

### `docs/changes` — a folder convention for agent-assisted work

One folder per unit of work, in the repository, in git. The agent keeps it; you write only decisions. No tool to install; no schema to validate; the files are the record and `git` is the history.

#### Layout

```
AGENTS.md                      # the paragraph below (CLAUDE.md @imports it)
docs/
  decisions.md                 # product-level decisions, format below
  changes/
    ABC-1234/                 # the ticket key, or a short slug for untracked work
      README.md                # frontmatter + Summary + Next
      decisions.md             # decisions made in this change, format below
      plan.md                  # the approved plan (plansDirectory points here)
      feedback.md              # optional: review cycles
```

The folder name is the identity. A ticket has one folder because a directory can only exist once; renaming is `git mv` and the agent fixes the links. Session records stay where the harness puts them (`~/.claude/session-records/`, written by the session-orient mod) — they are derived, have one writer, and are never in the repo.

#### `README.md`

```markdown
---
ticket: ABC-1234
url: https://linear.app/acme/issue/ABC-1234
status: implementing      # planning | implementing | review | blocked | merged | closed
prs:
  - https://github.com/acme/app/pull/123
touches: [auth, billing]  # free words; grep is the index
---
## Summary
What and why, two paragraphs at most.

## Next
The one thing a fresh session should do first.
```

#### `decisions.md` (same format at product level and per change)

Newest first. One heading per decision. The status word in brackets is the contract.

```markdown
## 2026-10-10 · Records are the truth; the graph is an index   [decided]
Why: a side store kept in sync is a second source of truth.
Supersedes: 2026-10-08 · One parent per feature

## 2026-10-08 · One parent per feature   [superseded by 2026-10-10 · Records are the truth…]
Why: …

## 2026-10-11 · Rename principal → actor   [proposed]
Why: …   Default if nobody objects by 2026-10-14: decide.
```

Four words: `[proposed]`, `[decided]`, `[superseded by …]`, `[reverted]`. A decision opens `[proposed]` *before* the work it governs; the agent asks you to decide it, and only you edit this file.

#### The paragraph for `AGENTS.md`

> **Work records live in `docs/changes/<ticket>/`.** When I name a ticket, open or create its folder; read `README.md`, then `decisions.md`, then `plan.md`, before doing anything. Keep `status:` in `README.md` current as one word from the list; record every PR as a full URL under `prs:`. Decisions are mine: when a choice comes up that I have not made, add it to `decisions.md` as `[proposed]` with a recommended answer and stop to ask; never act on a `[proposed]` decision as if it were decided. Before acting on any decision, check whether a later entry supersedes it — a `[superseded by …]` entry is history, not an instruction. Product-wide decisions are in `docs/decisions.md`; read it at the start of every session and grep both files for the area you are about to touch. **Drift:** at session start, compare `status:` with the ticket's state in Linear and the PRs' state on GitHub; if they disagree, or if code contradicts a `[decided]` entry, say so and ask before proceeding — never fix either side silently. Append a dated line to `## Next` when you stop.

#### What the harness already provides

- `CLAUDE.md` / `AGENTS.md`: read natively by Claude Code, Codex, Copilot and Cursor; the paragraph above is the whole integration, on every harness, with nothing to install.
- `.claude/rules/*.md` with `paths:` frontmatter: scope "read `docs/changes/*/decisions.md` mentioning billing" to edits under `src/billing/**` — a free `touches` edge.
- Plan mode with `plansDirectory: docs/changes` puts the approved plan in the folder instead of `~/.claude/plans/<random>`.
- Auto memory (`project` type) keeps what the agent learned that is not a decision; it stays machine-local, which is fine for one machine.
- `/doctor prompt-audit` already flags stale or contradictory instruction files; import `docs/decisions.md` from `CLAUDE.md` and it is covered.
- The Linear MCP server and `gh` give the agent the observed state for the drift sentence.
- `git blame` is provenance; `git log --format=%b | grep Claude-Session` is the session trailer if you want one (one line in the paragraph: "sign commits with a `Session:` trailer").

#### The optional 20 lines

If you want a check: a pre-commit hook that (1) `status:` is one of six words, (2) every `prs:` entry matches `/pull/\d+`, (3) every `[superseded by X]` has a heading `X` later in the file. That is the entire validator. Do not write it until a mistake has cost you something.

#### Deliberately absent

Ids other than the folder name. A tool. An index. A session record type in the repo. A product tree. Owners. Any field a second person would need. When one of those is missed, write it down with the date; that list is the specification for whatever comes next, and it will be short.

---

That is the alternative. It is adoptable in an afternoon, it runs on every harness, and the second-user-on-a-different-stack test in Phase 1 step 4 is *easier* with it than with a CLI, because `AGENTS.md` is already the cross-harness contract and a CLI is one more thing each harness has to be taught to call.

## Claim-by-claim comparison

"Felt" means: one developer, eight weeks, real tickets, would notice the difference without being told to look for it.

| Schema claim | What the folder does instead | Felt in 8 weeks? |
|---|---|---|
| Decision as a typed record with `status` (`proposed`/`decided`/`superseded`/`reverted`) | A heading in `decisions.md` with the status word in brackets; the agent is told what each word means | **No.** The word in brackets carries the same bit. The founder's own seven records are all `decided`, written in one sitting, after the fact — the status machine has had no transitions to validate. |
| `supersedes` as an edge, validated (a superseded decision is pointed at by a newer one) | `Supersedes:` line on the newer entry, `[superseded by …]` on the older | **No.** Zero uses in the store; the one real revision (decision 25) is a prose note in both `DECISIONS.md` and the typed record. With 20–40 decisions in eight weeks, the agent reads the file and the words do the work. The validator catches an inconsistent *mark*; it cannot catch a *missing* one, which is the only way supersession actually fails (Davidson). |
| `decided_by`, `decided_on` required when `decided` | The date in the heading; the author is `git blame` | **No.** One person; every `decided_by` is `person:vinh`. |
| `binds`: a change *is* a ticket; one change per source; validated | The folder is named after the ticket; a directory exists once | **No.** Uniqueness holds by construction. All five `binds` in the store are empty. |
| Sources as records created on first mention; `links` as typed edges to them | URLs in frontmatter (`url:`, `prs:`) and in prose; the URL's shape says what it is | **No.** The store's five sources are three repo files, one directory and one git repo — each a 13-line record wrapping a filename. The session board already greps PR URLs out of `summary.md` and has done so daily; the one bite ("must be a full URL") is a template rule, not a schema. |
| `touches` / features / `parents` / `affects` / `product.md` ("present, optional") | `touches: [free, words]` and grep; no tree | **No.** Phase 1 declares no feature. The store has a `product.md` with one field. The report itself says a solo developer "has no alignment pain", and the tree exists for alignment. |
| Authored vs derived marked in the schema; a derived field hand-edited is drift | Authored files in `docs/`; derived session records in a different directory with a different writer | **No.** This is Phase 0's "one writer per layer", already achieved by *location*. The schema's A/D marks matter when both kinds live in one record — which the v2 envelope causes (`created`, `updated`, `session` are D on files a person writes), and which the folder avoids. |
| Observed edges appended to an append-only session record with provenance, "merging without arbitration" | The session-orient mod already writes per-session `links:` into the session record | **No.** Arbitration is needed when two writers disagree. There is one. The session board's "two sessions on one ticket both claim it" is a display problem the schema does not resolve either (it records both claims). |
| Drift: bound source's `observed.status` vs change `status`, reported by the index | The drift sentence in `AGENTS.md`, evaluated by the agent against Linear and GitHub at session start | **Maybe.** This is the one claim with a real failure mode — a stale `status` makes a wrong board, as `CLAUDE-snippet.md` admits. But the folder's version is *stronger* in Phase 1: it also covers code-vs-decision drift (the Davidson case), which the schema's drift object does not touch. The schema's drift needs a sync adapter that does not exist yet. |
| Provenance on every record: `writer`, `session`; actors as records; `Pjman-Session` trailer | `git blame`; a commit trailer if wanted | **No.** `SCHEMA.md` concedes it: "In Phase 1 git provides the rest for free." Two actor records exist to give `person:vinh` and `agent:claude-code` something to resolve to. |
| UUID v7 ids; references by id; CLI resolves prefixes; "humans never type a UUID" | The folder name is the id; references are relative links; renames are `git mv` plus a link fix the agent performs | **No — and it is a cost.** 57 UUIDs in 22 files, hand-generated during bootstrap, is the cost of ids that solve concurrent creation and cross-store moves. Neither happens with one writer and one store. The founder has already paid: `links: [01a127d2-7897-76b9-…]` on a change tells a reader nothing; `links: [THESIS.md]` would. |
| An embedded index (SQLite/graph), rebuilt from files, the only thing queries hit, emitting JSON | `grep -rl` and the agent's own file tools; `cat docs/changes/*/decisions.md` | **No.** Forty decisions at ~150 tokens each is 6k tokens; the agent reads them all faster than it can learn a query language. An index pays off at multi-hop queries over a tree nobody has declared. |
| Validation: the CLI is the schema; the library is the only writer; invalid records reported as drift | Nothing, or the 20-line hook once a mistake has cost something | **Maybe.** The only thing prose cannot do is refuse a write. In eight weeks the refusals that would have fired: "status is not one word" (the board's known bite). A one-regex hook. |
| The extension rule (`ext:` preserved, never validated) | Markdown has no fixed keys; everything is an extension | **No.** `ext:` exists so that *other* adapters do not collide with core fields. There are no other adapters. |
| Storage independence; location resolution (repo `.pjman/`, user-space stores, `config.yaml`) | The folder is in the repo; the session board keeps the global folder for cross-repo tickets | **No.** One store, one place. The resolution rules are Phase 2 (the hosted database) leaking into Phase 1 as design constraints. |
| Status vocabulary as data, mapped in `pjman.yaml` | The six words in the paragraph; the lane table in `record.ts` already maps them | **No.** `vocabulary:` in the store maps the founder's *own* words (`implementing: active`) to canonical ones nobody else reads. |
| `owner` on every change "from day one, defaulting to the single user" | Absent | **No.** All five changes: `owner: person:vinh`. The field exists so a Phase 3 feature has no migration — the thesis says so. |
| Session as a record type with `parent` (fan-out as a tree) | The mod's session record; subagents are not recorded | **No.** The bootstrap session was hand-written in violation of the schema's own rule and marked `ext.bootstrap: true`. The first session record exists to be the `session:` target on 21 other records. |

Eighteen claims. Zero *yes*. Two *maybe*, both of which the folder covers with a sentence and a regex.

## Phase 2 value being paid for in Phase 1

Each of these is in v2 because of a second writer, a second tool, or a second store. None is needed by the only person who will use Phase 1, and each has a cost that is being paid now: in bootstrap effort, in lines no human reads, and in the founder's attention.

1. **UUID identity and id-only references.** Needed when two machines create records concurrently or when a record moves between stores. Cost: 57 opaque strings; a CLI whose first job is to resolve them back to names; a "humans never type a UUID" rule that exists to apologise for them.
2. **The envelope (`writer`, `session`, `created`, `updated`) on every record.** Needed by an audit log with more than one actor. Cost: 129 of 296 lines; a session record that had to be hand-forged so the field had a target.
3. **Actor records and `person:`/`agent:` refs.** Needed when an owner, decider or writer can be someone other than the author. Cost: two records, one exception to the id rule, a rename (`principal → actor`) that touched seven files and cost a commit.
4. **Observed edges on append-only session records "merging without arbitration".** Merging is a multi-writer problem. Cost: the schema's hardest concept, specified before a second writer exists to test it.
5. **The index as "the only thing queries hit" and the library as "the only writer".** A single front door matters when several tools read and write. Cost: weeks 2–4 of the gate, building the library and CLI before any adapter other than the founder's own needs them.
6. **Storage independence, location resolution, `pjman.yaml`.** For the hosted database and user-space stores. Cost: design constraints ("ids are stable; paths are not", "nothing structural in prose") that forbid the cheap folder conventions Phase 0 proved.
7. **`ext:`.** For adapters the founder does not write. Cost: a rule to define and preserve.
8. **Layer 3 (product, feature, parents, affects, touches) "present, optional".** For alignment, which a solo developer does not have. Cost: one more record type, three edge types, cycle validation, a `product.md`.
9. **`owner` from day one.** For signatures. Cost: a field that is always the same value.
10. **The status vocabulary as configurable data.** For "an organisation's words". Cost: a map in `pjman.yaml` from the founder's words to canonical words only the founder reads.

The report warned about exactly this: "against letting 'the schema is independent of storage' pull the schema toward hosted-graph generality before a second person has written a decision into it", and the Logseq pattern — attention moving to the schema-as-spec instead of the record-in-use. The git log is the measurement: eight commits since 2026-10-09, all on `SCHEMA.md`, `THESIS.md`, `DECISIONS.md` and the store's shape; the five change records in the store are the five steps of building pjman; no decision in the store was made on a work ticket.

## What the folder genuinely cannot do

Honestly, within eight weeks, for one developer:

1. **Refuse a write.** Prose cannot reject `status: in review` or a `decided` decision without a date at the moment it is written; it can only be caught later. This is real and it is the *entire* residual. It is also delivered by a 20-line pre-commit hook, and in Phase 0 the only instance of it biting is the `status`-is-one-word rule, which the paragraph states and the agent follows.
2. **Give an adapter author a parsed record for free.** The session-orient mod hand-parses frontmatter in `record.ts` and greps `summary.md` for `/pull/\d+`. A library would replace those ~40 lines with a call. The beneficiary is the person writing views against the records — the founder, during Phase 1 step 3 — and the same benefit comes from `gray-matter` plus the `prs:` key in the README template above, with no schema.
3. **Answer a multi-hop question without reading everything.** "Every decision under any feature affected by what this change touches" needs an index over a tree. Nobody in Phase 1 has a tree, and the question is a Phase 3 question (derived approvers).

Everything else the schema claims — supersession, binds, provenance, drift, authored/observed — the folder does with a word, a filename, `git blame`, a sentence to the agent, or a directory boundary, and does today. What the folder *and* the schema both cannot do is the thing that actually matters: notice a decision that nobody marked superseded. That is a drift check between a decision's text and the code, and it is in neither Phase 1 design. The schema does not beat the folder on the Davidson case because it does not address the Davidson case.

## The kill criterion

Run the folder convention above, not the schema, for eight weeks of real tickets, starting now — it is Phase 0 plus two additions and costs an afternoon. Keep one file, `docs/null-hypothesis.md`, with a dated line for every event of the following kinds:

- **E1 — superseded decision honoured:** an agent acted on a decision a later entry had superseded, and the status word in the heading did not stop it.
- **E2 — decision not found:** the founder knew a relevant decision existed and the agent, following the paragraph (read the folder, grep both decisions files), did not find it.
- **E3 — write that should have been refused:** a record was written in a shape that cost a wrong board, a wrong lane or a wrong session action, and that a validator would have rejected on write.
- **E4 — proposed before work:** a decision was written `[proposed]` *before* the work it governs and decided through the file. Count these separately; they are the schema's reason to exist.

Pass condition for the schema (build it): over at least 40 sessions on at least 10 tickets by 2026-12-06, E1 + E2 + E3 is three or more *and* E4 is at least five. That would show the folder failing at a rate that matters and the founder actually deciding through the record rather than after it.

Kill condition (the folder was enough): E1 + E2 + E3 is at most two, *or* E4 is zero. The first says the folder did not fail; the second says no status machine was exercised and no schema would have been either — the 63 % after-the-fact pattern, which the founder's own store already exhibits seven times out of seven.

If the kill condition holds, the correct action is not to abandon the idea but to move the schema to where its machinery has a job: Phase 2, when the second person exists, with `docs/null-hypothesis.md` as the list of what the folder actually lacked. Until then, the schema, library, CLI and index are a specification of what a second writer would need, written by the first writer, and the research report's gate — "the folder would have done" — is met on the current evidence.
