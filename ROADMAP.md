# pjman — roadmap

*Drafted 2026-10-09. The thesis (`THESIS.md`) says why and what; this says in what order, what each phase validates, and what decisions made now must respect so they still fit later. One object at three distances: one person's unit-of-work records → the same records instantiable by anyone → the same records shared across people with ownership and authority on top.*

## Phases

| Phase | What it is | Validates | Needs |
|---|---|---|---|
| **0 — The work tool** (exists) | The *claude-session-board*: one folder per Linear ticket (`summary.md` contract, `plan.md`), derived per-session records, a pane and a cmux sidebar as views; one writer per layer; prescribes no way of working, only what gets recorded | That the records are worth keeping, for one person | Done; in daily use |
| **2 — The shared record** | Multi-writer (two sessions on one unit, arbitrated); units that contain units; an owner on a unit; the Linear binding made bidirectional; PR and merge evidence derived; a board for someone who is not the developer | That the record speaks to a manager and a team can run on it | A second person; probably the first hosted piece |
| **3 — Alignment** (the business) | Authorities and rubrics; design records with deltas; approvers derived from deltas; bounded asks with defaults; the brief; maturity as claim plus graded evidence; intake and triage; the web agent; per-signer pricing | That decisions get made before things are built, and people pay for that | A team with real approvals |
| **4 — Views over one graph** | Roadmap, catalog and boards as views displacing the neighbours; brownfield ingestion; other domains | That the accumulated graph is the moat | Scale |

## Phase 1 in order

1. **The contract.** Generalise `DESIGN.md` and the skill's corpus contract into a spec: the change record (frontmatter fields and sections), the session record (schema), the status vocabulary, the locations. The change's source pluggable (a Linear ticket today; a GitHub issue, a milestone, a topic); location pluggable (in a repo or in user space); vocabulary configurable with the current one as default. The vocabulary is fixed (thesis decision 26): product, feature, change, decision.
2. **The library and CLI.** One implementation of read, write, validate and query, emitting JSON. Everything else consumes it.
3. **The adapters.** The skill, the mod and the sidebar ported onto the library, so the founder's daily work runs on the framework. The README's "edit three hard-coded values" become config.
5. **Public.** Licence, repository, name.

Not in Phase 1: ownership, approvals, the product tree, anything that needs a server.

## Constraints on decisions made now

Each costs nearly nothing in Phase 1 and a rewrite if ignored.

- **The contract outlives the adapters.** Nothing harness-, tool- or vendor-specific in the record. Claude, cmux and Linear appear only in adapters and configuration.
- **Every field a tool reads is structured.** Frontmatter is the API; prose is for people.
- **Ids are stable; paths are not.** A unit is keyed by an id that survives moves and renames; references point at ids.
- **Authored versus derived is marked in the schema.** A derived field is never hand-written; a tool that derives it is its only writer.
- **One writer per layer**, even while the only writer is one person.
- **Changes point at features; features nest.** A change carries the features it touches (possibly none in Phase 1); a feature carries its parents (zero or more). Both fields exist from day one even if nothing uses them; the product tree arrives without a migration.
- **An owner exists from day one**, defaulting to the single user. The field, not the feature.
- **The status vocabulary is data**, with the current one as the default, mapped to the org's tool by configuration.
- **Location is a choice** — in the repository or in user space — resolved per project, with the same record shape in either.
- **Records are strictly parseable.** Every field and edge a tool reads is in frontmatter; nothing structural lives in prose, so the index can be rebuilt by a scan and the validator can check cross-record rules.
- **The schema is independent of storage.** Entities, fields, edge types and validation are a spec; Phase 1 implements it over files with an embedded index, Phase 2 over a hosted database, and the library's API is the same against both.
- **Derivation is code where it can be and the model only where it must be.** Code decides whether a turn took action; the model writes the sentence.
