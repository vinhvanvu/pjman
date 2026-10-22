# pjman — thesis and roadmap

*Working name. The pitch and the plan. The decisions are records in the store (`.pjman/`; `pjman ls decision`, `pjman show <key>`); the Phase 1 record contract is `SCHEMA.md`; the tool is documented in `README.md`; the layer catalog is `LAYERS.md`; the research is under `reports/`; adversarial reviews under `reviews/`. This document states what is true now; history lives in the decision records and in git.*

---

## The pitch

**Alignment is hard. Execution is easy.**

AI agents made building software cheap and competent. They did not make *agreeing on what to build* cheap. Organisations still lose most of their product-development time to collecting context, finding the right people, getting their attention, and getting decisions out of them before anything is built. Code was never the value; it was the high-skill blocker in front of the product, and removing it exposed the problem every engineer has lived with.

Engineers were not only the labour; they were the record. Decisions, constraints and the reasons a product is shaped the way it is lived in their heads because only they could act on them. Now that agents act, there is no record, and every session starts from nothing.

**pjman is a context graph for product development**: typed records — changes, decisions, sources, sessions, actors — with typed edges, under one schema, authored and observed kept apart. It runs in two places without changing shape:

- **On one person's machine**, as files in git: the open-source framework. The context your agents work from, in a shape you grow into an organisation.
- **Hosted, for an organisation**: the paid product. The organisation's graph, queried by agents through the MCP and by people through the web, with ownership and authority layered on so that decisions route to the people accountable for them.

One object at three distances: the local graph, the shared graph, the alignment layer over the shared graph. The customer's question is *"how do I build and maintain my software at various scales?"*; the thesis is why pjman answers it.

### What it is not

- **Not an all-in-one.** pjman owns the graph and the workflows, integrates with the systems of record, and renders views over its own data rather than rebuilding other products.
- **Not a memory tool.** Memory tools hold facts. pjman holds *structure*: the unit of work, its decisions, its evidence, its relationships; and it is harness-agnostic where every lab's memory is locked to its own agent.
- **Not an agent harness.** The labs own execution. pjman consumes harnesses.
- **Not a tracker with agents as assignees.** Trackers are tied to the ticket. pjman's unit of work is the change, and the only thing humans are expected to write is the decision.

### The bets

1. **Humans stay in the loop for authorization, ownership and responsibility.** Experts, authorities and accountable people remain, and the product is organised around them.
2. **Execution is cheap and competent, not infallible.** Design assuming agents build well; never assume the outcome is right. Accountability without evidence is a rubber stamp.
3. **Incumbents cannot pivot here.** Linear beat Jira by being narrower and more opinionated; Notion won with a new primitive. pjman's primitive is the graph.
4. **Build only what gets more valuable as models improve.**

### Tenets

- **The free framework is complete on its own.** Never crippled to push the hosted tier.
- **Build the tool its builder wants to use.** The founder is the first user, dogfooding at real work; later users will be less sophisticated, and conversations with them are the correction.
- **A decision is authored by an actor with authority for its scope, and humans set which scopes require a human.** Day one, every scope does. Agents do everything else.
- **Humans and agents are the same kind of participant.** An actor is a person or an agent; every record an adapter writes carries its writer and its session; where a human is required is policy, not a property of the system.
- **Drift is surfaced, never hidden.**
- **Prescribe what gets recorded, never how the work is done.**
- **Documents state what is true now.** History lives in decision records and in git. The store is the source of truth; a document is a synthesis of it.

---

## The substrate: the context graph

### Two truths

**Observed state** — what the product actually is — belongs to code, deploys, telemetry and the organisation's tools; pjman never owns it. **Declared state** — what it is supposed to be, who owns it, how mature it must be, and why — belongs to pjman; nobody owns it today. Drift is the gap between them, surfaced and routed, never silently resolved. The analogy is Terraform for product development.

### Vocabulary

- **Product** — the root. **Feature** — any node beneath it; not defined, only its contract is; nests without limit under one or several parents. *(Phase 2.)*
- **Project** — a repository, registered in the store. A change belongs to one.
- **Change** — a unit of work. A Linear ticket, a GitHub issue, a milestone, a brainstorm are all changes.
- **Decision** — what an actor with authority wrote: what, who, why, when. Opened `proposed` before the work it governs.
- **Source** — a thing outside the store: a ticket, a PR, a doc, a thread, a file. May exist only as a key.
- **Session** — a run: an agent, on behalf of a person, possibly spawned by another run; what it bound and what it observed.
- **Actor** — a person or an agent. An actor is a definition; a session is a run; a spawn is a session, never an actor.

