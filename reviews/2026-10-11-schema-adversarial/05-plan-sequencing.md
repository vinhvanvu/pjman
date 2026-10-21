# 05 — Plan and sequencing

*Adversarial review, 2026-10-11. Lens: does "Phase 1 in order" reach the research report's test — "does a typed decision record, in git, read by an agent, beat a folder of markdown on the founder's own work" — by the cheapest route, and is the schema already carrying later phases? Sources: `THESIS.md`, `DECISIONS.md`, `SCHEMA.md` (v2 at 7c4b946), `.pjman/` (22 records), `reports/pjman worth building analysis.md`, `LAYERS.md`, and the Phase 0 code at `~/Downloads/claude-session-board`.*

## Verdict

The order is backwards relative to the test. "Schema → library/CLI (with an index) → re-derived adapters → second user → public" front-loads the two most expensive and least informative steps and defers the one cheap thing that answers the report's question. Three days in, the repository has eight commits and no code; the schema has had three versions, an ER diagram, a vocabulary rename and now a five-part adversarial review — the Logseq pattern the report named, in miniature. Schema v2 is "minimal" in the sense that it pruned what Phase 0 actually records (`next`, `goal`, PRs, plan, feedback — all to `ext:`) while keeping the Phase 2/3 skeleton (actor records, `owner` on three types, features with `parents`/`affects`/inheritance rules, session `parent` for agent fan-out, a hosted audit-log requirement, two storage locations with a config map). The store's own evidence is the strongest argument against the plan: all seven decision records were opened `decided` — the 63 %-after-the-fact pattern the report called the sharpest risk — and `binds`, the edge the report calls the join, has zero instances; the "walk-through on a real change" the schema says it needs has not happened. The fix is not more review: freeze v2 with its known defects, cut layer 3 and the Phase 3 reservations, build a ~300-line CLI and a hook in two to three weeks, run the test on pjman's own build, and port nothing until it passes.

## Fastest path to the test

The test needs four things and nothing else: a decision record with status and supersession (exists, layer 2), a way for an agent to find the decisions relevant to the change it is on *before* it acts (does not exist), a way for the human to open a decision as `proposed` and close it `decided` inside the session where it is made (does not exist), and a tally that distinguishes "read and honoured" from "the founder restated it in the prompt" (not designed). An index, actors, features, the pane, the sidebar, the Linear binding and the DECISIONS.md view are not on that list.

Assuming ~3 evenings a week of ~2.5 h:

| # | Step | Evenings | Notes |
|---|---|---|---|
| 0 | Freeze `SCHEMA.md` v2 as-is. One line at the top: "frozen until `pjman validate` runs against it; defects fixed only when the validator cannot implement them." Set `layers: [core, sources, work]` in `pjman.yaml`. No more diagram upkeep, renames or reviews. | 0.5 | The review series is itself the risk; this is the last review until code exists |
| 1 | `pjman`, one executable, four verbs: `new change\|decision`, `validate`, `ls <type> [--for <change>] [--status] --json`, `context <change>`. Loads every record into memory on each run; no database. The 22-record store is the test fixture. | 2–3 | `context` prints the change's Summary, its `decided` decisions with ids, and a warning for anything `superseded` that is still linked — the thing the agent reads |
| 2 | The adapter minimum: a `CLAUDE.md` block plus one hook (`UserPromptSubmit` or `SessionStart`) that runs `pjman context <key>` when a prompt names a change key, and a skill rule: "before a design choice, `pjman new decision --proposed`; set `decided` when the user confirms." Every `context` call appends a line to a log file. | 1–2 | The log file is the measurement; without it the test cannot be scored |
| 3 | Bridge, only if work tickets are in scope: `pjman export summary <change>` writes Phase 0's `summary.md` shape (title, status mapped back through `vocabulary:`, PR URLs) into `~/.claude/issues/{TICKET}/` so the existing pane and sidebar keep working untouched. | 1 | This is the first real view, and it removes the regression window entirely |
| 4 | Use it for three weeks on pjman's own build (the CLI's development sessions reading the schema decisions) and, if cleared, on work tickets. Weekly tally: decisions `proposed` before the act vs written after; `context` reads of a decision id the prompt did not mention; supersessions that changed a choice; a one-line "would the folder have done" judgement per instance. | 0 extra | Kill at week 6 if the tally is empty, per the report |

