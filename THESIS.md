# pjman — thesis and roadmap

*Working name. Resynthesised 2026-10-10 from the founding conversation (2026-10-05 → 2026-10-10). The numbered decision log is in `DECISIONS.md`; this document is the pitch and the plan.*

---

## The pitch

**Alignment is hard. Execution is easy.**

AI agents made building software cheap and competent. They did not make *agreeing on what to build* cheap. Every organisation still loses most of its product-development time to collecting context, finding the right people, getting their attention, and getting decisions out of them before anything is built. Code was never the value; it was the high-skill blocker in front of the product. Remove the blocker and the problem every engineer has lived with is exposed: alignment and communication.

Engineers were not only the labour; they were the record. Decisions, constraints and the reasons a product is shaped the way it is lived in their heads because only they could act on them. Now that agents act, there is no record, and every session starts from nothing.

**pjman is a context graph for product development**: typed records (changes, features, decisions, sources) with typed edges, under one schema, authored and observed kept apart. It runs in two places without changing shape:

- **On one person's machine**, as files in git — the open-source framework. The product context your agents work from, in a shape you grow into an organisation.
- **Hosted, for an organisation** — the paid product. The organisation's graph, queried by agents through the MCP and by people through the web, with ownership and authority layered on so that decisions route to the people accountable for them.

The founder already runs the first instance at work. Phase 1 extracts it into a framework; Phase 2 hosts it; Phase 3 builds the alignment layer on top. One object at three distances: the local graph, the shared graph, the alignment layer over the shared graph.

The customer's question is *"how do I build and maintain my software at various scales?"*. The thesis is why pjman answers it.

### What it is not

- **Not an all-in-one.** Specialists keep winning their role. pjman owns the graph and the workflows; it integrates with the systems of record (code hosting and CI/CD have reliable hooks) and renders views over its own data rather than rebuilding other products.
- **Not a memory tool.** The memory space is crowded and the labs are in it. pjman persists *structure* — the unit of work, its decisions, its evidence, its relationships — not facts, and it is harness-agnostic where every lab's memory is locked to its own agent.
- **Not an agent harness.** The labs own execution and "watch my agent work". pjman consumes harnesses and stays agnostic across them.
- **Not a tracker with agents as assignees.** Trackers are tied to the ticket. pjman's unit of work is the change, and the only thing humans write is the decision.

### The bets

1. **Humans stay in the loop for authorization, ownership and responsibility.** A single person with an agent does not scale a product to success. Experts, authorities and accountable people remain, and the product is organised around them.
2. **Execution is cheap and competent, not infallible.** Design assuming agents build well; never assume the outcome is right. Accountability without evidence is a rubber stamp.
3. **Incumbents cannot pivot here.** Linear beat Jira by being narrower and more opinionated; Notion won with a new primitive. pjman's primitive is the graph.
4. **Build only what gets more valuable as models improve.** See *The durability test*.

### Tenets

- **The free framework is complete on its own.** Never crippled to push the hosted tier. If people trust what is free, they will trust what they pay for.
- **Build the tool its builder wants to use.** The founder is the first user, dogfooding at real work. This holds while the builder is representative of the market; later users will be less sophisticated, and conversations with them are the correction.
- **A decision is authored by a principal with authority for its scope, and humans set which scopes require a human.** Day one, every scope does. Agents do everything else.
- **Drift is surfaced, never hidden.**
- **Humans and agents are the same kind of participant.** A principal is a person or an agent; every record carries its writer; where a human is required is a policy on the tree, not a property of the system.
- **Prescribe what gets recorded, never how the work is done.**

---

## The substrate: the context graph

### Two truths

| | Owned by |
|---|---|
| **Observed state** — what the product actually is | Code, deploys, flags, telemetry, incidents, the org's tools. pjman never owns this. |
| **Declared state** — what it is supposed to be, who owns it, how mature it must be, and why | pjman. Nobody owns this today. |

Drift is the gap between them and is a first-class object: never eliminated, always surfaced and routed. There is no priority chain; when the local record and Linear disagree, nothing silently wins. The analogy is Terraform for product development: declared state, observed state, a diff.

### Vocabulary

