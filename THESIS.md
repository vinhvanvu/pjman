# pjman — thesis

*Working name. Drafted 2026-10-07 from the founding conversation (2026-10-05 → 2026-10-07). This is the declared state of the idea; everything else is downstream of it.*

## The thesis

**Alignment is hard. Execution is easy.**

AI agents made execution cheap and competent. They did not make alignment cheap. Every organisation still loses most of its product-development time to collecting context, finding the right people, getting their attention, and getting decisions out of them before anything is built. That cost is now the bottleneck, and nothing is built around removing it.

pjman is a system of record for a product's **declared state** — what the product is supposed to be, who owns each part, how mature it must be, and why — reconciled continuously against its **observed state** in code and production. Humans author decisions. Agents do everything else.

## The problem it solves

Today, AI tooling is bolted onto processes designed for human-to-human handoffs. Tickets, PRDs and design specs exist because people have limited context and need handoff artefacts. Agents consume context cheaply, but the context is scattered across trackers, design tools, docs, chat and people's heads — and none of it carries authority.

The person who does the aligning today (a staff engineer, a technical owner of an area) spends their day as the pusher: iterating a naive mock into a real design from the architecture they carry in their head, chasing approvals from product, design, data and backend owners, and absorbing the blame when the hard parts surface mid-build because nobody could decide while nothing was built.

## What it is not

- **Not an all-in-one.** All-in-one has a bad record (Atlassian, GitLab, Notion-as-everything); specialists keep winning their role. pjman owns the model and the workflows, and integrates with the systems of record — code hosting and CI/CD have reliable hooks, and those are the foundation.
- **Not a context layer for the org.** That pitch is crowded. pjman's graph is product-shaped and carries authority; it is not a searchable pile of documents.
- **Not an agent harness.** The labs and harnesses own execution and will own "watch my agent work". pjman consumes them and stays agent-agnostic.
- **Not a tracker with agents as assignees.** Trackers are tied to the ticket as the unit of work. pjman's unit is the decision.

## The bets

1. **Humans stay in the loop for authorization, ownership and responsibility.** A single person with an agent does not scale a product to success. Experts, authorities and accountable people remain — and the product is organised around them.
2. **Execution is cheap and competent, not infallible.** Design assuming agents build well; never assume the outcome is right. An agent executes flawlessly on an ambiguous intent and builds the wrong thing. Accountability without evidence is a rubber stamp.
3. **Incumbents cannot pivot here.** Linear beat Jira and GitHub Projects by being narrower and more opinionated for new companies; Notion won with a new primitive. pjman's primitive is the product model.
4. **Build only what gets more valuable as models improve.** See *The durability test*.

## Two truths

| | Owned by | Examples |
|---|---|---|
| **Observed state** — what the product actually is | Code, deploys, flags, telemetry, incidents | Always. pjman never owns this. |
| **Declared state** — what it is supposed to be, who owns it, how mature it must be, and why | pjman | Nobody owns this today. |

Drift is the gap between them and is a **first-class object**, never eliminated, always surfaced and routed: *"this merged PR changed billing behaviour; no feature record covers it; the owner needs to decide."* Reconciliation with code is the core loop, not an import feature. It runs at merge time (incremental, cheap) rather than by periodic crawl.

The analogy: Terraform for product development — declared state, observed state, a diff.

## The model

| Entity | Source |
|---|---|
| **Feature** — a capability of the product, arranged in a tree | Authored (proposed by anyone, accepted by the owner) |
| **Owner** — exactly one accountable person per node | Authored |
| **Authority** — a discipline (product, visual design, data architecture, system architecture) with a scope over the tree | Authored |
| **Rubric** — an owner's or authority's standards for their scope, as criteria | Authored |
| **Maturity** — a claim (prototype / controlled / scaled, or "holds N users") plus evidence | Claim authored; evidence derived |
| **Decision** — what, who, why, when | Captured at gates; **the only thing humans write** |
| **Request** — add / update / fix / retire a feature | Authored by anyone; triaged by agents |
| **Change** — an intended alteration to a feature, with a target maturity | Intent authored; progress derived |
| **Design record** — visual + data-model delta + system delta + constraints checked + trade-offs chosen | Drafted by agents; approved by authorities |
| **Evidence** — PRs, tests, deploys, flags, metrics, incidents, bug reports | Derived; a citation with source, grade and confidence |
| **Architecture** — the data model and system design as they stand | Derived from code |
| **Feature ↔ code mapping** | Derived; human-confirmed |