Total to first signal: **5–8 evenings, two to three weeks.** The current plan reaches the same point at week 5–7 (the report's rows 2–4), and only if the adapter re-derivation (below) does not stall. The report's "founder's daily work runs on the framework within about four weeks" is a means, not the end; with step 4 the decisions run through the framework while the views stay Phase 0, which is enough.

### The adapters step, sized

Phase 0 is 2,082 lines excluding the skill: `register.tsx` 548 (docked pane, cmux push, `gh` calls), `layout.ts` 325, `log.ts` 211 (two Haiku calls per turn), `links.ts` 128, `record.ts` 107, `orient.test.ts` 450, `agent-board.swift` 313 (a restricted, runtime-interpreted SwiftUI subset with documented quirks), plus the 57-line skill, the template and the CLAUDE snippet. The record-coupled part is small — four reads of `summary.md` at `register.tsx:208–270` and `layout.ts:59`, plus `record.ts` — but "re-derived, not ported" means the other ~1,500 lines (pane, cmux projection, pinned-workspace rules, title-prefix fallback, Haiku log, link rules, PR→ticket mapping, tests) are rewritten too. Honest parity estimate: **10–15 evenings, three to five weeks**, which is the entire budget the report gave to "library + CLI + port" (weeks 2–4). Existing data (`~/.claude/issues/*`) must also be migrated or abandoned.

The regression is structural, not incidental: the mod reads one location (`~/.claude/issues/{TICKET}/summary.md`) with one status vocabulary (`planning|implementing|review|merged|closed`), and the skill writes the same place. The day the store moves to `.pjman/` or `~/.pjman/stores/`, the pane and sidebar go blank until the rewrite is at parity, so the founder keeps using the old tool — the report's kill signal, produced by the plan rather than by the idea. Step 4 above (emit `summary.md` as a derived view) avoids this with one evening and no change to the old code. The pane and sidebar should be rebuilt on the new library only after the test passes, and only if Phase 0's shapes are not good enough — which nothing so far shows.

## Phase-3 leakage and over-design

The report's kill signal for week 1 is "spec … acquires Phase 3 fields (authorities, rubrics, asks)." Nothing is literally named `rubric`, but the following exist to make Phase 2/3 arrive "without a migration", have no reader in Phase 1, and cost design time now. Each is deletable because the schema's own extension rule makes adding an optional frontmatter key later a non-migration.

**Should not exist yet**

- **`SCHEMA.md` "Layer 4 · Authority — Phase 3"**: the section lists exactly the Phase 3 vocabulary (owner-with-meaning, authority records, derived approvers from `touches`/`affects`, `default`/`due` bounded asks, rubric records, `evidence` edge, `claim`, human-required policy) "so lower layers leave room." This is the reservation that justifies every item below. Delete the section; `ext:` is the room.
- **`owner` on `change`, `product`, `feature`** ("Optional; defaults to `writer`. Layer 4 gives it meaning"): a field whose only Phase 1 value is `writer`. In the store it is `person:vinh` on every change and the product, beside `writer: person:vinh`. Delete; add when a second actor exists.
- **Feature `owner` rules** ("inherits along a single parent line; required with several parents"): the whose-signature rule from decision 25, a Phase 3 approval concern. Delete.
- **Layer 3 as a whole** (`product.md`, `features/`, `parents`, `affects`, `touches`, no-cycle rule, where-used): the store enables the `product` layer and has zero features; `touches` is unused; `affects` exists only to derive approvers ("a second subtree → its owner"). The report calls the feature-to-code mapping "the core technical risk, unproven" and places feature ownership in Phase 2. Disable the layer and move the section to an appendix. `product.md` can stay as a one-field root if the CLI needs one; nothing reads it.
- **Actor as a record type** with `aliases` and `links`: Phase 2 multi-writer machinery. Phase 1 has one person and one harness; `writer: person:vinh` as a string ref is sufficient, and the two actor files in the store carry no information. Keep the `person:`/`agent:` ref form; drop the record type.
- **Session `parent`** and the spawn rule ("a subagent spawned for one task is a session with a `parent`; a fan-out is a tree"): Phase 0 records no subagents; this serves the "factory of agents" section of the thesis (Phase 3–4). Delete; `ext:` until a deriver writes it.
- **Provenance → "A hosted implementation must provide the same through an audit log. This is a layer-0 requirement"**: Phase 2 written into layer 0. The `Pjman-Session:` commit trailer has no writer. Delete the sentence; the trailer is an adapter note.
- **Validation → "derived fields match what their deriver last wrote (a hand edit to a derived field is drift)"**: requires the index to persist the deriver's last value, i.e. state beyond the files. With one deriver there is nothing to compare against. Keep the A/D column; delete the rule.
- **Location → user-space stores with `~/.pjman/config.yaml` mapping paths or repositories to stores, and the three-step resolution**: design for two stores before one is in use. Phase 0's corpus is repo-agnostic per ticket (user space); the pjman store is in-repo. Pick one for the test (user space matches daily work) and defer the map.
- **`source_kinds: [… github-pr, github-issue, linear-issue]`** in `pjman.yaml`: none used; `observed`/`observed_at` on source are "written only by a sync adapter" that Phase 1 does not schedule (the Linear binding "made bidirectional" is Phase 2). Consequence below.
- **Decision `status: reverted`**: undefined against `superseded`; unused.

**Over-design relative to the eight-week test**

- **Drift, as defined, cannot fire in Phase 1.** The only drift the schema specifies is "a bound source's `observed.status` … disagreeing with the change's `status`", which needs a Linear read-sync. Yet the report's pass signal for weeks 3–6 is "drift surfaced at least once and it mattered." Either the plan quietly includes a sync adapter, or the pass signal is unreachable. Define the Phase 1 drift the tool can actually detect: a `superseded` decision still linked from an active change; a `done` change with `proposed` decisions; a bound key whose folder was renamed.
- **The minimal core is the wrong minimum.** v2 pruned the fields the Phase 0 views read daily (`next`, `goal`, PR URLs, `plan.md` exists, `branch`, typed link kinds, Feedback, Conversations) to `ext:` and kept the fields no view reads (actors, owner, features, supersedes). So `validate` will validate nothing the pane and sidebar depend on, and the adapters will read mostly `ext:`. The record-in-use and the spec have diverged in the direction the report warned about.
- **The walk-through is not a walk-through.** The schema says "Draft until walked through on a real change." The store's five changes have `binds: []`, no `touches`, and are the plan's own steps. The bootstrap session's two `observed` edges duplicate the schema change's authored `links` — hand-written "observed" edges, which is a contradiction in terms and shows the observed layer has no writer.
- **The status vocabulary renamed the founder's own words** (`implementing → active`, `merged → done`, `closed → dropped`) to a canonical seven-state set before a second organisation exists. "The vocabulary is data" is satisfied by making Phase 0's five words the default; the rename costs a map, a skill retrain and a bridge for no Phase 1 reader.
- **The ER diagram and the `principal → actor` rename** (both 2026-10-11) are spec upkeep on a document that should be frozen; eleven files changed for a synonym.

## Constraints to delete

The list claims "each costs nearly nothing in Phase 1 and a rewrite if ignored." The second half is false for optional fields: by the extension rule, adding a key later is never a rewrite. Judged on Phase 1 cost alone:

| Constraint | Phase 1 cost | Verdict |
|---|---|---|
| The schema outlives the adapters (nothing vendor-specific in a record) | Nil; it is a rule about what not to write | Keep |
| The schema is independent of storage ("the same library API against both") | Real: it motivates UUIDs everywhere, the index, the storage-neutral `observed` map, and the hosted audit-log line. The report explicitly warns against letting this one "pull the schema toward hosted-graph generality before a second person has written a decision into it" | **Delete.** What remains of it is constraint 4 |
| Records are strictly parseable | Nil; it is what makes `validate` possible | Keep |
| Ids are stable; paths are not | Moderate: UUID v7 on every record forces the resolution layer (prefix, slug, handle, bound key) and the handle exception for actors — about an evening. Phase 0 used the ticket key as the id and lost nothing | Keep, but accept the cost is not "nearly nothing" |
| Authored versus derived is marked | Nil as a column; the enforcement rule is not (see above) | Keep the column; delete the enforcement |
| One writer per layer, even with one person | Nil as discipline; already waived for the bootstrap session | Keep |
| Changes point at features; features have parents, from day one | Drags layer 3 into Phase 1 | **Delete.** Add `touches` when the first feature exists |
| An owner exists from day one | A field that can only equal `writer`; the reason the owner-inheritance rules are specified | **Delete** |
| Every record carries its writer, and an actor may be an agent; owners and authorities accept agents | `writer` is one field and cheap. "Authorities accept agents" has no authorities to accept anything | Keep `writer`; **delete the second clause** |
| The status vocabulary is data | A map in YAML | Keep; make Phase 0's words the default |
| Location is a choice, resolved per product | Two resolution paths and a config map | Defer; one location until two stores exist |
| Derivation is code where it can be | A principle, free | Keep |

Net: delete three, halve one, defer one. What survives is a one-paragraph rule — parseable frontmatter, stable ids, a writer on every record, A/D marked, nothing vendor-specific — which is what Phase 0's `DESIGN.md` already said in different words.

## Minimum tool

**`index` is premature.** The store has 22 records; a staff engineer's Phase 0 corpus is likely under 200 ticket folders. Parsing a few hundred frontmatter blocks is milliseconds, and every Phase 1 query is a one-hop reverse lookup (a change's decisions, a source's change, a decision's superseded-by, a change's sessions) that a full scan answers. Multi-hop queries only exist once features exist. An embedded database adds a build step, a native dependency (`better-sqlite3`, or LadybugDB after Kuzu's archival), a second source of truth that can disagree with the files — the Backstage failure the records-are-truth decision was written to avoid — and the "deriver's last value" state the validation rule needs. Load everything into memory, query in process, print `--json`. Reconsider when a query is measurably slow or a second hop is needed.

