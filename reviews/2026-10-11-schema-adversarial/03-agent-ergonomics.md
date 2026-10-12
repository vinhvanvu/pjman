# 03 · Agent ergonomics — can an agent read and write this, and is it worth the tokens?

*Adversarial review of SCHEMA.md draft v2 and the 22 records under `.pjman/`, against the session board contract (`DESIGN.md`, `SKILL.md`, `_template.md`, `record.ts`, `register.tsx`) that has run daily for months. Token counts are cl100k (o200k differs by <1%). Harness capabilities are as of 2026-10-11 from memory; uncertainty is marked.*

## Verdict

As specified, v2 is not something an agent can read or write reliably without the CLI that does not exist yet, and the schema does not define the one surface an agent needs: how to orient. The store the founder wrote by hand to walk the schema through is the evidence. 4 of 22 records (18%) are invalid YAML today, all for the same reason (an unquoted `title:` containing `: `), written by the two most careful authors the store will ever have; under the stated validation rule ("every referenced id exists") one of those four failures cascades and invalidates three otherwise-correct records, for 7 of 22 (32%) invalid on the first strict index build. 70% of the store's tokens are frontmatter and 26% are UUIDs that carry no information an agent can act on; a reference list of six sources costs 170 tokens as ids versus 55 as keys. There is no index, brief, summary or "what is active" output in the schema, so at 200 changes / 2,000 sources / 500 sessions (≈1.1M tokens) the only orientation path is one the agent cannot take. The session record's one-writer adapter design is portable to perhaps three harnesses in a degraded form and to none at parity; `ext:` has no ownership rule so the three adapters in Phase 1 step 3 will collide on `next` on day one. Against the session board, v2 trades two deterministic file reads for a resolver, trades a one-line decision for a 280-token record, and moves high-churn session files into the product repository. The schema can be fixed before code; what must change is listed at the end, and most of it is subtraction.

## Token and orientation cost

### The store as written (22 records, 13,157 bytes)

| | Tokens | Share |
|---|---|---|
| Whole store | 4,830 | |
| Frontmatter | 3,383 | 70% |
| Bodies (the content) | 1,406 | 29% |
| The 57 UUID occurrences | 1,254 | 26% |
| Envelope alone (`id`, `type`, `writer`, `session`, `created`, `updated`) | 104 per record · 22 = 2,288 | 47% |

Unit costs: one UUID = 22 tokens; one `ABC-1234` = 6; one slug like `schema` = 1; one timestamp with offset = 16 (two per record = 32); one `observed` edge line (two UUIDs plus a timestamp) = 77. A `links:` list of six references costs 170 tokens as UUIDs and 55 as keys (`ABC-1234`, `org/repo#123`, a PR URL, `THESIS.md`, …) — 3.1×, and the key form is the only one of the two an agent can act on without a lookup.

Averages per type in this store, with bodies as thin as the walk-through wrote them: change 225, source 137, decision 280, session 423 (with 2 observed edges), actor 120.

### Extrapolated

| Store size | Minimal bodies (as now) | Frontmatter only |
|---|---|---|
| 200 changes | 45,000 | 33,000 |
| 2,000 sources | 274,000 | 244,000 |
| 500 sessions (15 observed edges + a 150-token log each) | ≈800,000 | ≈725,000 |
| **Total** | **≈1.1M** | **≈1.0M** |

With realistic change bodies (a Summary, a plan, notes: 800 tokens) the change line becomes 160,000. Sessions dominate either way because every observed edge is two UUIDs. No context window reads this; no agent should. That is fine only if the schema specifies what the agent reads instead, and it does not. `SCHEMA.md` names the index as "the only thing queries hit" and the thesis names the MCP as the surface, but no query, no response shape, no "brief", no "status", and no orientation document exists in the contract. The session board's contract is the opposite: `DESIGN.md` and `SKILL.md` are mostly about what gets read, when (`Resuming work on a Linear ticket → read summary.md first, then plan.md if one exists`).

### Orienting on one change, today, by reading files