### The layers

| Layer | Holds | Phase |
|---|---|---|
| 4 · Authority | authorities, rubrics, bounded asks, maturity as claim plus graded evidence, which scopes require a human | 3 |
| 3 · Product | product, features, `touches` | 2 |
| 2 · Work | change, decision, the status vocabulary | 1 |
| 1 · Sources | source records; observed state when a sync adapter exists | 1 (records) · 2 (observed) |
| 0 · Core | keys, the envelope, projects, actors, sessions, validation, the index, location | 1 |

A record references its own layer or a lower one. Each layer adds record types, edges and rules; a store enables what it needs.

### Principles of the record (the contract is `SCHEMA.md`)

- **Records are files in git; the index is derived and disposable.** The store is one git repository per person, the global store; every repository the person works in is a project in it, and the record never sits in a project's repository.
- **References are keys, not ids** (`person:vinh`, `change:schema`, `linear:ABC-1234`). Ids exist only in the index. Renames go through the tool and leave aliases.
- **Edges are declared on the record that made them.** Reverse edges are derived. Observed edges, recorded by sessions, are evidence, never truth.
- **Authored versus maintained.** A field is authored by an actor on intent, or maintained by one named writer. Nothing is verified against what a tool previously wrote.
- **The tool is the schema.** It validates on write; hand edits are tolerated and reported; invalid records are reported, never dropped.
- **Conflicts are recorded, never silently won.** A source bound twice, two records at one key: the index reports it.
- **Nothing harness-, tool- or vendor-specific in a record.** Those live in adapters and configuration, and under `ext.<owner>.<field>`.

### The durability test

For every piece: does it get more or less valuable if models get 10× better? Build the graph and its history, who decided what and why, gates and defaults, evidence, criteria. Keep thin step sequencing, prompt templates, decomposition into tickets, hand-holding. Workflows are declarative: each stage says what must be true and who must sign; how agents get there is theirs.

---

## The layer: alignment (Phases 2–3)

More record types, more readers and more writers on the same graph.

**Ownership and authority.** One accountable owner per feature in the domain tree; disciplines (product, design, data, systems) as authorities with scopes across it; prototyper, developer, scaler, maintainer as modes, not necessarily people. **Rubrics** are an owner's or authority's criteria, versioned, run by agents on every change beneath. **Maturity** is a claim plus graded evidence (telemetry > simulation > analysis); a level is a rubric plus a required evidence grade.

**The lifecycle.** Request (anyone; add, update, fix, retire; questions answered from the graph) → triage by agents onto the right feature → design (build before deciding: grounded variants with trade-offs; forcing questions surfaced first) → approval (approvers derived from what a change touches and affects; bounded asks with a recommended answer, a deadline, a default) → execution by agents → acceptance (a brief, not a diff, written by a different agent than the one that did the work) → sustain (drift, evidence upkeep, retirement). Authorizing the intent and accepting the result are separate moments.

**Surfaces.** The local MCP in whatever harness the developer uses; a web agent acting with the user's authority; a merge check in CI; integrations that begin as bidirectional sync and end as views.

**Software factories.** If agentic development becomes a factory, pjman is not the line but the systems around it: PLM (the tree and declared state), the engineering change order (a change with its design record), sign-off by affected functions (derived approvers), the traveler (the record moving with the work), release gates (maturity), inspection criteria and records (rubrics, evidence), the nonconformance report (drift). Agents coordinate through the record, never through messages, so every action in a factory is a record with provenance.

---

## Positioning

**Solo first; the same graph grows with the customer.** A solo developer has a product-context problem, not an alignment problem; the framework is the context their agents work from. A team adopts its own subtree; every team that petitions it sees the product. Larger companies join by ingestion plus declaring their authored half, subtree by subtree.

**The shape is Vercel and Next.js.** A free, complete, open-source framework (permissive licence) and a proprietary hosted service. *Anything that runs on your machine is free; anything that runs on ours is paid.* Solo pays a low flat rate for hosting; teams pay per signer; requesters and viewers are free. Retention, not signups, is the fit signal.