**`render decisions` is premature as a generic verb.** Rendering implies templates. `ls decisions --json` plus a 30-line script covers DECISIONS.md if anyone wants it.

**The smallest tool that makes the store usable daily** is not the CLI; it is `context` fed into the agent. Four verbs, one file, no dependencies beyond a YAML parser:

- `new change|decision` — id, envelope, body template, `status: proposed` for decisions.
- `validate` — parses, required fields, enums, ids well-formed, references resolve, `binds` once, `superseded` pointed at by a `supersedes`. Exit non-zero with a list.
- `ls <type> [--for <change>] [--status …] --json` — the read path.
- `context <change>` — Summary, bound keys, `decided` decisions with ids and one-line Why, warnings for `superseded` still linked and `proposed` still open. This is what the hook injects and what the test measures.

Everything else — index, MCP server, pane, sidebar, Linear sync, export — waits for the tally.

### DECISIONS.md as a view

Busywork, with one salvageable part. DECISIONS.md is read by nobody daily; it is the thesis's audit trail and was last appended 2026-10-09. Migrating entries 1–24 means hand-writing 24 more records opened `decided` — the after-the-fact pattern, in the wrong direction (records derived from prose rather than prose from records) — and the change record itself admits it would be "the third hand-bootstrap." Many of the 24 are not decisions but positions ("alignment is hard, execution is easy", the pricing model), and a `decided_by: person:vinh` stamp on them adds nothing a list lacks. The exercise tests `render`, not the join.