Four nouns, and a fifth that is derived.

- **Product** — the root. Not "application" (a software word) and not "project" (which ends).
- **Feature** — any node beneath the product. Not defined; only its contract is (below). Features nest without limit and may sit under several parents.
- **Change** — a unit of work against one or more features. A Linear ticket, a GitHub issue, a milestone, a brainstorm are all changes. Its signers are the union of its features' owners.
- **Decision** — what a person wrote: what, who, why, when. The only authored thing.
- **Session** — derived from the harness: what a session was about, what it did, what is next. Belongs to the adapters, not the contract.

Plus **sources**: external things (a ticket, a doc, a PR, a message), small records created on first mention, which anything can bind to or link.

### The feature contract

A feature is not defined — product, design and engineering mean different things by the word, and any definition is wrong for someone. Its contract is fixed: a name, zero or more parents, an owner, a maturity claim with evidence, `affects` edges, and a derived mapping to the mechanism (code, config, whatever the domain's observed state is). No `kind` field, no typed hierarchy. **Many parents, one owner**: ownership inherits only along a single line; a feature with several parents names its own owner. A change to a shared feature needs its owner's signature and notifies the owners of everything that uses it. **Mappings are derived; nodes never are**: the derived layer never creates features from code structure. "A promise the product makes, that someone is accountable for" is help text for sizing, not a rule.

### Identity

Every record gets a time-ordered UUID. External entities map onto it, which is what makes the framework agnostic: a Linear ticket, a Jira issue, a Google Doc, a Slack message can each bind to a change, and a change can carry several. Humans never type a UUID: folders and prompts use the external key or a slug, `id:` sits in the frontmatter, references inside files point only at ids, and the CLI accepts a unique prefix. Binding is explicit — a change binds when a prompt names it, never from a branch or a directory.

### Storage: records are the truth, a graph is the index, the schema is independent of both

- **Records are files**, one per node, frontmatter for machines and prose for people, human-readable, in git. Location is a choice: in the repository or in user space, the same shape in either.
- **Edges are typed and declared on the record that made them**, in frontmatter, never in prose. `binds` (identity; one change per source, validated), `links`, `evidence`, `parent`, `affects`, `touches`, `decided`; the set is data. Reverse edges are never written.
- **Authored edges** live on records. **Observed edges** — noticed in a session ("the user pasted a Slack link while on ABC-1234") — are appended to that session's record, which has one writer and is append-only. They carry provenance and merge without arbitration.
- **The index is a graph database**, embedded, rebuilt from the files, disposable, and the only thing queries hit.
- **The CLI is the schema.** The library is the only writer adapters use and validates on write; hand edits are validated at the next index build; invalid records are reported as drift.
- **One writer per layer.** Derivation is code where it can be and the model only where it must be.
- **The schema is defined once, independent of storage.** Phase 1 implements it over files; Phase 2 implements the same schema over a hosted database, where the roles flip: the organisation's graph becomes the truth and the files become the export, the open format and the local mode.

### The durability test

For every piece: *does it get more or less valuable if models get 10× better?*

| Build here | Keep thin |
|---|---|
| The graph and its history | Step sequencing and wizards |
| Who decided what, and why | Prompt templates |
| Gates, permissions, defaults | Decomposition into tickets |
| Evidence and briefs | Role-specific hand-holding |
| Rubrics as criteria | How a rubric is checked |

Workflows are declarative, not procedural: each stage defines what must be true and who must sign. How agents get there is their business and improves on its own.

---

## The layer: alignment

Everything here is more entity and edge types, more readers and more writers, on the substrate above. Nothing needs a different graph.

### Ownership and authority

- **Domain** (the tree): one accountable owner per feature; a junior petitions upward; a solo developer sits at the root.
- **Authorities** (disciplines — product, visual design, data architecture, system architecture) hold scopes across the tree.
- **Stage**: prototyper, developer, scaler, maintainer are *modes* the model supports, not necessarily people. One owner may move a feature through all four; a large organisation may split them, with the design record as the contract that makes the handoff survivable.

### Rubrics, maturity, evidence

A **rubric** is an owner's or authority's standards for their scope, as versioned criteria, run by agents on every change beneath that node. Trust in a rubric is earned on record. **Maturity** is a claim (prototype / controlled / scaled, or "holds N users") plus graded evidence: production telemetry > simulation > analysis. A level is a rubric plus a required evidence grade; a feature claiming *scaled* on analysis-grade evidence is drift. pjman stores citations and confidence, never data.

### The lifecycle

**Request → Triage → Design → Approval → Execution → Acceptance → Sustain**

1. **Request.** Anyone, from anywhere. Add, update, fix, retire. Questions are answered from the graph, not queued; a bug report is observed-state evidence arriving through a human. A request is a source with a `requested` edge from the change triage created; a source with no change bound is the queue.
2. **Triage.** Agents turn the vague ask into a workable request on the right feature, de-duplicated, with a target maturity and the people it affects.
3. **Design.** People cannot decide when nothing is built, and execution is cheap, so **build before deciding**: grounded variants on the real architecture with trade-offs stated. Taste wants options, not questions. The design record lists what it forces — the decisions implied, the scale limit hit, the data that does not exist — so the hard parts surface before the build.
4. **Approval.** Approvers are **derived from the design record's deltas** (a visual delta → the design authority; a data delta → that domain's architect; a second subtree → its owner). Each gets a **bounded ask**: a question, a recommended answer, a deadline, a default. Rubrics are pre-run so the human approves exceptions. **Authorizing the intent and accepting the result are separate moments.**
5. **Execution.** Agents build from the graph; declared at authoring time through the MCP, verified at merge time by a check that cannot be bypassed.
6. **Acceptance.** The owner signs a **brief**, not a diff: intent, scope, deviations from the approved design, evidence against the rubric, fitness for the target maturity. Written by a different agent than the one that did the work.
7. **Sustain.** Drift detection, evidence upkeep, retirement. The most automatable stage.