To pick up the `schema` change an agent must read `changes/schema/change.md` (333 tokens), then resolve four opaque `links` ids to four source files (543 tokens, four reads — and it can only find them by grepping the store for the UUID, since the file path is a slug of a key the change does not state), then the change's decision (376), then grep `sessions/` for the change's UUID to find the one session that observed it (423). Total 1,675 tokens over 7 reads and 2 greps, of which 446 tokens are human-written content: 73% overhead. The session board: `~/.claude/issues/ABC-1234/summary.md` and `plan.md`, two reads at a path computed from the ticket key, zero resolution hops, ~1–3k tokens of pure content for a mature ticket. The template alone is 220 tokens.

### Instruction cost

An agent that writes records correctly must know the contract. `SCHEMA.md` is 3,713 tokens; the board's `SKILL.md` is 856. The board's skill is also mostly procedure ("Creating a PR → add it to the PRs section, set `status: review`"); `SCHEMA.md` has no procedure at all. A Phase 1 skill will have to carry both, so the per-session instruction load is ≥4× the board's before the first record is read.

## Write-path failure modes

Numbered, each with what the LLM does, what the parser does, and whether the stated validator ("frontmatter parses; required fields present; enums in range; ids well-formed; every referenced id or handle exists") catches it before the index drops the record.

1. **Colon-space in an unquoted scalar.** The dominant real failure: `title: Identity: UUID v7 ids`, `title: … lives in ext: or the body`, `title: Research report: is pjman worth building`, `title: The vocabulary is four nouns: product, …`. Four of 22 records. PyYAML: `ScannerError: mapping values are not allowed here`. Caught (parse fails) — but the record is then absent from the index, and every record pointing at it (`01a127d2-…-c956cffd0735`, the research-report source, is referenced from `changes/schema/change.md`, the records-truth decision and the session) fails "every referenced id exists". One typo, four invalid records. The board's regex reader (`frontmatter(md, 'title')` in `layout.ts`) reads all four fine, which is why the founder never hit this before.
2. **Hand-minted UUIDs.** The store proves the LLM path: 21 of 22 ids share the same 48-bit v7 timestamp (`01a127d2-7897` = 2026-10-10 21:57:47.287 UTC) because they were generated in one batch and pasted. Consequences: the shortest unique prefix is 16 or 17 characters for 21 of 22 ids (the schema promises "a unique prefix" as the human form); a model asked to add a new record will pattern-match the existing prefix and invent `01a127d2-7897-7xxx-…`, which is well-formed and passes "ids well-formed". A duplicate id is not in the validation list at all. Not caught unless the validator adds a uniqueness check; silently wrong otherwise. The same will happen in production whenever a sync adapter mints 2,000 source ids in one second.
3. **Referencing a record that has no id yet.** The LLM creates `sources/github-pr/org-repo-123.md` by hand (the "created on first mention" rule invites exactly this) without an `id`, then needs its id for `links` on the change. It cannot have one. Either it invents one (mode 2) or it writes the key. The schema does not say what the index does with an id-less record. Caught as "required field missing"; the record and the link are both dropped.
4. **Typed scalars changing type.** `decided_on: 2026-10-10` → a date object; `created: 2026-10-10T18:00:00-07:00` → a datetime; `key: 1234` → int; `key: 1.10` → float `1.1`; `status: no` → `false`; `ext: {country: NO}` → `false`; `ext: {pin: 0123}` → `83`. None of these fail to parse. The `(kind, key)` uniqueness rule compares `1234` and `"1234"` as different keys. A JS adapter using js-yaml turns `2026-10-10` into a UTC-midnight `Date`, which renders as `2026-10-09` in the founder's timezone: `decided_on` off by one day, silently. Not caught; the validator validates the parsed value, which is the wrong type.
5. **Round-trip reformatting.** `safe_dump(safe_load(record))` rewrites `2026-10-10T18:00:00-07:00` as `2026-10-10 18:00:00-07:00`, re-indents lists, drops comments and quotes. The schema promises `ext:` "preserved byte-for-byte"; no mainstream YAML library does this without a CST-preserving mode (ruamel, the `yaml` npm Document API), and the schema does not require one. Result: every CLI write touches every line, `git blame` (the Phase 1 provenance mechanism) attributes the whole file to the last CLI run, and two adapters formatting differently produce diff churn and merge conflicts on `ext`. Not a validation matter; a design hole.
6. **Leading characters YAML owns.** `title: [WIP] schema lock` → list; `title: *draft* schema` → alias error; `title: @vinh to review` → error; `title: \`ext:\` rule` → error. Caught (three of four fail to parse; `[WIP]` parses as a list and fails the type check if the validator checks types — the schema does not say it does).
7. **List written as a scalar.** `links: 01a1…ddd0` or `links: 01a1…, 01a1…` → a string; `links:` → `null`. Common when a model edits one line. Only caught if the validator type-checks lists; "ids well-formed" on a string containing two ids is undefined. The second form is the one a model produces when it "adds a link" by appending to an existing line.
8. **Lists of flow maps on `observed`.** `- {edge: links, from: …, to: …, at: …}`: a stray comma in any value ends the map early; a `: ` inside a value is an error; a tab is an error. The one record in this shape is adapter-written, so this matters only when the "a session is never hand-edited" rule is broken — which it is, in the only session record that exists (`ext.bootstrap: true`).
9. **Duplicate keys.** `status: open` … `status: active` after a model edits by appending → PyYAML keeps the last silently; js-yaml throws by default. Behaviour depends on the implementation language; the schema does not say.
10. **Comments after values.** The board's contract explicitly allows `status: review  # comment`, and `_template.md` ships one (`status: planning  # planning | implementing | …`). YAML allows it; a CLI round-trip (mode 5) deletes it. The founder's own template will lose its hint line on the first `pjman` write.
11. **Derived fields on the hand-edit path.** `id`, `type`, `writer`, `session`, `created`, `updated` are all marked D, "written only by the tool that derives it". A human in an editor or a model in Cursor creating a change by hand must write all six, which the schema says is drift. The walk-through did exactly this for all 22 records. Either every create goes through the CLI (then "hand edits tolerated" is false for creates) or the rule needs a "minted on first index" clause. The schema has neither.
12. **The vocabulary ambiguity.** `pjman.yaml` maps `implementing: active`. Does the file hold `implementing` or `active`? "Views read the canonical set" and "`status` in the vocabulary" allow both readings. Two agents (one with the Claude Code skill, one with a Cursor rule) will write different words for the same state; the index may accept both; the sidebar's lane derivation gets two spellings.
13. **Date drift between filename and field.** `decisions/2026-10-09-four-nouns.md` carries `decided_on: 2026-10-10`. Three of the seven decision records disagree with their own filename. Not validated (the filename is "data", renameable), so a human browsing the folder is told the wrong date and nothing flags it.
14. **Field-name collision across types.** `observed` is a map on a source and a list of edges on a session. A validator keyed by field name, an index column, or a model that has seen one shape will mis-write the other.
15. **The harness session id is not the record id.** Claude Code's session id is a v4 UUID; the schema's `id` is v7 minted by pjman. The board names the file by the harness id (`recordFileName(started, id)`); v2 names it by the pjman id. `claude --resume <id>` and `sessions/<date>-<id8>.md` no longer share an id8. The harness id goes to `ext`, un-namespaced (mode 1 of the next section).