The salvageable part: three entries have a revision chain (18 revised; 23 revised by 24; 5 refined by 25). Migrate those pairs only, as the first `supersedes` test, and leave DECISIONS.md hand-maintained and append-only as its header says. Mark the change `dropped` or re-scope it to that.

The first view that would actually be used daily is `context <change>` printed into the session — the pane's "what is this ticket, where is it, which PRs" plus the decided decisions. The second is the lane board, which already exists as the cmux sidebar and reads a cmux description, not files. The DECISIONS.md render is at best fourth.

## Risk register

Top five ways this fails in the first eight weeks, with the earliest observable signal.

1. **Documentation instead of code (the Logseq drift).** Already observable: 8 commits, 0 executable lines; v0 → v1 → v2 → four amendments → ER diagram → rename in three days; a five-report adversarial review of a spec before a validator exists. *Signal:* by 2026-10-18, no `pjman` executable in the repo, or any `SCHEMA.md` commit that lands before the first code commit. *Rule:* SCHEMA.md commits may not outnumber code commits from here.

2. **Schema churn.** Each review round produces amendments; each amendment is justified by a later phase. *Signal:* a v3, a new field motivated by "so Phase N needs no migration", or this review series producing another SCHEMA.md edit instead of a CLI. *Rule:* freeze v2 now; fix only what `validate` cannot implement.

3. **The adapter re-derivation eats the evenings and the old tool stays in use.** 10–15 evenings for parity, during which the pane and sidebar read a location the new store does not write. The report's kill signal ("the old tool is still the one in use") fires because of the plan, not the idea. External amplifier: the mod is "built on Claude Code 2.1.292," mods are behind a rollout switch ("hooks modules are turned off"), and cmux sidebars are a runtime-interpreted subset with quirks; a harness release can zero the port. *Signal:* pane or sidebar work started before `context` exists; at week 4, decisions on real tickets are still being written into `summary.md`'s Decisions section by the skill after the fact.

4. **The test is unfalsifiable as specified.** No control: the founder is in every session, so an agent "honouring" a decision cannot be distinguished from the founder restating it; the only drift the schema defines needs a sync adapter that is not in Phase 1; "a `docs/decisions` folder would not have managed" is a judgement with no recorded basis. *Signal:* by week 6, no logged instance of an agent citing a decision id absent from the prompt, and no `superseded` record that changed a choice. *Rule:* define the tally (step 5 above) before the first real session, and define Phase 1 drift as something the tool can detect.

Watched, not managed: Linear or Atlassian shipping a Decision object with an owner (changelogs; the report's option-killer for Phases 2–3; irrelevant to the Phase 1 test).

