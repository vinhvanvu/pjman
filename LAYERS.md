# pjman — layers and the most popular technology at each

*The rule: at every layer, default to the most popular technology in the market and integrate with it; roll our own only where the most popular does not satisfy what the record needs. "Build" below means pjman owns it; everything else is consumed, bound, imported or ingested. Figures are from the research notes under `research_notes/` and three spot checks dated 2026-10-10.*

## The rule applied

pjman owns exactly three things, because nothing popular does them: the **record** (a change bound to a source, with authored decisions and typed edges), the **derived session record** (structure of what a session did, not its transcript), and the **drift object**. Every other layer has a dominant player and pjman plugs into it.

## Catalog

| # | Layer | What pjman needs here | Most popular in the market (evidence) | Stance | Phase |
|---|---|---|---|---|---|
| 1 | Record format | Human-readable, diffable, machine-parseable records | Markdown + YAML frontmatter — the de-facto convention of Obsidian, Jekyll/Hugo, Spec Kit, OpenSpec, AGENTS.md | **Build** the schema on the convention | 1 |
| 2 | Versioning and sync of records | History, review, sync between machines | git (universal) | Integrate | 1 |
| 3 | Schema and validation | One spec, enforced at write and index time | JSON Schema (dominant); Zod in TypeScript | Build the spec; use the tools | 1 |
| 4 | Local index and query | Rebuildable, disposable, multi-hop queries | SQLite (ubiquitous, no native-dependency pain). Embedded graph: Kuzu was archived 2025-10-10 after Apple acquired Kùzu Inc.; the community fork **LadybugDB** is active (v0.19.1, Aug 2026). Hosted graph: Neo4j | SQLite first; LadybugDB if multi-hop outgrows recursive SQL | 1 |
| 5 | Agent protocol | Any harness reads and writes the graph | **MCP** — 97M monthly SDK downloads, Linux Foundation (AAIF) since Dec 2025, first-class in every harness | Expose an MCP server | 1 |
| 6 | Harness (execution agent) | Adapters: skills, hooks, mods | Stack Overflow 2026: Copilot 51% (down from 67%), Cursor 18%, Claude Code 10%. JetBrains 2026: Copilot 29%, Cursor 18%, Claude Code 18%; Claude Code 28% as *primary* tool, 46% among 10+-year devs | Claude Code first (the founder's), Cursor second, Codex/Copilot via AGENTS.md | 1 → 2 |
| 7 | Instruction files | Tell the harness the graph exists and how to write to it | **AGENTS.md** (60k+ repos, Linux Foundation spec) + CLAUDE.md | Emit and respect; never replace | 1 |
| 8 | Work tracker (source of changes) | Bind a change to a ticket; later sync both ways | **Jira** overall (250k+ customers); **Linear** at post-2018 tech companies (10k+ teams; OpenAI, Vercel, Ramp); GitHub Issues in open source | Linear first (the founder's), GitHub Issues second, Jira at Phase 2 | 1 → 2 |
| 9 | Code hosting and PR evidence | PRs, merges, reviews as evidence; the merge check | **GitHub** (43.2M PRs merged/month) | Ingest PR URLs as evidence (1); merge check as a GitHub Action (2) | 1 → 2 |
| 10 | CI/CD | Where the merge check runs | **GitHub Actions** | Integrate | 2 |
| 11 | Fact memory | Facts about the codebase and user | Lab-native (Claude Code auto-memory on by default since Feb 2026; Copilot, Codex, Gemini); third-party claude-mem (99k stars), Mem0 (66.9k) | **Consume as a source; never build** | — |
| 12 | Spec and plan workflow | A plan inside a change | **Spec Kit** (140k stars, 84k PyPI/month); **OpenSpec** (2.7M npm/month) | Import a spec or change folder as a pjman change; never compete | 1.5 |
| 13 | Decision records | Authored decision with who/why/when, status, supersession, edges | ADR practice: MADR template, adr-tools, Log4brains; Backstage ADR plugin. 47% of architects use ADRs; 63% written after the fact | **Build** the record; import MADR files | 1 |
| 14 | Session capture | What a session did, what's next, observed edges | The founder's session-orient mod (Phase 0); Entire ($60M, transcripts as git refs); harness transcripts | **Build** the derived record (structure, not transcript); Entire as a possible source later | 1 |
| 15 | Local views | Sidebar, pane, status line, board | cmux sidebar + Claude Code mods (Phase 0); VS Code generally | Port the founder's adapters; VS Code later | 1 → 2 |
| 16 | Ownership source | Who owns what, to ingest rather than author | **CODEOWNERS** (GitHub); **Backstage** catalog (3.4k+ adopters); Cortex/OpsLevel/Port derive owners from repo activity | Ingest at service level; own the feature level | 2 |
| 17 | Chat (where requests arrive) | A message as a source | **Slack** | Source | 2 |
| 18 | Docs and knowledge | A doc as a source | Notion, Confluence, Google Docs | Source | 2 |
| 19 | Hosted store | The organisation's graph | **Postgres** (dominant relational); Neo4j (dominant graph) | Same schema as Phase 1 over a server DB | 2 |
| 20 | Identity and auth (hosted) | Users, permissions following the tree | GitHub OAuth / Google; WorkOS for SSO | Integrate | 2 |
| 21 | Design artefacts | A mockup as part of a design record | **Figma** | Source | 3 |
| 22 | Telemetry and data evidence | Maturity evidence with a grade | Datadog; Snowflake and warehouses via MCP | Evidence connector, citations only | 3 |
| 23 | Drift between declared and observed | The gap, surfaced and routed | Nobody (Terraform/GitOps do it for infrastructure only) | **Build** | 1 (local), 2 (merge) |

## Where "roll our own" is justified

- **Record format and schema (1, 3):** no standard exists for a typed decision with owner, status and edges, or for a change bound to a source. The convention (Markdown + frontmatter) is adopted; the schema is ours.
- **Decision record (13):** MADR has no owner, no edges, no supersession as data, and the research shows it is written after the fact. Ours is the artefact through which the decision is made.
- **Session record (14):** Entire and harness transcripts record *what was said*; pjman needs *what was done, what's next, what was observed* — the structure, derived by code.
- **Drift (23):** no product does it for product intent.

Everything else is somebody else's layer, and the most popular player is the default integration.

## Sources for the spot checks

- Harness share: [Stack Overflow 2026 / JetBrains 2026 summary](https://pasqualepillitteri.it/en/blog/github-copilot-cursor-claude-code-ai-coding-showdown-2026), [JetBrains AI Pulse figures](https://uvik.net/blog/claude-code-vs-cursor-vs-copilot-vs-codex-2026/)
- Kuzu archived, LadybugDB fork: [OneUptime, 2026-08-12](https://oneuptime.com/blog/post/2026-08-12-kuzu-archived-pin-0-11-3-fork-or-migrate/view)
- Jira vs Linear: [Bloomberry, 2026-05-04](https://bloomberry.com/blog/the-data-on-jira-vs-linear-whos-winning-new-customers/)
- All other figures: `research_notes/pjman worth building analysis/`