Every mode above except 1, 6 and 8 passes the validator as written, or depends on behaviour the schema leaves to the implementation. The board avoided the whole class by using one `key: <JSON>` per line — a format a regex and `JSON.parse` read unambiguously — and by letting `summary.md` carry free prose for PRs and decisions and reading them with a grep.

## Adapter portability

What the session board's adapter actually uses (`register.tsx`): `session.start`, `prompt.submit`, `tool.call`, `turn.complete` events; `$.session.messages()` (the full transcript, including assistant text and tool inputs); `$.session.id()`, `.cwd()`, `.usage()` (for `startedAt`, the epoch that detects `/clear`), `.model()`, `.turns()`; `$.model.complete({model: 'haiku'})` twice per turn; `$.fs`, `$.process.run`, `$.clock`, `$.store`; `e.agentId` to ignore subagent turns. The schema's session record needs, at minimum: a stable session id; a turn-complete event; the turn's prompt text and tool calls (to derive `observed` edges — "the user pasted a Slack link while on ABC-1234" is a regex over the prompt); write access to the store; `parent` for a fan-out; and, for the log and `next` that the board's pane lives on, a side-model call.

| Harness (Oct 2026) | Session id | Turn-complete hook | Prompt text | Tool calls | Assistant text / transcript | Side model | `parent` | Confidence |
|---|---|---|---|---|---|---|---|---|
| Claude Code, mods API (what the board uses) | yes | yes | yes | yes | yes (`$.session.messages()`) | yes (`$.model.complete`) | yes (`agentId`) | high — but the README says mods are "behind a rollout switch"; the board already runs on a gated surface |
| Claude Code, shell hooks | yes (`session_id`) | yes (`Stop`, `SubagentStop`, `SessionEnd`) | yes (`UserPromptSubmit`) | yes (`PreToolUse`/`PostToolUse`) | yes, by reading `transcript_path` JSONL | no in-process; `claude -p --model haiku` as a subprocess works | yes (`SubagentStop`, `agent_id`) | high |
| Cursor (`hooks.json`) | `conversation_id` | `stop` | `beforeSubmitPrompt` | `before/afterShellExecution`, `before/afterMCPExecution`, `afterFileEdit` | no transcript, no assistant text | no; bring an API key | no | medium — event list grew through 2026 (`sessionStart`/`sessionEnd` appeared later); exact payloads uncertain |
| Codex CLI | yes | `notify` on `agent-turn-complete` (with `input-messages`, `last-assistant-message`) | yes, via notify | not per call; rollout JSONL under `~/.codex/sessions/` readable after the fact | partial (last message) or the rollout file | no; API key | no | medium on notify; low on whether a fuller hooks system shipped by October |
| GitHub Copilot (coding agent, CLI) | yes | `sessionEnd`, `postToolUse` | `userPromptSubmitted` | `preToolUse`/`postToolUse` | no | no | no | medium |
| Gemini CLI | yes | `AfterAgent`, `SessionEnd` | `BeforeAgent` | `BeforeTool`/`AfterTool` | `AfterModel` exposes model output | no | no | medium |
| OpenCode | yes | plugin events (`session.*`, `tool.execute.*`) | yes | yes | yes (plugin has the session) | yes (plugin can call the configured provider) | uncertain | medium-low |
| Cline / Roo | task id | `TaskComplete`-style hooks | `UserPromptSubmit` | `Pre/PostToolUse` | no | no | no | low-medium |
| Hosted web agents (claude.ai, ChatGPT, Devin) | no hooks | — | — | — | — | — | — | high: MCP only; the session record cannot be derived at all |