### Ownership has two axes

- **Domain** (the tree): what you own. One accountable owner per node; authorities hold scopes across it. A junior petitions upward; a solo developer sits at the root with visibility into every branch.
- **Stage** (maturity): which transitions you have authority over — prototyper, developer, scaler, maintainer. These are **modes**, not necessarily people. A small organisation has one owner move a feature through them; a large one may split them across people, with the design record as the contract that makes the handoff survivable.

Features are a tree for authority but a **graph for effect**: cross-cutting concerns (observability, auth, billing) touch many subtrees. A change touching three subtrees needs three owners. That is where today's meetings come from, and where pjman earns its place by deriving the approvers.

### Rubrics are entities

An owner's standards (regressions, standardisation, state management; a design authority's conventions) are declared as **criteria**, versioned in the tree, and run by agents on every change beneath that node. How agents check them improves for free as models improve. Trust in a rubric is earned on record (seeded regressions, caught versus missed), so accountability for it stands up to a question.

A **maturity level is a rubric plus a required evidence grade.** The prototype rubric is loose and optimises for speed; the scaled rubric is strict. Moving a feature up a level means passing the next rubric with stronger evidence.

### Maturity is a claim plus evidence

Evidence comes in grades: **production telemetry** (it has held N) > **simulation** (load tests say it would) > **analysis** (an agent read the design and says it should). Levels are thresholds on evidence, not labels someone picks. A feature claiming *scaled* on analysis-grade evidence is drift. Connected data sources (a warehouse MCP) raise the grade; without them the agent says what it can at lower confidence. pjman stores the citation and the confidence, never the data — it is not a BI tool.

Scale is the first axis. Correctness, operability and security are further evidence types in the same shape.

## The lifecycle

**Request → Triage → Design → Approval → Execution → Acceptance → Sustain**

1. **Request.** Anyone, from anywhere: a message board, a developer, a product manager, a customer. Buckets: add, update, fix, retire. *Questions* ("does this exist?", "is this in flight?") are answered by the agent from the graph — often the best outcome of intake is no change at all. A bug report is observed-state evidence arriving through a human and attaches to the feature.
2. **Triage.** The step that leaves good ideas at the back of endless queues today. Agents turn the vague ask into a workable request: which node (or proposed node), which bucket, target maturity, who it affects, whether it duplicates an existing request or change. It lands on the owner's node as a petition; triage is the first bounded ask.
3. **Design.** People cannot decide when nothing is built, and execution is cheap — so **build before deciding**. "More upfront work" means upfront building, not upfront documents. Agents, grounded in the derived architecture, produce two or three **built variants** on the real data model with trade-offs stated. **Taste wants options, not questions.** Agents list what the design forces before anyone commits — the decisions it implies, the scale limit it hits, the data it needs that does not exist — so the hard parts surface before the build, not during it.
4. **Approval.** Approvers are **derived from the design record's deltas**: a visual delta routes to the design authority, a data delta to that domain's data architect, a second subtree to its owner. Nobody thinks about who must be in the room. Each gets a **bounded ask**: a specific question, a recommended answer, a deadline, and a declared default if nobody responds (lazy consensus, per-authority terms). Each authority's rubric is pre-run by agents so the design arrives already checked and the human approves exceptions. Discussion attaches to the record; decisions are extracted from it with names on them. **Authorizing the intent and accepting the result are separate moments.**
5. **Execution.** Agents build from the graph — the design record, the architecture, the rubric — with enough context to plan, build and validate. Declared through the MCP at authoring time ("this session is Change X on Feature Y"); verified at merge time by a check that cannot be bypassed.
6. **Acceptance.** The owner signs a **brief**, not a diff: intent, scope and blast radius, **deviations** from the approved design and the choices the agent made on its own, evidence against the rubric, fitness for the target maturity. The diff is an appendix. The brief is written by a different agent than the one that did the work — separation of duties. Results go back to every authority as *what shipped against what you approved*.
7. **Sustain.** Drift detection, evidence upkeep, retirement. The maintainer mode, and the most automatable of the four — most of what pjman does on its own.