**Views over one graph.** Neighbours are undercut by rendering, not rebuilding: a board over changes, a roadmap over requests, a catalog over the tree. Linear and Jira track work; Productboard holds requests; Backstage and the IDPs catalog services, and their hand-maintained catalogs go stale. They are displaced along the growth path, never in a feature fight. Harnesses are consumed, not competed with.

**The moat is never the code.** It is the accumulated graph, the network inside an organisation, operations, accountability, and being the default.

**Domain-agnostic core, software first.** Nothing in the entities says "code". Software is built first because its observed state is machine-readable; where it is not, the model applies and drift detection degrades to human report.

**What the research found** (`reports/pjman worth building analysis.md`): the join pjman proposes exists nowhere while every neighbour has the fragments; the measured pain is at the authorize-and-accept gate; Phase 1's real competitor is a `docs/decisions` folder; the solo tier cannot fund a business; the window is open while organisations are multi-harness.

---

## Roadmap

### Phases

| Phase | What it is | Validates |
|---|---|---|
| **0 — The work tool** (exists) | The founder's per-ticket context layer: a folder per Linear ticket, a status contract, derived session records, a pane and a sidebar | That the records are worth keeping, for one person |
| **1 — The framework** | Layers 0–2 built to `SCHEMA.md`: the tool, the Claude Code adapter, the global store, the getter, the view beside the session, the event stream and the board, the tracker sync | That the founder's daily work runs from the store, and that a typed decision record read by an agent beats a folder of markdown |
| **2 — The shared graph** | Observed state from sync adapters (Linear, GitHub) and drift; sessions and actors at full strength; layer 3; change-to-change edges; a hosted backend with the same operations; a board for someone who is not the developer; the solo tier | That the record speaks to a manager and a team can run on it |
| **3 — Alignment** | Layer 4: authorities, rubrics, approvers derived from the record, bounded asks, the brief, maturity as evidence, intake and triage, the web agent; per-signer pricing | That decisions get made before things are built, and people pay for that |
| **4 — Views over one graph** | Roadmap, catalog and boards displacing the neighbours; brownfield ingestion; other domains | That the accumulated graph is the moat |

### Phase 1, in order

1. **The tool.** TypeScript, one package: `init`, `new`, `set`, `session`, `validate`, `fmt`, `ls --json`, `context`, `show`, `mv`, `index`, `query`. Keys in files, ids in the index. The YAML rule enforced.
2. **The store, rebuilt through the tool,** on pjman's own development, with decisions opened `proposed` before the work. The existing documents backfilled as records, and cleaned so that every document states only what is true now.
3. **The Claude Code adapter.** Hooks that inject `context` at session start, write session records, bind the session to the change the prompt names and record observed edges; a skill rule that opens a decision `proposed` before acting. No bridge to any other board.
4. **The global store.** One per person, its own repository; a repository is a project in it; the record out of every project's repository.
5. **The getter.** Anything in — a key, a ticket id, a URL, a document link, a file path — the record and its neighbourhood out. Naming a ticket in a prompt binds the session through it.
6. **The view beside the session.** The bound change, its ticket, decisions, sources, files touched and sessions, refreshing as the store changes; no commands to run to see where you are.
7. **The event stream and the board.** Every write appends an event; a follow command streams them; the session board is a projection that subscribes and sorts sessions into lanes.
8. **The tracker sync.** Linear drives the store through its MCP server: a ticket becomes or updates the change that binds it.

Phase 1 ends when the founder's daily work runs from the store. There is no time frame and no kill rule; success is reached in stages, each counting on its own: the work managed from the store; views built from it; the store hosted as shared context and sold. After Phase 1: **the second user**, who installs from the README and gets value; then **public**: licence, repository, name.

Working rule: schema commits may not outnumber code commits.

### Constraints on decisions made now

- Nothing harness-, tool- or vendor-specific in a record.
- References are keys; ids live in the index; renames leave aliases.
- Authored versus maintained is marked; no field is verified against a previous write.
- Records are strictly parseable under the YAML rule; nothing structural lives in prose.
- Every record an adapter writes carries its writer and session; sessions carry the person they ran for.
- The status vocabulary is data; the canonical word is what is written.
- The store is one global git repository per person; the tool commits every write it makes.
- Sources may exist as keys; observed state arrives only with a sync adapter.
- Conflicts are recorded, never silently resolved.

---

## Open questions

- The brief's fields: the minimum a human must see to sign (Phase 3).
- The licence (MIT or Apache-2.0) and the name.
