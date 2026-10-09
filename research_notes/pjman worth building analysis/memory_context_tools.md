# Memory and persistent-context tools for AI coding agents — landscape as of 2026-10-09

Scope: the "memory / context layer" category and how closely each player overlaps pjman Phase 1 (typed records — change / feature / decision / source — with typed edges, markdown files in git, harness-agnostic, authored-vs-derived, local files → hosted graph). All GitHub star counts marked "fetched 2026-10-09" were read from the repository page on that date; older numbers are dated to their source. Where a tool does NOT do something pjman does, that absence is stated explicitly.

---

## Key question 1 — Who are the players, what do they store, how, under what licence, with what traction?

### Takeaway
The category is large, well funded and almost entirely about **facts**: extracted preferences, conversation summaries, entity/relationship graphs, or code-structure graphs. The closest things to pjman's "structure of work" are not the memory vendors but three git-native tools — **Beads** (dependency-graph issue tracker in git, 27.8k stars), **Entire** (agent-session checkpoints in git refs, $60M seed) and **Spec Kit** (spec → plan → tasks as repo files, ~115k stars) — none of which models decisions-with-rationale, external bindings or ownership as first-class typed records.

### Cited Findings

#### Mem0 (San Francisco; YC)
- Raised **$24M combined Seed + Series A**, announced **2025-10-28**; Series A led by Basis Set Ventures, seed led by Kindred Ventures; Peak XV, GitHub Fund, Y Combinator and angels (Scott Belsky, Dharmesh Shah, CEOs of Datadog, Supabase, PostHog). At announcement: **41,000 GitHub stars, 14M downloads, API calls 35M (Q1 2025) → 186M (Q3 2025)**; "exclusive memory provider for AWS Agent SDK". — [PR Newswire, 2025-10-28](https://www.prnewswire.com/news-releases/mem0-raises-24m-series-a-to-build-memory-layer-for-ai-agents-302597157.html)
- GitHub (fetched 2026-10-09): **66.9k stars, 7.9k forks, Apache-2.0**. Storage: vector embeddings (default `text-embedding-3-small`) with hybrid semantic + BM25 + entity-linking retrieval; an LLM (default GPT-5-mini) **extracts facts from conversations**. Deployment: `pip install mem0ai` library, self-hosted Docker server, or managed cloud (app.mem0.ai). Coding-agent angle: "Teach your AI coding assistant (Claude Code, Codex, Cursor, Windsurf, OpenCode, OpenClaw)" via skills; a "New Memory Algorithm (April 2026)" claims LoCoMo 92.5 / LongMemEval 94.4. — [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)
- Mem0 publishes a Claude Code integration (hooks + MCP) explicitly positioned as the fix for auto memory being machine-local. — [mem0.ai/library/coding-agents/claude-code-memory](https://mem0.ai/library/coding-agents/claude-code-memory)
- **What Mem0 stores**: "conversation context and user preferences" (press release wording). It does **not** store a unit of work, a plan, a decision record with rationale, a binding to a ticket, or an owner. — [PR Newswire](https://www.prnewswire.com/news-releases/mem0-raises-24m-series-a-to-build-memory-layer-for-ai-agents-302597157.html)
- Star-count discrepancy across secondary sources (37k, 41k, 48–51k) reflects snapshot dates; the primary repo page read on 2026-10-09 shows 66.9k. — [BW Disrupt](https://www.bwdisrupt.com/article/mem0-raises-24-mn-from-basis-set-ventures-peak-xv-partners-others-577381); [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)

#### Cognee (Berlin)
- **$7.5M seed, announced 2026-02-19**, led by Pebblebed (Pamela Vagata, Keith Adams), with 42CAP, Vermilion Ventures and angels from Google DeepMind, n8n, Snowplow. Traction at announcement: pipeline runs 2,000 (2024) → 1M (2025); **70+ production customers**; **12,000+ GitHub stars**; 80+ contributors; named users Bayer, University of Wyoming, dltHub. Stores across **three layers: relational, vector, knowledge graph** via an "ECL" (Extract, Cognify, Load) pipeline; integrates with Claude Agent SDK, OpenAI Agents SDK, LangGraph, Google ADK, n8n, Neptune, Neo4j; cloud platform + open-source core; a Rust engine for on-device use is planned. — [cognee.ai blog, 2026-02-19](https://www.cognee.ai/blog/cognee-news/cognee-raises-seven-million-five-hundred-thousand-dollars-seed)
- GitHub (fetched 2026-10-09): **31.9k stars, 3.3k forks, Apache-2.0**; v1.0 lets the whole memory layer run on a single Postgres (graph state + PGVector + relational metadata); offline mode with GLiNER local extraction; embedded Kuzu/LanceDB options; MCP server (`cognee-mcp`); **official Claude Code memory plugin via marketplace**; Cursor/Cline via MCP; latest release **v1.6.1 on 2026-09-24**. — [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee)
- June 2026 self-report: ~6M memories created monthly across 100+ companies (secondary source; not verified against a primary). — [EU-Startups, 2026-02](https://www.eu-startups.com/2026/02/german-ai-infrastructure-startup-cognee-lands-e7-5-million-to-scale-enterprise-grade-memory-technology/)
- **What Cognee stores**: an entity/relationship graph derived from documents and conversations. It does **not** have a unit-of-work record, authored decision records, ticket bindings or ownership.

#### claude-mem (Alex Newman / thedotmack)
- GitHub (fetched 2026-10-09): **99k stars, 8.7k forks, Apache-2.0**; version 13.35.0. Stores "observations" captured from tool use and "summaries", in **SQLite + Chroma vector DB**; observation types include `decision`, `bugfix`, `security_alert`, `sensitive` as dated entries; a "3-layer workflow" (search index → timeline → full observation) to limit tokens. Supported harnesses: Claude Code, Gemini CLI, OpenCode, Codex, Cursor, Grok Bot, T3 Code, DeepSeek Harness, Pi, OpenClaw. — [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- Earlier snapshots: 46.1k, 65.8k, 72.4k stars reported by Augment Code's tracking posts in 2026 (dates per post; the growth curve is steep). — [augmentcode.com (65.8k post)](https://www.augmentcode.com/learn/claude-mem-65k-stars); [augmentcode.com (46.1k post)](https://www.augmentcode.com/learn/claude-mem-46k-stars-persistent-memory-claude-code)
- Mechanism: five lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) record what Claude does; AI-compressed summaries are injected at the next session start; no manual effort. — [augmentcode.com](https://www.augmentcode.com/learn/claude-mem-persistent-memory-claude-code)
- **Overlap note**: claude-mem is the one memory tool that *tags* observations as `decision`, but these are **derived** (model-extracted from tool use), stored in SQLite/Chroma not as human-readable records in git, not authored by a person, carry no rationale schema, no ticket binding, no owner. It is **observed state about sessions**, i.e. the layer pjman calls "Session — derived from the harness". — [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)

#### Unblocked (Vancouver; founded 2021, CEO Dennis Pilarinos)
- **US$20M Series A** led by B Capital with Radical Ventures and Artisanal Ventures (announced 2025). — [getunblocked.com/blog/series-a](https://getunblocked.com/blog/series-a/)
- "The next era of Unblocked: context for agents", **2026-04-28**: ingests code, Slack, Jira, Confluence, Notion and internal docs; serves agents through an **MCP server (GA)** and a CLI; supports Claude, Cursor, Codex, Copilot; claims "tens of thousands of developers" daily; internal experiment: Kotlin SDK task 2.5h → 25min with zero corrections. Explicitly captures "why decisions were made and what the constraints are", including "Slack conversations where real architectural decisions get made". — [getunblocked.com, 2026-04-28](https://getunblocked.com/blog/unblocked-context-engine-for-agents/)
- By August 2026 it described its largest customers as "well over 100,000 repositories with tens of thousands of engineers" (company blog). — [getunblocked.com/blog/best-engineering-knowledge-platforms-ai-coding-agents-2026](https://getunblocked.com/blog/best-engineering-knowledge-platforms-ai-coding-agents-2026/)
- **What Unblocked stores / does not**: a hosted, proprietary index of *existing* artefacts (it mines decisions from Slack/PRs — **derived**, not authored); closed source; no local-first mode found; no schema a user owns; no unit-of-work record; it reads tickets as sources rather than binding a change to one. — [getunblocked.com, 2026-04-28](https://getunblocked.com/blog/unblocked-context-engine-for-agents/)

#### Graphify (YC S26; Yyunozor)
- Repo README (fetched 2026-10-09): **Apache-2.0 / MIT dual**; YC batch S26; "local deterministic AST parsing" with tree-sitter; **no vector store**; outputs `graphify-out/graph.json`, `graph.html`, `GRAPH_REPORT.md` meant to be committed to git; typed edges (imports, calls, contains) with `EXTRACTED` / `INFERRED` / `AMBIGUOUS` confidence tags; installs as a skill across **20+ assistants** (Claude Code, Cursor, Codex, Copilot CLI, Gemini CLI, Aider, OpenCode, Kiro, Devin, Antigravity…); a query log (`~/.cache/graphify-queries.log`) and `graphify reflect` that aggregates into `LESSONS.md`; hosted "always-on enterprise layer" at graphify.com with a waitlist. (The GitHub page rendered 0 stars in my fetch — a rendering glitch; see secondary count below.) — [github.com/Yyunozor/graphify](https://github.com/Yyunozor/graphify)
- Secondary tracking: **63.2k stars, 6.5k forks, 130 releases** (2026, Augment Code post). — [augmentcode.com](https://www.augmentcode.com/learn/graphify-63k-stars-knowledge-graphs)
- **What Graphify stores**: a **derived code-structure graph** (plus docs/PDFs). It has the closest *storage shape* to pjman (typed, explained edges, JSON in git, harness-agnostic skill, local → hosted) but **no authored layer**: no decision records, no unit of work, no ticket binding, no owner. The `LESSONS.md` reflect step is derived learnings, not decisions. — [github.com/Yyunozor/graphify](https://github.com/Yyunozor/graphify)
- Gap: the YC company page returned 404 on fetch; funding amount not found from a primary source.

#### Letta (ex-MemGPT; Berkeley)
- **$10M seed** led by Felicis with Founders Fund and YC, ~$70M post-money, announced **September 2024** (older information). — [HPCwire/BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/letta-emerges-from-stealth-with-10m-to-build-ai-agents-with-advanced-memory/)
- GitHub `letta-ai/letta` (fetched 2026-10-09): **25.1k stars, 2.6k forks, Apache-2.0**; main development has moved to `letta-ai/letta-code` ("the agent harness, interactive terminal UI, App Server, channels, and the runtime"); Letta Cloud plus self-host. — [github.com/letta-ai/letta](https://github.com/letta-ai/letta)
- **Letta Code** (launched as a "memory-first coding agent"; Letta Code app **2026-04-06**): memory is **MemFS, "a git-backed memory filesystem that [agents] can inspect and edit"** holding facts, project knowledge, preferences and lessons; `/init`, `/remember`, background "dreaming" consolidation, `/doctor` to reorganise. — [docs.letta.com/letta-code/memory](https://docs.letta.com/letta-code/memory); [letta.com blog, 2026-04-06](https://www.letta.com/blog/introducing-the-letta-code-app/); [HackerNoon](https://sia.hackernoon.com/letta-unveils-memory-first-coding-agent-as-context-engineering-takes-hold)
- **Absence**: Letta's memory is **bound to its own harness** (Letta Code) — it is itself an agent, which pjman's thesis says it will not be. No unit-of-work records, no decision schema, no ticket binding, no owner. No 2026 funding round was found (search returned only noise).

#### Zep / Graphiti
- Graphiti GitHub (fetched 2026-10-09): **31.6k stars, 3.2k forks, Apache-2.0**; a **bi-temporal knowledge graph** of entities/relationships/facts with validity windows and provenance to "episodes"; backends Neo4j 5.26+, FalkorDB, Amazon Neptune, Kuzu (deprecated); MCP server; REST service. Zep is the managed "Context Graph Engine". — [github.com/getzep/graphiti](https://github.com/getzep/graphiti)
- arXiv paper "Zep: A Temporal Knowledge Graph Architecture for Agent Memory" (January 2025). — [arxiv.org/abs/2501.13956](https://arxiv.org/html/2501.13956v1)
- Zep positions itself as "unified context for enterprise data… shared, governed context for agents". — [getzep.com](https://www.getzep.com/)
- Funding: YC W24; secondary aggregators conflict (**$500K** vs **$3.3M** from Engineering Capital, Step Function et al.). No primary source found; treat as unverified. — [startuphub.ai](https://www.startuphub.ai/startups/getzep-com); [cbinsights](https://www.cbinsights.com/compare/mem0-vs-zep-2)
- **Absence**: facts with time validity, not authored decisions; no unit of work, no ticket binding, no ownership.

#### LangMem (LangChain)
- SDK launched February 2025 (older information): "extract information from conversations, optimize agent behavior through prompt updates, and maintain long-term memory about behaviors, facts, and events"; uses `trustcall` for "type-safe memory consolidation & invalidation"; works with any storage, integrates natively with LangGraph's store. — [blog.langchain.com/langmem-sdk-launch](https://blog.langchain.com/langmem-sdk-launch); [pypi.org/project/langmem](https://pypi.org/project/langmem)
- **Absence**: a library for LangGraph builders, not a coding-agent product; no files-in-git, no decision records, no bindings. No 2026 star/traction figure found.

#### Supermemory
- **$3M pre-seed** led by Susa Ventures (Browder Capital, SF1), announced **2025-10-06**. — [supermemory.ai blog](https://supermemory.ai/blog/supermemory-raises-3-million-and-building-the-best-memory-engine-for-llms/)
- Closed source, cloud-only, MCP server; LongMemEval 81.6% (per competitor Vectorize's comparison; treat as partisan). — [vectorize.io](https://vectorize.io/articles/hindsight-vs-supermemory)

#### Hindsight (Vectorize)
- MIT open source, self-host via Docker, "MCP-first", claims **94.6% LongMemEval**; ships `hindsight-cursor` / `hindsight-cursor-cli` (June 2026) and a Codex integration (April 2026) via lifecycle hooks — i.e. a cross-harness fact-memory layer. — [vectorize.io](https://vectorize.io/articles/hindsight-vs-supermemory); [hindsight.vectorize.io, 2026-06-12](https://hindsight.vectorize.io/blog/2026/06/12/cursor-persistent-memory); [hindsight.vectorize.io, 2026-04-08](https://hindsight.vectorize.io/blog/2026/04/08/adding-memory-to-codex-with-hindsight)

#### Git-native "structure of work" tools (closest to pjman's shape)

**Beads (Steve Yegge; now `gastownhall/beads`)**
- Announced **2025-11-12**: "a coding agent memory system" built after a failed 350k-line project; replaces markdown plans with a **dependency-aware graph**. — [steveyegge.spicytakes.org, 2025-11-12](https://steveyegge.spicytakes.org/post/2025-11-12-introducing-beads-a-coding-agent-memory-system)
- GitHub (fetched 2026-10-09): **27.8k stars, 1.9k forks, MIT**; "distributed graph issue tracker for AI agents, powered by Dolt"; stores issues with priority/type/assignee/status and **typed dependencies: blocks, parent-child, related-to, duplicates, supersedes, replies-to**; `bd remember` for project insights injected at `bd prime`; storage is a Dolt DB in `.beads/` (JSONL export is interchange, not truth); sync via `refs/dolt/data` on git remotes; documented integrations for Claude Code, Codex CLI, Factory Droid, Copilot (MCP), Cursor. **No GitHub Issues / Jira / Linear sync; no hosted offering.** — [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
- **Overlap**: Beads is the nearest existing thing to "unit of work with typed edges in git, harness-agnostic". **Absence**: no decision record type with rationale, no authored-vs-derived separation, no binding to an external ticket identity, no feature tree, no ownership model beyond `assignee`; truth is a Dolt database, not human-readable files.

**Entire (Thomas Dohmke, ex-GitHub CEO)**
- **$60M seed at $300M valuation, 2026-02-10**, led by Felicis; Madrona, M12, Basis Set, 20VC, Cherry, Picus, GFC; angels incl. Gergely Orosz, Garry Tan. Ships "Checkpoints": agent prompts, transcripts, tool calls stored in git; aims to unify "code, intent, constraints, and reasoning in a single version-controlled system"; hosted platform "later in 2026". — [entire.io news, 2026-02-10](https://entire.io/news/former-github-ceo-thomas-dohmke-raises-60-million-seed-round/)
- CLI repo (fetched 2026-10-09): **5.2k stars, 484 forks, MIT**; checkpoints at `refs/entire/checkpoints/<shard>/<id>` containing `metadata.json`, transcripts, subagent records; supported agents Antigravity, Claude Code, Codex, Copilot CLI, Cursor, Factory Droid, OpenCode, Pi; optional AI summaries record "intent, outcome, learnings, friction points, and open items" but "the core system primarily documents the interaction history rather than narrative decision-making". — [github.com/entireio/cli](https://github.com/entireio/cli)
- **Overlap**: harness-agnostic, git-native, local → hosted, and it is the best-funded bet that "why" belongs in version control. **Absence**: it captures **derived session evidence only**; no authored decision records, no unit-of-work object above the commit, no ticket binding, no ownership.

**GitHub Spec Kit / OpenSpec**
- Spec Kit (MIT; open-sourced September 2025) organises work as Specify → Plan → Tasks → Implement with repo files; reported **~115,000 stars by June 2026**. OpenSpec uses Propose (delta specs) → Apply → Archive. — [Visual Studio Magazine, 2025-09-03](https://visualstudiomagazine.com/articles/2025/09/03/github-open-sources-kit-for-spec-driven-ai-development.aspx); [codemyspec.com](https://codemyspec.com/blog/openspec-vs-spec-kit)
- **Absence**: spec/plan/tasks are prose documents per feature, not typed records with edges; no decision type, no bindings, no owner, no index/query layer.

**SpecStory**
- Saves every Cursor / Copilot conversation to `.specstory/history/` as markdown; for Claude Code, Cursor CLI, Codex CLI, Droid CLI a wrapper reads `~/.claude/projects/` JSONL and converts to markdown in the repo. — [docs.specstory.com](https://docs.specstory.com/specstory/introduction); [docs.specstory.com/integrations/terminal-coding-agents](https://docs.specstory.com/integrations/terminal-coding-agents)
- **Absence**: raw session transcripts, no structure.

**memory-trail (frmoretto)** — a markdown protocol: `docs/DECISION_MEMORY.md` with status Proposed/Active/Superseded/Deprecated plus per-task session logs citing decisions; CC BY 4.0; **3 stars**; aimed at 1–5-person teams. Evidence that the *idea* of decision + session records exists, with negligible adoption. — [github.com/frmoretto/memory-trail](https://github.com/frmoretto/memory-trail)

### Inferences
- Every funded memory vendor (Mem0, Cognee, Zep, Letta, Supermemory, Unblocked) stores **facts or derived graphs**; none has a schema for a unit of work, an authored decision, or a binding to an external identity. pjman's "not a memory tool" positioning is factually distinct from all of them.
- The tools whose *shape* resembles pjman (Beads, Entire, Graphify, Spec Kit) each cover one layer — issues, session evidence, code graph, spec documents — and none joins them under one schema with authored/derived separation. pjman's claimed gap exists at the **join**, not in any one layer.
- Adoption signals favour git-native, file-based, harness-agnostic tools: claude-mem (99k), Spec Kit (~115k), Graphify (~63k), Beads (27.8k) all grew in <18 months. This supports pjman's distribution choice (files in git, skill/MCP adapters).

### Gaps
- Graphify's funding amount, team and YC page (404 on fetch); its true current star count (repo page mis-rendered; 63.2k is a secondary 2026 number).
- Zep's total raised (aggregators conflict: $500K vs $3.3M; no primary).
- Letta: no 2026 funding or traction figures found; `letta-code` repo stats not fetched.
- LangMem: no adoption figures found.
- Nauro: an MCP directory listing describes "Nauro" as a decisions-in-markdown system across Claude/Cursor/Codex, but nauro.ai itself describes an AI testing platform "in development"; the two may be different products or a pivot. Could not verify; do not cite as a competitor without checking.

---

## Key question 2 — What do the labs' harnesses do natively (Claude Code, Cursor, Codex, Copilot, Gemini CLI, Kiro)? Which persist plans or decisions across sessions?

### Takeaway
Every major harness now has a native instruction file plus some form of automatic, machine-local or repo-scoped fact memory (Claude Code auto memory, Copilot Memory, Gemini `save_memory`, Windsurf Memories, Codex memories in preview). **None persists a unit of work bound to a ticket, authored decisions with rationale, or ownership; plan persistence exists only as loose files (Claude Code `~/.claude/plans`, Kiro `.kiro/specs`, Cursor Projects' cloud files) and is documented as unreliable in at least one case.** Cursor *removed* its Memories feature in 2.1.

### Cited Findings

#### Claude Code (Anthropic)
- Two mechanisms: **CLAUDE.md** (you write; project/user/org/managed scopes; `.claude/rules/` with `paths:` frontmatter) and **auto memory** (Claude writes). Auto memory saves four kinds with a `type` frontmatter field: `user`, `feedback`, `project` ("ongoing work, deadlines, and decisions that Claude can't derive from the code or git history"), `reference` ("where to find information outside the project, such as an issue tracker or dashboard"). Stored at `~/.claude/projects/<project>/memory/` with a `MEMORY.md` index (first 200 lines / 25KB loaded each session) and topic files; a `modified` ISO timestamp is stamped on frontmatter (v2.1.214+). **"Auto memory is machine-local… Files are not shared across machines or cloud environments."** Self-hosted environments default auto memory off. — [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Auto memory on by default since **v2.1.59 (February 2026)**. — [claudedirectory.org guide](https://www.claudedirectory.org/blog/claude-code-auto-memory-guide); [vectorize.io](https://vectorize.io/articles/claude-code-memory)
- Reads **AGENTS.md** natively (v2.1.277+); `/init` migrates Cursor rules, Copilot instructions, `.windsurfrules`, `.clinerules`; `/import` pulls another agent's config; `/doctor prompt-audit` flags stale or contradictory instruction files (v2.1.283+). — [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- **Plans**: approved plan-mode plans are `.md` files, by default in `~/.claude/plans/` (global, random slug); `plansDirectory` setting can move them into the repo. — [claudelog.com](https://claudelog.com/faqs/what-is-plans-directory-in-claude-code/); [wmedia.es](https://wmedia.es/en/tips/claude-code-plan-mode-plan-file-repo)
- Issue #54720 (opened 2026-04-29, closed 2026-05-31): a new session did not pick up the saved plan; plans live at `~/.claude/plans/<random-slug>.md` "with no project linkage, timestamp, or manifest"; the model reported "nothing pending" while the plan file existed — a **silent** failure. — [claudeissues.com/issue/54720](https://claudeissues.com/issue/54720-plan-pickup-is-broken-you-told-users-a-new-session-resumes-it-doesnt)
- Related: "Plan mode persistence causes stale context to bleed across sessions" and "Plan from previous session auto-injected and executed in new session" are both filed issues. — [claudeissues.com/issue/12838](https://claudeissues.com/issue/12838-bug-plan-mode-persistence-causes-stale-context-to-bleed-across-sessions); [claudeissues.com/issue/34782](https://claudeissues.com/issue/34782-plan-from-previous-session-auto-injected-and-executed-in-new-session)
- **Absence**: no typed records, no edges, no binding to a ticket (auto memory's `reference` type is free text), no ownership, no team sharing of auto memory, no export schema.

#### Cursor
- **Memories removed in 2.1 (November 2025)**: forum threads "Custom modes and memories gone in 2.1", "Are my memories gone?", "Memory tool disappeared"; users told to export memories to an `.mdc` file and add them as Rules. — [forum.cursor.com 143744](https://forum.cursor.com/t/custom-modes-and-memories-gone-in-2-1/143744); [forum.cursor.com 144057](https://forum.cursor.com/t/are-my-memories-gone/144057); [cursor.com/changelog/2-1](https://cursor.com/ja/changelog/2-1)
- Docs today describe only **Rules** ("persistent, reusable context at the prompt level"; `.cursor/rules/*.mdc`, version-controlled, path-scoped) and AGENTS.md; no Memories page. — [cursor.com/docs/context/memories (redirects to rules content)](https://cursor.com/docs/context/memories)
- **Cursor Projects** launched **2026-09-10** (beta): a cloud-running coordinator agent for "a feature, a migration, or a full app" that "maintains context over months of work"; "Each Project maintains a set of files that sync across every cloud and local machine"; "context moves through files, not through the conversation"; agents "add research and artifacts, along with what they learn about the codebase". — [cursor.com/changelog/projects](https://cursor.com/changelog/projects); [flaviocopes.com](https://flaviocopes.com/cursor-projects/); [eesel.ai](https://www.eesel.ai/blog/cursor-projects)
- Automations have their own per-automation `MEMORIES.md` notes. — [memorylake.ai](https://www.memorylake.ai/en/blogs/guard-cursor-automations-memories)
- **Absence**: Projects is a Cursor-hosted, Cursor-only container of prose files; no typed decision records, no ticket binding, no ownership, no open schema or export found.

#### OpenAI Codex
- AGENTS.md is the instruction layer (global `~/.codex/AGENTS.md`, override file, concatenated from repo root to cwd); the AGENTS.md spec now sits under the Linux Foundation's Agentic AI Foundation. — [github.com/openai/codex/discussions/12567](https://github.com/openai/codex/discussions/12567); [mem0.ai blog](https://mem0.ai/blog/how-memory-works-in-codex-cli)
- **Memories** (discussion opened 2026-02-23): project-scoped and optional global memories extracted from session history, credential sanitisation, time-decay; status experimental ("Do not try to use the memories for now as the rate limits would consume all your tokens"); maintainer @jif-oai asking whether to enable by default in `codex exec` and SDKs. Community framing: "AGENTS.md as the manual contract… memories the autonomous layer." — [github.com/openai/codex/discussions/12567](https://github.com/openai/codex/discussions/12567)
- Open issues propose a topic-based memory directory and `/memory` command modelled on Claude Code's layout. — [github.com/openai/codex/issues/19758](https://github.com/openai/codex/issues/19758); [issue #8368](https://github.com/openai/codex/issues/8368)
- **Absence**: nothing for plans/decisions/tickets/ownership; memory itself not GA as of the discussion.

#### GitHub Copilot
- **Copilot Memory** on by default for Pro/Pro+ in public preview, **2026-03-04**: stores "useful facts about a repository (e.g., coding conventions, architectural patterns, and critical cross-file dependencies)"; **strictly scoped to a single repository**; **memories expire after 28 days**; validated against the current codebase before use; shared across Copilot coding agent, code review and CLI; admin policy control. — [github.blog changelog, 2026-03-04](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/)
- **Absence**: facts only; no plans, decisions, tickets (despite GitHub owning Issues), or ownership; hosted by GitHub, no local files.

#### Gemini CLI (Google)
- Hierarchical **GEMINI.md** (global `~/.gemini/`, project, subdirectory); `/memory add|show|refresh`; a `save_memory` tool that appends a natural-language `fact` under `## Gemini Added Memories` in `~/.gemini/GEMINI.md`. — [geminicli.com/docs/tools/memory](https://geminicli.com/docs/tools/memory); [philschmid.de cheatsheet](https://www.philschmid.de/gemini-cli-cheatsheet)
- **Absence**: flat facts in one file; nothing structured.

#### Amazon Kiro
- **Steering files** in `.kiro/steering/` (workspace) or `~/.kiro/steering/` (global) with inclusion modes always / fileMatch / manual / auto. — [kiro.dev/docs/steering](https://kiro.dev/docs/steering/)
- **Specs**: per-feature `requirements.md` (or `bugfix.md`), `design.md`, `tasks.md` in `.kiro/specs/`; "specs stay in sync with your codebase" bidirectionally per AWS write-ups. — [kiro.dev/docs/specs](https://kiro.dev/docs/specs/); [builder.aws.com](https://builder.aws.com/content/3DbBI7LQgNIcs6UUj7IPPvqFHOp/aws-kiro-the-agentic-ide-that-makes-specs-the-unit-of-work)
- **Absence**: specs are Kiro's own three-document workflow; the docs mention no decision records, no rationale field, no Jira/Linear binding, no ownership, no export to other agents.

#### Windsurf (Cognition)
- Cascade auto-generates **Memories** "if it encounters context that it believes is useful"; workspace-scoped; plus manual Rules; no credit cost. — [docs.devin.ai/windsurf/plugins/cascade/memories](https://docs.devin.ai/windsurf/plugins/cascade/memories)

### Inferences
- The labs have converged on two primitives — an instruction file (CLAUDE.md / AGENTS.md / GEMINI.md / steering) and machine- or repo-local *fact* memory — and are now adding a third, the long-running *project container* (Cursor Projects, Kiro specs). None has moved toward typed, queryable, authored records with cross-tool identity. The direction of travel is toward **hosted, harness-locked** containers (Cursor Projects runs in Cursor's cloud; Copilot Memory lives in GitHub), which is the opposite of pjman's portable-schema bet.
- Claude Code's auto memory types (`project`: "ongoing work, deadlines, and decisions"; `reference`: issue trackers) show Anthropic sees the same need, but implements it as free-text notes, per machine, with no schema — a weak, non-portable version of pjman's decision/source records.
- Cursor's removal of Memories and Copilot's 28-day expiry are evidence that the labs themselves found unstructured auto-memory to be a staleness liability.

### Gaps
- No lab has published a roadmap item for cross-tool decision or plan persistence; I found only community issues (Codex #19758, #8368) and the Codex memories discussion.
- Cursor Projects' underlying file format and whether it can be exported were not found in docs (the `/docs/projects` page 404'd).
- Kiro's docs page did not state whether specs link to tickets; absence in docs, not a confirmed "no".

---

## Key question 3 — Does ANY tool persist decisions-with-rationale, a unit of work bound to an external ticket, or ownership?

### Takeaway
**No tool found does all three, and none does the binding or ownership as a first-class record.** Decisions-with-rationale exist only as (a) derived extraction (Unblocked mining Slack; claude-mem tagging `decision` observations; Entire's AI summaries of "intent"), (b) free-text notes (Claude Code auto memory `project` type), or (c) hand-rolled ADR conventions (Davidson's `docs/decisions` + AGENTS.md; memory-trail at 3 stars). Unit-of-work-with-typed-edges exists in Beads but without ticket binding, authored decisions or ownership.

### Cited Findings
- **Beads**: issue records with typed dependency edges (blocks, parent-child, related-to, duplicates, supersedes, replies-to), `assignee` and status; "No mention of GitHub Issues, Jira, or Linear sync"; no hosted offering. — [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
- **Entire**: records "intent, outcome, learnings, friction points, and open items" via optional AI summaries, but "primarily documents the interaction history rather than narrative decision-making". — [github.com/entireio/cli](https://github.com/entireio/cli)
- **claude-mem**: observation types `decision`, `bugfix`, `security_alert`, `sensitive` — derived from tool use, stored in SQLite/Chroma. — [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Unblocked**: captures "why decisions were made" by indexing Slack/PRs/Jira (derived; hosted; closed). — [getunblocked.com, 2026-04-28](https://getunblocked.com/blog/unblocked-context-engine-for-agents/)
- **Claude Code auto memory**: a `project` note type for "ongoing work, deadlines, and decisions" and a `reference` type for "an issue tracker or dashboard" — free text, machine-local. — [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- **Decision-record practice** (not a tool): Duncan Davidson, 2026-09-01, keeps ADRs in `docs/decisions` with AGENTS.md guidance; reports an agent "preserved an outdated storage abstraction across a new feature because an ADR still described it as mandatory"; says memory systems "preserve context without establishing whether it is accurate, current, or accepted by the human team." — [duncandavidson.com/agents-love-decisions](https://duncandavidson.com/agents-love-decisions)
- A second practitioner taxonomy proposes ADR / PDR (product) / DDR (design) records as "a reviewed, durable, human-approved source of project intent" for agents. — [glukhov.org](https://glukhov.org/app-architecture/documentation/decision-records-ai-driven-development/)
- **memory-trail**: `DECISION_MEMORY.md` with Proposed/Active/Superseded/Deprecated status plus session logs citing decisions; CC BY 4.0; 3 stars. — [github.com/frmoretto/memory-trail](https://github.com/frmoretto/memory-trail)
- **Ownership**: no memory or context tool found exposes an owner, approver or authority on a record. Copilot Memory has only admin *policy* control; Zep speaks of "governed context" at the enterprise-data level. — [github.blog changelog, 2026-03-04](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/); [getzep.com](https://www.getzep.com/)
- **Ticket binding**: Unblocked, Cursor Projects and Copilot read trackers as *context*; Beads is its own tracker; Spec Kit/Kiro specs are per-feature folders without an external key. No tool found makes "this unit of work IS Linear ticket X / Jira Y / Doc Z" a validated identity edge.

### Inferences
- The "authored decision" is widely recognised as valuable (Davidson, glukhov, Anthropic's own `project` memory type, Entire's "intent") but is implemented nowhere as a typed, validated, human-written record that agents and tools can rely on. This is the clearest unoccupied cell in the map.
- The strongest counter-evidence to "the gap exists" is that **conventions** (ADRs + AGENTS.md) already satisfy solo developers cheaply; pjman must show why a schema + CLI beats a `docs/decisions` folder — the Davidson anecdote (stale ADR enforced blindly) is the argument: without status, supersession and drift detection, prose ADRs mislead agents.

### Gaps
- Linear's and Jira's own agent features (e.g., Linear agent sessions) were out of scope and not researched; they may bind an agent session to a ticket from the tracker side.
- Nauro (see Q1 gaps) could be a decisions-in-markdown MCP tool; unverified.

---

## Key question 4 — Which players are harness-agnostic vs locked to one?

### Takeaway
Harness-agnostic (multi-agent) is now the norm for third-party tools — claude-mem (10 harnesses), Graphify (20+), Entire (8), Beads (5+), Mem0/Cognee/Hindsight (hooks + MCP), SpecStory, Spec Kit — while every lab-native mechanism and Letta Code are locked to their own agent. pjman's "harness-agnostic" claim is therefore **table stakes for third parties, not a differentiator**; the differentiator is what is stored.

### Cited Findings
- **Agnostic**: claude-mem — Claude Code, Gemini CLI, OpenCode, Codex, Cursor, Grok Bot, T3 Code, DeepSeek, Pi, OpenClaw. — [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Agnostic**: Graphify — Claude Code, Cursor, Codex, Copilot CLI, Gemini CLI, VS Code Copilot Chat, Aider, OpenCode, Kilo Code, Factory Droid, Trae, Hermes, Amp, Kiro, Pi, Devin, Antigravity via cross-framework Agent Skills. — [github.com/Yyunozor/graphify](https://github.com/Yyunozor/graphify)
- **Agnostic**: Entire CLI — Antigravity, Claude Code, Codex, Copilot CLI, Cursor, Factory Droid, OpenCode, Pi. — [github.com/entireio/cli](https://github.com/entireio/cli)
- **Agnostic**: Beads — Claude Code, Codex CLI, Factory Droid, Copilot (MCP), Cursor, custom via AGENTS.md. — [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
- **Agnostic**: Mem0 skills for Claude Code, Codex, Cursor, Windsurf, OpenCode, OpenClaw; Cognee Claude Code plugin + MCP for Cursor/Cline; Unblocked MCP for Claude, Cursor, Codex, Copilot; Hindsight hooks for Cursor and Codex. — [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0); [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee); [getunblocked.com](https://getunblocked.com/blog/unblocked-context-engine-for-agents/); [hindsight.vectorize.io](https://hindsight.vectorize.io/blog/2026/06/12/cursor-persistent-memory)
- **Locked**: Claude Code auto memory (machine-local, `~/.claude/`), Copilot Memory (GitHub-hosted, per repo), Gemini `save_memory` (`~/.gemini/GEMINI.md`), Cursor Projects (Cursor cloud), Kiro specs/steering (`.kiro/`), Windsurf Memories (workspace), Letta Code MemFS (Letta agent). — [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory); [github.blog](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/); [geminicli.com](https://geminicli.com/docs/tools/memory); [cursor.com/changelog/projects](https://cursor.com/changelog/projects); [kiro.dev](https://kiro.dev/docs/steering/); [docs.devin.ai](https://docs.devin.ai/windsurf/plugins/cascade/memories); [docs.letta.com](https://docs.letta.com/letta-code/memory)
- **Partial portability among labs**: Claude Code reads AGENTS.md and migrates Cursor/Copilot/Windsurf/Cline rule files via `/init` and `/import`; AGENTS.md is a Linux Foundation (Agentic AI Foundation) spec. — [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory); [github.com/openai/codex/discussions/12567](https://github.com/openai/codex/discussions/12567)

### Inferences
- Instruction files are converging on AGENTS.md as a de-facto standard; *memory* is not converging — each lab's is private. A portable record format that any harness's adapter can read is still open, which supports pjman's "nothing harness-specific in a record" constraint.
- The integration surface that works across harnesses in practice is **lifecycle hooks + MCP + skills** (claude-mem, Hindsight, Mem0, Cognee, Graphify all use it). pjman's Phase 1 adapters should assume exactly this surface.

### Gaps
- Whether Cursor Projects or Kiro specs can be exported in a documented format was not found.

---

## Key question 5 — What do commentators and practitioners say about the limits of memory tools? Evidence of churn or disillusionment?

### Takeaway
There is consistent 2026 evidence — from vendors, independent practitioners, arXiv and the labs' own product moves — that unstructured memory **goes stale, conflicts and pollutes context**, and that "better recall does not automatically improve results"; the labs responded by removing (Cursor) or expiring (Copilot, 28 days) memories, and practitioners responded by moving to structured files and decision records.

### Cited Findings
- Mem0's own "State of AI Agent Memory 2026" (published 2026-10-09; updated 2026-09-28) lists open problems: "temporal abstraction at scale (25% performance drop across 10× context expansion [BEAM 1M→10M])", "cross-session identity resolution", "memory staleness ('confidently wrong' outdated facts)", privacy/consent architecture, application-level evaluation. — [mem0.ai/blog/state-of-ai-agent-memory-2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- Braintrust (2026-08-02): "A memory layer can retrieve stale facts, surface irrelevant details, miss important updates, or introduce latency that weakens the experience." — [braintrust.dev](https://www.braintrust.dev/articles/best-ai-agent-memory-tools-2026)
- Alexandre Agius, "The Agent Memory Problem: Why 5+ Solutions Exist and None Won" (2026-05-16): no single storage primitive serves semantic/episodic/procedural/working memory; failure modes — summarisation loses detail, "searching through 500 session logs… is expensive", semantic memory "lacks mechanisms to handle contradictory facts", embeddings are "opaque"; "dozens of practitioners shared their own setups, each different"; predicts "12–18 months away from someone shipping [a unified solution] convincingly"; author combines structured files + knowledge graph + session logs across 15+ projects. — [agiusalexandre.com, 2026-05-16](https://www.agiusalexandre.com/blog/2026-05-16-agent-memory-problem-landscape-decision-framework/)
- arXiv "Memory as Infrastructure: Reliability Engineering for Persistent Agent Memory in Months-Long LLM-Assisted Development" (Mike Helwig, submitted 2026-08-31): names staleness, contradiction, pollution and silent failure as the failure classes; instrumented 78,933 hook invocations with 85 failures (84 in the first three weeks); proposes session-start health gates and heartbeat telemetry; MIT toolkit. — [arxiv.org/abs/2609.05510](https://arxiv.org/abs/2609.05510)
- arXiv "TEPA: Revoking Stale Memories for Conflict-Robust Language Agents" (2026) — conflict-key checks and a revoked archive for superseded memories. — [arxiv.org/pdf/2608.07429](https://arxiv.org/pdf/2608.07429)
- arXiv "When Stale Constraints Go Unchecked: Budgeted Verification Failures in Inherited Agent Memory" (2026). — [arxiv.org/pdf/2608.25553](https://arxiv.org/pdf/2608.25553)
- arXiv "DreamBench-SWE: A Multi-Session Memory-Hygiene Benchmark for Software Agents" (2026) — a benchmark specifically for memory hygiene in software agents. — [arxiv.org/pdf/2608.20664](https://arxiv.org/pdf/2608.20664)
- arXiv survey "Always-On Agents: A Survey of Persistent Memory, State, and Governance in LLM Agents" (2026). — [arxiv.org/pdf/2606.30306](https://arxiv.org/pdf/2606.30306)
- Davidson (2026-09-01): memory systems "preserve context without establishing whether it is accurate, current, or accepted by the human team"; a stale ADR caused an agent to preserve an obsolete abstraction. — [duncandavidson.com/agents-love-decisions](https://duncandavidson.com/agents-love-decisions)
- Lab-side responses to staleness: Copilot memories "automatically expire after 28 days" and are "validated against the current codebase before being applied"; Cursor removed Memories in 2.1 and told users to convert them into Rules; Claude Code stamps `modified` timestamps on memory files, warns when `MEMORY.md` exceeds limits, and ships `/doctor prompt-audit` to find "outdated or conflicting" instruction files. — [github.blog](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/); [forum.cursor.com](https://forum.cursor.com/t/custom-modes-and-memories-gone-in-2-1/143744); [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Claude Code plan persistence failures filed by users (silent non-pickup; stale plan bleed; wrong plan auto-executed). — [claudeissues.com 54720](https://claudeissues.com/issue/54720-plan-pickup-is-broken-you-told-users-a-new-session-resumes-it-doesnt); [12838](https://claudeissues.com/issue/12838-bug-plan-mode-persistence-causes-stale-context-to-bleed-across-sessions); [34782](https://claudeissues.com/issue/34782-plan-from-previous-session-auto-injected-and-executed-in-new-session)
- Medium practitioner piece: "Claude Code Has Memory Now. Here's What It Still Can't Do" (2026). — [medium.com](https://medium.com/@kumaran.isk/claude-code-has-memory-now-heres-what-it-still-can-t-do-a2a7fb26070c)
- Codex maintainers warn users off the experimental memories ("rate limits would consume all your tokens"). — [github.com/openai/codex/discussions/12567](https://github.com/openai/codex/discussions/12567)

### Inferences
- The critique is converging on exactly the properties pjman specifies: **status/supersession** (TEPA, memory-trail's Superseded state, Copilot expiry), **provenance and authored-vs-derived** (Davidson's "accepted by the human team"), **validation at load** (Copilot, Claude Code's prompt-audit, Helwig's health gates), and **drift surfaced not hidden** (Helwig: "none silent"). pjman's "drift is surfaced, never hidden" and "the CLI is the schema… invalid records reported as drift" map one-to-one onto the failure modes the literature names.
- Churn evidence is real but indirect: Cursor killing Memories, Copilot's 28-day TTL, claude-mem's 13 major versions, and practitioners describing bespoke multi-tool setups. I found no survey quantifying abandonment of memory tools.

### Gaps
- No quantitative churn/retention data for any memory vendor (Mem0's 186M API calls/quarter is growth, not retention).
- No independent benchmark of *structured-record* approaches (ADRs, Beads, Spec Kit) versus fact memory on coding outcomes; DreamBench-SWE is the nearest and was not read in full.