Reading of the table:

- **Observed edges are portable; the log is not.** Every CLI harness with hooks exposes the prompt and the tool calls, so a code-only derivation (ticket regex on the prompt, PR URL from a `gh pr create` output, files edited) works everywhere. The two-Haiku-call log, `goal` and `next` — the things the pane shows and the founder reads — require either an in-harness model call (Claude Code mods, maybe OpenCode) or the adapter carrying its own API key and billing. The thesis's "derivation is code where it can be and the model only where it must be" is already the right line; the schema should say which session fields are code-derived (portable, required) and which are model-derived (optional, `ext`).
- **`parent` is Claude Code-only.** No other harness I know of exposes a spawned-agent identity to hooks. The field will be empty on every other adapter; "a fan-out is a tree" is a Claude Code feature wearing a schema field.
- **The epoch trick does not port.** The board detects `/clear` by `usage().startedAt` changing. Other harnesses start a new conversation id instead; the adapter must treat "new id" as "new session", which is fine, but the board's "the log and links survive restarts and compaction" promise depends on reading the record back, which depends on a stable id across resume. Cursor's `conversation_id` is stable; Codex's rollout id is stable; Claude Code's shell-hook `session_id` is stable across `--resume`. OK with care.
- **The write must be a CLI call from a subprocess hook with a timeout** (Claude Code shell hooks default to 60 s; Cursor hooks are expected to return quickly). A hook that shells out to `pjman session observe …` is portable. A hook that re-derives the whole record from a transcript each turn, as `commit()` does, is not — it needs the transcript, and only Claude Code hands it over.
- The founder's own research note (`memory_context_tools.md`, line 205) already concludes that "lifecycle hooks + MCP + skills" is the cross-harness surface in practice. The schema's session record assumes more than that surface provides. The minimum contract should be stated: session id, turn-complete, prompt, tool calls, file write. Anything above it is an `ext` of a named adapter.