### Surfaces

The **local MCP** in whatever harness the developer uses; the **web agent** for everyone else, acting with the user's authority; the **merge check** in CI; **integrations** that begin as bidirectional sync and end as views.

### Software factories

If agentic development becomes a factory, pjman is not the line — agents are the machines and CI/CD the conveyor — but the systems around it that manufacturing solved decades ago: PLM (the tree and declared state), the bill of materials (the feature tree), the engineering change order (a change with its design record), sign-off by affected functions (derived approvers), the traveler (the record moving with the work), release gates (maturity), inspection criteria and records (rubrics, evidence), the nonconformance report (drift). A factory of agents without a change process produces the wrong things faster. pjman sits at the front of the line and the back, and keeps the door open to whatever factory an organisation assembles in between. When agents coordinate among themselves, they do it through the record — the blackboard — never through messages, so every action is a record with provenance; and because a principal may be a person or an agent, the human line moves up the maturity axis as autonomy grows without the model changing.

---

## Positioning

**Solo first; the same graph grows with the customer.** A solo developer has no alignment pain; they have a product-context problem. For them the framework is the context their agents work from. A team adopts its own subtree without the rest of the organisation; every team that petitions it sees the product. Larger companies join by ingestion (the derived half, from code) plus declaring the authored half (owners, authorities, rubrics) subtree by subtree.

**The shape is Vercel and Next.js, not acme and Airflow.** A free, complete, open-source framework (permissive licence) and a proprietary hosted service. The line never needs a product debate: *anything that runs on your machine is free; anything that runs on ours is paid.* Free: the CLI and skills, the MCP server, the merge check, the schema and export. Paid: the graph held for more than one person and machine, webhooks, bounded asks with deadlines and defaults, the web agent, history, connectors, sync, views.

**Pricing.** A solo developer pays a low flat rate (about $10/month) for hosting; teams pay per signer — owners and authorities are the seats, requesters and viewers are free. Retention, not signups, is the fit signal.

**Views over one graph.** Neighbours are undercut by rendering, not rebuilding: a board is a view over changes, a roadmap over requests, a catalog over the tree with maturity. Linear and Jira track work; Productboard and Aha hold requests; Backstage, Cortex and OpsLevel are service catalogs (the closest analog: the shape gets adopted, and hand-maintained catalogs go stale). They exist as separate products because each serves a different role's handoff artefact; when handoffs go, so does the reason for three products. They are displaced along the growth path, never in a head-on feature fight. Harnesses are consumed, not competed with.