## Surfaces

- **Local MCP** — the graph where the work happens, in whatever agent the developer uses. Agent-agnostic by design.
- **Web agent** — the same graph for everyone else: answers questions, files requests on the user's behalf. Acts with the user's authority; cannot approve for an owner. Permissions follow the tree on every surface.
- **Merge check** — a CI hook against the code host: the gate that cannot be bypassed.
- **Integrations** — code hosting and CI/CD first (reliable hooks); data sources as evidence connectors; design tools as artefact sources, not replacements.

## The durability test

For every piece: *does it get more or less valuable if models get 10× better?*

| Build here (more valuable) | Keep thin (less valuable) |
|---|---|
| The product graph and its history | Step sequencing and wizards |
| Who decided what, and why | Prompt templates |
| Approval gates, permissions, defaults | Decomposition into tickets |
| Verification evidence and briefs | Role-specific hand-holding |
| Rubrics as criteria | How a rubric is checked |
| Declared maturity requirements | How a prototype is produced |

Workflows are **declarative, not procedural**: each stage defines what must be true and who must sign. How agents get there is their business and improves on its own.

## Adoption

- **Solo:** one person at the root of the tree. pjman is built with pjman from the first commit; the founding conversation is the first request and its locked decisions are the first entries.
- **A team:** adopts its own subtree without the rest of the organisation (an observability team owns all things observability). Alone it gets declared-versus-observed for its domain, a graph its agents can read, and a structured intake replacing chat. Every team that petitions it sees the product. Nodes come online as owners buy in.
- **Brownfield:** agents derive the feature map and architecture from an existing codebase and its history. Greenfield is the easier first wedge; brownfield is where the money is.

## Positioning (open)

The gap: the labs and harnesses own execution; the trackers own tickets; nobody owns the model of what the product is, its state, its maturity and why. Acquirers in this space pay for a team, a product a segment depends on daily, or a data position they cannot rebuild — the last two are also what make a standalone business, so the plan is the same either way: a handful of real teams depending on it.

## Decisions locked (2026-10-05 → 2026-10-07)

1. The thesis: alignment is hard, execution is easy.
2. Not all-in-one; own the model and workflows, integrate with systems of record.
3. Declared versus observed state; drift is first-class; reconciliation at merge time is the core loop.
4. Humans author only decisions; agents draft everything else for approval.
5. Ownership is a tree (one accountable owner per node) with discipline authorities holding scopes across it; features are a graph for effect.
6. Approvers are derived from a design record's deltas, never configured.
7. Authorizing intent and accepting the result are separate moments.
8. The acceptance artefact is a brief, written by a separate agent; the diff is an appendix.
9. Rubrics are versioned criteria; a maturity level is a rubric plus a required evidence grade.
10. Maturity is a claim plus graded evidence; pjman stores citations and confidence, never data.
11. Build before deciding: grounded variants with stated trade-offs; forcing questions surfaced before the build.
12. Bounded asks with recommended answers, deadlines and defaults.
13. Stages (prototyper / developer / scaler / maintainer) are modes the model supports; the model is agnostic about whether one person or four hold them.
14. Intake buckets: add, update, fix, retire; questions are answered, not queued.
15. Surfaces: local MCP, web agent, merge check; agent-agnostic.
16. No special paths per discipline for the scaffolding; the general derived-approver mechanism must cover them.

## Open questions

- What exactly a "feature" is — the core opinion of the product, and not obvious; product, design and engineering mean different things by the word.
- The minimum a human must see to sign — the brief's fields, to be refined against real sign-offs.
- Where declared state lives first (files in the repo versus a service) — deliberately not decided; implementation has not started.
- Positioning: the first customer, what they pay for, how it reads next to Linear and the harnesses.
- The name.