## `ext:` collision analysis

The rule: any undefined key goes under `ext:`, is "preserved byte-for-byte, ignored by validation, readable through the index", and adapters "keep their fields there (`ext.next`, `ext.branch`, `ext.cmux_workspace`, `ext.model`)". No namespace below `ext`, no ownership, no shape.

Phase 1 step 3 ships three adapters: the pane/mod (writes the session record), a status line (reads a one-liner per change for the shell prompt — `SKILL.md` already has `oneliner`, "generated from summary.md by the statusline; never hand-write it"), and the MCP server (the agent's read/write surface). Predicted first week:

1. **`ext.next`, three writers, two meanings, two scopes.** The mod writes `next` from Haiku at turn end — on the session (that is where the board keeps it). The status line is per shell and per change, not per session; it wants `next` on the change, finds none, and writes `ext.next` on the change by copying the latest session's. The MCP server exposes a `set_next` tool so the agent can state its own next step; it writes `ext.next` on the change as the agent said it. Now `ext.next` on a change is a string written by two adapters with different meanings (the developer's next step vs the agent's), last writer wins, and the envelope's `writer`/`session` cannot say which, because they describe the record's creator, not the field's. Nobody owns `ext.next`. The schema's answer, "sessions have one writer", covers one of the three places it lives.
2. **Same key, different shape.** One adapter writes `ext.next: "lock v2"`, another `ext.next: {text: …, at: …, by: …}` because it wants provenance the envelope does not give it. Validation ignores `ext`, so the index serves both shapes and every reader special-cases it.
3. **Same key, different scope already in the store.** `ext.model` is on the actor (`claude-code.md`: the harness's default model) and on the session (the model of that run). `ext.harness` likewise. The schema's own examples set the precedent of un-namespaced keys, so a third adapter will follow it.
4. **Byte preservation is not achievable with two writers.** The mod edits the record through the library (re-serialises, see failure mode 5); the status line, being a shell script, edits with `sed`; the MCP server uses a different YAML library. Three serialisations of the same `ext` block, each a full-file diff, each a potential merge conflict in a repo-resident store.
5. **`ext.lane`.** The board derives lane in code from status, PRs and `plan.md`, and the sidebar sorts by it. v2 prunes `next` and `lane` as content. Three adapters need lane and next; two of them will compute it differently (the sidebar via cmux description, the status line via its own derivation). When three adapters need the same field, it is structure, not content; the pruning rule has over-fired on exactly the two fields the daily tool is built on.

What is missing is one line: `ext.<adapter>.<field>`, adapter ids declared in `pjman.yaml adapters:` (currently `[]`), one writer per subtree, and a promotion rule (a field two adapters need moves to the schema). And "byte-for-byte" must be replaced with a promise a library can keep: keys and values preserved, order preserved, comments not.

## Readability check of a real record

`.pjman/changes/schema/change.md`, read as a human would, in an editor or a PR diff:

```
id: 01a127d2-7897-731b-a4f0-670b9078ddd0
type: change
writer: person:vinh
session: 01a127d2-7897-7590-bf0f-b16c7d82fc78
created: 2026-10-10T18:00:00-07:00
updated: 2026-10-10T18:00:00-07:00
title: The schema — the record contract as a spec
status: active
owner: person:vinh
binds: []
links:
  - 01a127d2-7897-76b9-a84f-817c3d0667d9
  - 01a127d2-7897-7374-972d-c956cffd0735
  - 01a127d2-7897-7129-a403-ca886307e862
  - 01a127d2-7897-780b-a235-13f2b0df024e
```

Seventeen frontmatter lines, 232 tokens; a three-section body of 99 tokens. What a reader learns from the frontmatter: the title, that it is active, that vinh owns it, and that it is linked to four things they cannot name. The four things are THESIS.md, the research report, LAYERS.md and the session board — the whole context of the change — and the record withholds all of them. In a PR, a link addition is `+  - 01a127d2-7897-7129-a403-ca886307e862`: a reviewer cannot approve or reject it without a tool. The board's equivalent is `linear_url:`, `branch:`, and a `## PRs` list of URLs that the reader and the mod both understand.

The envelope-to-content ratio is 2.3:1 in tokens. `session:` and `writer:` repeat identical values on all 21 records written in the walk-through (`person:vinh`, `…b16c7d82fc78`), which is 42 lines of provenance that say the same thing. The "humans never type a UUID" promise holds at the CLI prompt and fails everywhere else humans meet the file: reading, diffing, reviewing, grepping — and in the walk-through itself, where 57 UUIDs were typed into 22 files by hand. The schema has already admitted the readability argument for one case: actors are referenced by `person:vinh` "so `writer: person:vinh` is readable in every file". The argument is identical for sources, whose `(kind, key)` is unique by rule and whose key is the thing a human and a model both know. Nothing in the id-only rule's justification (renames, moves) applies to sources, since the key is the external identity and renaming it is a new source.

Smaller readability defects in the same store: three decision filenames dated a day earlier than their `decided_on`; a session `started` five days before it was `created`; `binds: []` present on five changes and absent on one; three source records whose body is the title repeated (`Layers catalog` / `Layers catalog`).

Verdict: not a human-readable document. Readable with the CLI, which is the opposite of the "frontmatter for machines and prose for people" line in the thesis — here the frontmatter is for the machine and the people get three lines of prose.

## Regressions versus the session board

What the daily workflow loses, as specified:

1. **Orientation.** Two reads at a deterministic path → N reads plus a resolver (or an index query that is not specified). See the 1,675-token / 7-read walk above.
2. **Creating a ticket folder.** Board: copy `_template.md`, fill five fields. v2: a change record, a source record for the ticket, a `binds` UUID, three minted ids. The skill's one-step "Starting a Linear ticket → create the folder" becomes a CLI call the skill must know, under a Bash permission rule instead of the board's `Edit(~/.claude/issues/**)` allow-list.
3. **Recording a PR.** Board: paste the URL into `## PRs`; the mod greps it. v2: a source record + a UUID in `links`; a URL in prose is invisible ("nothing structural lives in prose"). The most frequent write in the workflow is now the most expensive.
4. **Decisions.** Board: one line, ~20 tokens, newest first, in the file already open. v2: a file, an envelope, seven fields, two required sections, ≈280 tokens, a `decided_by` and `decided_on`. The skill's instruction to extract "algorithm picks, parameter values, signature changes, scope calls" will not survive a 10× ceremony; small decisions will go back into prose, where the index cannot see them. Expect decision capture to fall, not rise.
5. **Format fragility.** `key: <JSON>` per line (unambiguous, regex-readable, what the mod parses with `JSON.parse`) and comment-tolerant `status:` → full YAML with block lists, flow maps and typed scalars. 18% of the first store is already unparseable.
6. **Location.** The board keeps records in `~/.claude/`, out of every repository and across repositories (`repos: []` on a ticket). v2 resolves `.pjman/` in the repository first. Session records — one per run, rewritten every turn, 500 of them at the extrapolated size — land in the product repository's diffs, PRs and merge conflicts unless the README says to gitignore them, which the schema does not say. The "Pjman-Session" commit trailer is a nice idea that commits the session file into the product history by construction.
7. **The session id.** Board files are named by the harness session id, the one `claude --resume` takes. v2 names them by a pjman-minted v7 id; the harness id moves to an un-namespaced `ext` key.
8. **`plan.md` as a signal.** Board: existence of `plan.md` puts a ticket in `planning` without touching status. v2 has no equivalent; planning must be set explicitly. Minor, arguably correct, but a behaviour the founder relies on.
9. **The worktree symlink**, "ground truth for the branch and base", has no home; `ext.branch` is suggested as text, which the skill explicitly forbade ("never record the worktree path as text").
10. **`next` and `lane`**, the two fields the pane and sidebar are built on, are no longer in the contract; see the `ext` section.

What it makes easier, honestly:

- A validator exists at all. The board's contract is enforced by a CLAUDE.md paragraph and a read-back; `DESIGN.md` lists two "details that bite" that a validator would catch.
- Ids survive a rename; the board's `{TICKET-ID}` folder cannot be renamed without orphaning the mod's grep.
- A source can be anything, not only a Linear ticket; the board's `TICKET_RE` and `LINEAR_WORKSPACE` are hard-coded in three places the README tells you to edit.
- Observed edges carry provenance; the board's `links` are a merged, un-attributed list that loses who found what.
- One session can touch several changes with a record of when; the board has `tickets: []` and "newest prompt wins", with "two sessions on one ticket both claim it; nothing arbitrates" listed under Not built.
- A status vocabulary as configuration beats the board's two inconsistent sets (`SKILL.md`'s five words vs `deriveLane`'s acceptance of `done` and `blocked` that the skill never writes).
- Decisions, once recorded, are queryable across changes, which the board cannot do at all.

Net for the founder's own day: slower and more fragile on every frequent action (orient, record a PR, note a decision, move status), better on the rare ones (rename, cross-reference, audit). The thesis's Phase 1 test is "the founder's daily work runs on the framework"; as specified, it runs worse.

## What must change before code

Ordered by how much code it would otherwise be wrong to write first.

1. **Specify the orientation surface as layer 0.** A `brief` per change (the change, its bound and linked sources by key and title, its decisions as one line each, the last N session log entries, `next`) with a token ceiling (≤2,000), and a store `status` (active changes, their next steps). This is what the MCP returns and what the skill reads at session start; it replaces `summary.md` + `plan.md`. Without it the schema specifies a database with no read path for its primary reader.
2. **Readable references.** Allow `kind:key` for sources everywhere a source id is accepted (`links: [file:THESIS.md, github-pr:org/repo#123]`), as already done for actors; the CLI normalises on write only if the id form is needed for the index — ideally never in the file. Keep UUIDs as the index's identity. Acceptance test: `changes/schema/change.md` is understandable in a PR diff without a tool.
3. **Define the YAML subset, and ship a formatter.** Strings always quoted on write; no flow maps in authored fields; `observed` as block maps; a `pjman fmt` that rewrites a record to canonical form; a validator that type-checks every field (lists are lists, keys are strings, dates are strings matching a pattern — never YAML's date type). Or adopt the board's `key: <JSON>` line format outright, which has months of evidence and no scanner. Acceptance test: the current 22 records all parse, or the validator names the four that do not with a fix.
4. **A creation rule for the hand-edit path.** A record without `id` is unminted; `pjman index` mints and writes back the envelope. Duplicate ids are a validation error. A parse failure in one record never invalidates another (dangling references become warnings, not errors, when the target file exists but failed to parse). This is the one rule that makes "hand edits tolerated" true for an LLM.
5. **Namespace `ext`.** `ext.<adapter>.<field>`, adapter ids from `pjman.yaml`, one writer per subtree; promote `next` and `lane` back into the contract (as D fields with a named deriver) since three Phase 1 adapters need them. Replace "byte-for-byte" with "keys, order and values preserved; comments not guaranteed", and pick one YAML library with a round-trip mode for every writer.
6. **State the minimum adapter contract for the session record**, and split the fields: code-derived and required (`agent`, `started`, `observed` from prompt and tool calls), model-derived and optional under `ext.<adapter>` (log, goal, next). Mark `parent` as "when the harness exposes it". Name the degraded modes per harness rather than letting each adapter discover them.
7. **Decide the status word in the file.** Canonical only; the vocabulary maps on ingest and display. One sentence.
8. **Keep sessions out of the product repository by default**, or make `sessions/` gitignored in the in-repo store with the user-space store as the default for sessions; decide this before the Claude Code adapter writes its first file into someone's PR.
9. **Rename one `observed`.** `source.observed` → `snapshot` or `remote`; `session.observed` stays.
10. **Reconcile the session id with the harness id**, or document `ext.<adapter>.session_id` and the filename rule; and fix the walk-through records that are already drifting (filename dates, the 21 ids sharing a timestamp, the four unparseable titles) so the first real validator run is not a 32% failure rate (4 unparseable, 3 more by cascade) on the reference store.
11. **A cheap decision form.** Either an inline `## Decisions` list in the change body that the index promotes to decision records on request, or an explicit acceptance that small decisions will not be recorded. The current contract pretends the second is not the outcome.
12. **Measure before locking.** Add two numbers to the walk-through: tokens to orient on one change via the brief, and tool calls to record a PR. The board's numbers are 2 reads and 1 edit. Lock v2 only when v2's are within 2× of those.