**The moat is never the code** — an agent clones it in a weekend. It is the accumulated graph, the network inside an organisation, operations, accountability, and being the default.

**Domain-agnostic core, software first.** Nothing in the entities says "code"; repos, merges and CI live at the edges as evidence and integrations. Software is built first because its observed state is machine-readable. Where it is not (clinical informatics, operations), the model applies and drift detection degrades to human report; companies that cannot set it up themselves buy implementation, later.

---

## Roadmap

### Phases

| Phase | What it is | Validates | Needs |
|---|---|---|---|
| **0 — The work tool** (exists) | The *claude-session-board*: one folder per Linear ticket (`summary.md` contract, `plan.md`), derived per-session records, a pane and a cmux sidebar as views; one writer per layer; prescribes no way of working, only what gets recorded | That the records are worth keeping, for one person | Done; in daily use |
| **2 — The shared graph** (the first hosted piece) | The schema over a hosted database; multi-writer with observed edges merging by construction; features and parents in use; an owner on a record; the Linear binding made bidirectional; PR and merge evidence derived; a board for someone who is not the developer; the solo tier | That the record speaks to a manager and a team can run on it | A second person |
| **3 — Alignment** (the business) | Authorities and rubrics; design records with deltas; derived approvers; bounded asks; the brief; maturity as claim plus evidence; intake and triage; the web agent; per-signer pricing | That decisions get made before things are built, and people pay for that | A team with real approvals |
| **4 — Views over one graph** | Roadmap, catalog and boards displacing the neighbours; brownfield ingestion; other domains | That the accumulated graph is the moat | Scale |

### Phase 1 in order

1. **The schema.** Generalise the session board's `DESIGN.md` and skill contract into a spec: the change record (frontmatter fields and sections), the session record, the source record, the edge types, the status vocabulary, the locations. Source pluggable (a Linear ticket today), location pluggable (repo or user space), vocabulary configurable with the current one as default. The vocabulary is fixed: product, feature, change, decision.
2. **The library and CLI.** One implementation of read, write, validate, index and query, emitting JSON. Everything else consumes it.
3. **The adapters.** The skill, the mod and the sidebar ported onto the library, so the founder's daily work runs on the framework. The README's "edit three hard-coded values" become configuration.
5. **Public.** Licence, repository, name.

Not in Phase 1: ownership as a feature, approvals, anything that needs a server.

### Constraints on decisions made now

Each costs nearly nothing in Phase 1 and a rewrite if ignored.

- **The schema outlives the adapters.** Nothing harness-, tool- or vendor-specific in a record. Claude, cmux and Linear appear only in adapters and configuration.
- **The schema is independent of storage.** Files now, a hosted database later, the same library API against both.
- **Records are strictly parseable.** Every field and edge a tool reads is in frontmatter; nothing structural lives in prose.
- **Ids are stable; paths are not.** References point at ids.
- **Authored versus derived is marked in the schema.** A derived field is never hand-written; its deriver is its only writer.
- **One writer per layer**, even while the only writer is one person.
- **Changes point at features; features have parents.** Both fields exist from day one even if unused; the product tree arrives without a migration.
- **An owner exists from day one**, defaulting to the single user. The field, not the feature.
- **Every record carries its writer, and a principal may be an agent.** Owners and authorities accept agents from day one, so a factory of agents coordinates through the record without a schema change.
- **The status vocabulary is data**, with the current one as default, mapped to the org's tool by configuration.
- **Location is a choice**, resolved per product.
- **Derivation is code where it can be and the model only where it must be.**

---

## Open questions

- **The schema's remaining fields**: what each status means (so other vocabularies map onto the default); which sections of a change record are contract and which are the founder's; the exact edge-type set.
- **The brief's fields** — the minimum a human must see to sign; a Phase 3 artefact, refined against real sign-offs.
- **The licence** — MIT or Apache-2.0.
- **The name** — for the framework, possibly separate from the product; not "project management".
