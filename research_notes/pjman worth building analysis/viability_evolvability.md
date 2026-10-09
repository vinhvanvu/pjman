# Viability and evolvability of a solo-founder open-source → hosted developer tool in the AI-coding-agent space (as of 2026-10-09)

Scope: assessment input for pjman (THESIS.md, 2026-10-10 resynthesis): a staff engineer with a full-time job extracts a daily-use tool into a permissively licensed, harness-agnostic framework (markdown records in git + CLI/library + MCP server + adapters), then builds a hosted paid graph (solo ~$10/mo, teams per signer), with the free/paid line "runs on your machine, free; runs on ours, paid."

Conventions: every claim is dated; "self-reported" = the company said it; "estimate" = a third-party data vendor (Latka, Dealroom, CB Insights) whose numbers are modelled, not audited. Research was conducted with roughly 40 web searches/fetches on 2026-10-09; a few primary pages (Indie Hackers, the Claude Code CHANGELOG on GitHub, a PocketBase/FLOSS-fund post) returned 403/redirects and are flagged as gaps.

---

## Key Question 1 — Comparable open-source → business cases and their outcomes

### Takeaway
Of the named comparables, only three are genuinely solo- or two-person-sustainable without venture capital (Sidekiq, Plausible, Obsidian) and each took 4–10 years and sells something other than "hosting of a free framework" (a paid add-on, a hosted product that *is* the product, or sync/publish/commercial licences). Everything with a "free complete framework + hosted service" shape (Cal.com, Supabase, Astro, Vite/VoidZero, Payload, Zed) raised VC, and the two closest to pjman's model — Cal.com and Plausible — both moved *away* from permissive licensing after hosted free-riding, Cal.com going fully closed on its commercial edition in April 2026.

### Cited Findings

**Cal.com** (closest shape to pjman: open framework + hosted paid tiers)
- Raised $7.4M seed led by OSS Capital in December 2021 and $25M Series A in April 2022; the company claimed "a decade of runway with our current team size and monthly recurring revenue" (self-reported, Sept 2022) — [Cal.com seed post](https://cal.com/pt-BR/blog/seed); [Cal.com longevity guarantee, 2022-09-09](https://next.cal.com/blog/longevity)
- Revenue estimates: $1.6M (2023) → $5.1M (2024) per Latka (estimate, unverified); Dealroom lists $2.2M for 2025, which conflicts with Latka's 2024 figure — treat both as unreliable — [Latka](https://getlatka.com/companies/calcom); [Dealroom](https://dealroom.co/companies/cal-com/)
- Core repo was AGPLv3 with a 2022 "longevity guarantee" promising MIT relicensing to top contributors if the company stopped — [Cal.com longevity](https://next.cal.com/blog/longevity)
- **On 2026-04-15 Cal.com moved its commercial codebase from "source-available" to "closed source" and relaunched the free code as "Cal.diy" under MIT, minus Teams, Workflows, Insights, SSO and API v1.** Stated reason (verbatim): "AI coding assistants have drastically changed the way engineers write code, but it also made finding vulnerabilities in software much easier, especially publicly available code." No revenue or self-hoster numbers were given — [Cal.com v6.4 announcement, 2026-04-15](https://cal.com/blog/calcom-v6-4); [Sacra summary](https://sacra.com/chat/h/d1cda8de-7bc0-4156-ad04-f9e1b128fbb2/); [isitreallyfoss issue #297](https://zff.dev/danb/isitreallyfoss/issues/297)
- Third-party reading of the move: keeping cal.diy public "preserves community distribution, but makes the most commercially useful code and roadmap harder for enterprise free riders to copy" — [Sacra](https://sacra.com/chat/h/d1cda8de-7bc0-4156-ad04-f9e1b128fbb2/)

**Plausible Analytics** (two founders, bootstrapped, open source + hosted)
- Fully bootstrapped; $1M ARR took until 2022, four years after launch; $3.1M ARR by late 2024 (self-reported) — [Tiny Empires](https://tinyempires.substack.com/p/inside-a-tiny-empire-plausible-analytics); [Indie Hackers $1M ARR post](https://www.indiehackers.com/post/we-just-reached-the-1m-arr-milestone-32722fc93e); [Rise of Community](https://riseofcommunity.substack.com/p/how-plausible-bootstrapped-to-500k)
- Changed licence from MIT to AGPLv3 (October 2020) because they "had been approached by large corporations wanting to sell a version of Plausible Analytics without contributing back" and to prevent "offering Plausible as a service without contributing" and "confusing people about whether services they sell are approved" — [Plausible: open source licenses](https://ingest.plausible.io/blog/open-source-licenses); [LWN coverage](https://lwn.net/Articles/834120/)
- Later separated a "Community Edition" from the hosted product — [Plausible community edition](https://ingest.plausible.io/blog/community-edition)

**Sidekiq** (true solo, open core, not hosted)
- Mike Perham, solo founder; open-source core with paid Pro/Enterprise add-ons; "millions in revenue as a one-person software company"; Latka estimates $2.0M (2023) → $2.9M (2024); some secondary sources claim up to $7M/yr (unverified) — [Startups for the Rest of Us ep. 661](https://www.startupsfortherestofus.com/episodes/episode-661-millions-in-revenue-as-a-one-person-software-company); [Latka](https://getlatka.com/companies/sidekiq); [Indie Hackers podcast #016](https://indiehackers.com/podcast/016-mike-perham-of-sidekiq)
- "It took him ten years to become 'an overnight success'" — [Indie Hackers](https://indiehackers.com/podcast/016-mike-perham-of-sidekiq)

**Obsidian** (bootstrapped, closed-source app, open format)
- Self-funded, profitable, no VC; team of roughly 10 (one source says ~18); revenue estimated $2M–$5M ARR (estimate, unverified); monetised via Sync, Publish and commercial licences — [TfT Hacker interview with CEO](https://tfthacker.substack.com/p/getting-to-know-the-ceo-of-obsidian); [Nubiapage 2026 review](https://nubiapage.com/obsidian-review-2026-app-ai-pricing-company-tool/)
- Note: Obsidian is *not* open source; it is "open format" (markdown files) with a closed app — the relevant lesson is that the file format, not the code, is the trust anchor.

**Logseq** (open source, VC-seeded, struggling)
- Raised $4.1M total, last round May 2022 (Mucker Capital); through 2025 still working on a database rewrite and a paid "Logseq Sync"; community threads titled "Is Logseq dead?" with a member estimating no new version before Q3 2026 — [Logseq forum: project status](https://discuss.logseq.com/t/logseq-project-status/28849); [vcbacked.co](https://www.vcbacked.co/company/logseq)

**PocketBase** (true solo, open source, no business)
- Created 2022 by solo developer Gani Georgiev; funded partly through GitHub Sponsors; pre-1.0; "single-maintainer risk"; "no corporate entity, no enterprise tier"; reportedly lost its FLOSS Fund allocation (the post describing this returned 403 — amounts and reasons unverified) — [opentechhub](https://www.opentechhub.io/pocketbase/); [Mewayz on FLOSS fund (unfetchable)](https://mewayz.com/sa/blog/pocketbase-lost-its-funding-from-floss-fund)

**Payload CMS** (open source, VC path → acquisition)
- Sold to Figma, announced 2025-06-17, six weeks before Figma's IPO; the deal began while Payload was exploring a $10–15M Series A — [Crain's Grand Rapids](https://www.crainsgrandrapids.com/awards/ma-awards-2026-payload-cms-integrates-with-global-digital-design-tool-creator); [Mathison](https://www.mathisonarchitects.com/news/grand-rapids-tech-firm-acquired-by-san-francisco-maker-of-digital-design-tool)

**Astro** (open source framework, VC)
- The Astro Technology Company formed with a $7M seed led by Lightspeed, announced 2022-01-12; the core team moved from Skypack/Pika — [Astro announcement](https://astro.build/blog/the-astro-technology-company)

**Vite / VoidZero** (maintainer-founded, VC)
- Evan You founded VoidZero with a $4.6M seed led by Accel (October 2024), then a $12.5M Series A led by Accel (October 2025) to fund the commercial "Vite+" toolchain — [VoidZero Series A](https://voidzero.dev/posts/announcing-series-a); [VoidZero founding](https://voidzero.dev/posts/announcing-voidzero-inc); [DealStreetAsia](https://www.dealstreetasia.com/stories/voidzero-accel-461657)
- A non-English secondary site reports a Cloudflare acquisition of VoidZero; I could not verify this from a primary source — treat as unconfirmed — [pasqualepillitteri.it](https://pasqualepillitteri.it/es/news/4220/cloudflare-adquiere-voidzero-vite)

**Supabase** (open source + hosted, the archetype, VC)
- $100M Series E at $5B valuation (October 2025), four months after a $200M Series D at $2B — [TechCrunch 2025-10-03](https://techcrunch.com/2025/10/03/supabase-nabs-5b-valuation-four-months-after-hitting-2b/); [Orrick](https://www.orrick.com/en/News/2025/10/Supabase-Raises-100-Million-Series-E-at-5-Billion-Valuation)

**Zed, Warp, Raycast** (dev tools, VC)
- Zed: $32M Series B led by Sequoia, 2025-08-20; $42M total over 4 rounds — [CB Insights](https://www.cbinsights.com/company/zed/financials); [Crunchbase](https://crunchbase.com/organization/zed)
- Warp: CB Insights lists $18.1M over 5 rounds and a "$10M Series A, January 2025" and "$32.5M 2024 revenue" — these conflict with widely reported earlier rounds ($23M Series A 2022, $50M Series B 2023); treat CB Insights' Warp figures as unreliable — [CB Insights](https://www.cbinsights.com/company/warp/financials)
- Raycast: $62.7M total; $30M Series B September 2024 — [Seedtable](https://seedtable.com/startups/Raycast-99D93KW)

**Linear** (closed, bootstrapped early, VC later)
- Founded 2019 by Karri Saarinen, Tuomas Artman, Jori Lallo; initially bootstrapped; first users were the cofounders' friends at small startups who liked that it was "highly opinionated, sleek, built for them, and fast." Not an internal-tool extraction — [Contrary Research](https://research.contrary.com/report/linear); [Sequoia founder page](https://sequoiacap.com/founder/karri-saarinen)

**Spec Kit** (open source born inside a platform owner)
- Conceived by Den Delimarsky and John Lam at GitHub; first commit 2025-08-21; announced 2025-09-02; MIT — [Spec Kit history](https://github.github.com/spec-kit/history.html); [GitHub blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit); [Visual Studio Magazine, 2026-05-12: "takes off"](https://visualstudiomagazine.com/articles/2026/05/12/github-spec-kit-takes-off-as-antidote-to-piecemeal-vibe-coding.aspx?p=1)

**Sourcegraph Cody** (a cautionary non-lab case)
- Free and Pro tiers retired 2025-07-23; Cody became Enterprise-only at $59/user/mo; individuals redirected to Amp, which was spun out as a separate company December 2025 — [Wikipedia: Sourcegraph](https://en.wikipedia.org/wiki/Sourcegraph); [BuildBetter](https://blog.buildbetter.ai/best-sourcegraph-cody-alternatives-in-2026-for-engineering-teams/)

### Inferences
- The "free framework complete on its own + hosted paid" pattern (THESIS tenet 1) has only been sustained at scale by VC-funded companies; the bootstrapped survivors monetise something the framework user *cannot* self-provide cheaply (Sidekiq Pro features; Plausible as a hosted product where self-hosting is the exception; Obsidian Sync/Publish).
- Both Cal.com and Plausible started permissive, discovered hosted free-riding, and tightened. Cal.com's April 2026 move is the first major case explicitly citing AI-assisted vulnerability discovery in public code as a reason to close — which cuts directly against THESIS's "the moat is never the code — an agent clones it in a weekend" framing: the labs' tools have made cloning cheaper *and* made the originator's open code a liability, and at least one well-funded comparable responded by closing.
- pjman's "records are files in git" positioning resembles Obsidian's open-format/closed-app trust model more than Cal.com's open-code model; Obsidian is the one bootstrapped comparable whose monetisation (sync = "runs on ours") matches pjman's line.
- Time horizons in the bootstrapped cases are 4–10 years to a few $M ARR, with full-time founders. No comparable was found where a founder with a full-time job reached meaningful revenue.

### Gaps
- No verified revenue for any comparable except Plausible's self-reported figures; Latka/Dealroom/CB Insights numbers conflict with each other (Cal.com, Warp).
- PocketBase/FLOSS Fund details could not be fetched.
- No comparable was found for the exact pjman shape (markdown-in-git framework → hosted graph) at any revenue level.

---

## Key Question 2 — Solo-founder dev-tool economics and open-source sustainability data

### Takeaway
Developer-tool freemium converts at roughly 1–3%, open-source-to-paid at 0.5–3% (secondary citations of OpenView benchmarks), median B2B SaaS time-to-first-revenue is 6–12 months with a full-time founder, and the maintainer data (Tidelift 2024) shows 60% unpaid, 44% citing burnout, and only 26% earning over $1,000/yr from maintenance — all before the Octoverse 2025 "AI slop" load on maintainers.

### Cited Findings
- Developer tools freemium conversion "between 1-3%", vs 2–5% SaaS median (secondary source citing OpenView 2023 benchmarks) — [Monetizely: free-to-paid ratio](https://www.getmonetizely.com/articles/whats-the-right-ratio-of-free-to-paid-users-in-developer-saas)
- Open-source SaaS conversion "often between 0.5-3%"; "successful open source companies typically see conversion rates between 1-5%, with top performers reaching 8-10% for targeted enterprise segments" (secondary, citing OpenView 2022) — [Monetizely: optimal conversion](https://www.getmonetizely.com/articles/whats-the-optimal-conversion-rate-from-free-to-paid-in-open-source-saas); [Monetizely: OSS adoption vs revenue](https://www.getmonetizely.com/articles/whats-the-relationship-between-open-source-adoption-and-saas-revenue)
- B2B SaaS median time to first revenue 6–12 months; 25th percentile 3–6 months; 75th percentile 12–18 months (aggregator, methodology not shown) — [Foundra](https://www.foundra.ai/key-reads/time-to-first-revenue-startup-data)
- Indie examples of time-to-$1k MRR: 5 months (GainFrame, 2026), 13 months (an Indie Hackers founder), and Customer.io from $50 to $1,123 MRR in its first 6 months (2012) — [GainFrame](https://gainframe.app/blog/1000-mrr-five-months/); [Indie Hackers thread](https://www.indiehackers.com/post/how-long-did-it-take-you-to-go-to-1-000-mrr-3c908ef9da)
- Tidelift State of the Open Source Maintainer (2024 report): 60% of maintainers are unpaid hobbyists; nearly 60% have quit or considered quitting a project; reasons: 54% competing life demands, 51% loss of interest, 44% burnout; only 26% earn more than $1,000/yr from maintenance; paid maintainers resolve vulnerabilities 45% faster — [FOSS United summary](https://forum.fossunited.org/t/opinionated-summary-of-tidelift-state-of-open-source-maintainer-report/4066); [TFiR](https://tfir.io/almost-half-of-open-source-maintainers-are-unpaid-volunteers-survey/); [tianpan.co](https://tianpan.co/forum/t/60-of-oss-maintainers-are-unpaid-44-report-burnout-and-your-companys-entire-infrastructure-depends-on-them/540)
- GitHub Octoverse 2025: ~36M new developers in the year; 1.12B contributions to public/OSS projects; merged PRs up from 35M to 43.2M monthly average; "nearly 80% of new developers use Copilot within their first week"; the report flags "AI slop" PRs and maintainer burnout as key sustainability risks — [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/); [GitHub: what to expect for open source in 2026](https://github.blog/open-source/maintainers/what-to-expect-for-open-source-in-2026/)
- Solo dev-tool founders at $1M+: Sidekiq (Mike Perham, open core) is the canonical case; an Indie Hackers list of "11 solo indie hackers making $1M" exists but returned 403 — [Indie Hackers list (unfetchable)](https://www.indiehackers.com/post/11-solo-indie-hackers-making-1m-in-annual-revenue-NRq6hCm3La6N6UliFRfE); [Sidekiq](https://www.startupsfortherestofus.com/episodes/episode-661-millions-in-revenue-as-a-one-person-software-company)
- Sidekiq's revenue: Latka estimates $2.9M (2024) — [Latka](https://getlatka.com/companies/sidekiq)

### Inferences
- Arithmetic on pjman's solo tier: at $10/mo and a 1–3% conversion, 10,000 active free users yields 100–300 paying solo users ≈ $12k–$36k/yr. The solo tier cannot be the business; the team per-signer tier must be, and that tier requires Phase 3 (alignment) which THESIS says needs "a team with real approvals" — i.e., revenue depends on the part furthest from what exists.
- A founder with a full-time job sits well below the "full-time founder" assumptions of every benchmark above; the realistic Phase 1 outcome is an open-source project whose maintenance load (issues, AI-slop PRs, harness churn) competes with the day job, which is the exact profile Tidelift's 54% "competing life demands" quitters describe.

### Gaps
- No primary OpenView benchmark document was fetched; conversion numbers are via Monetizely's secondary articles.
- No public dataset on time-to-first-revenue for *open-source* dev-tool hosting specifically.
- Tidelift's 2025 survey (if one exists) was not located; the data cited is from the 2024 report.

---

## Key Question 3 — Lab absorption risk: timeline and evidence

### Takeaway
Between June 2025 and August 2026 the three labs plus Cursor and GitHub shipped, natively, nearly every category that third-party tools had built around coding agents — hooks, subagents, plan mode, plugins, tasks with dependencies, cross-session memory (Cursor June 2025; Copilot January 2026; Claude Code February 2026; Codex April 2026), background/cloud agents, code review, agent teams — typically within 6–12 months of the third-party version. The survivors are cross-harness tools that own a data layer the harness does not (claude-mem, Supermemory), and Anthropic's own stated 2026 roadmap includes agents persisting insights "across an entire team," which lands on the exact territory of pjman's Phase 2.

### Cited Findings

**Anthropic / Claude Code (dates from secondary changelog trackers; the official CHANGELOG on GitHub redirected and was not fetched)**
- Research preview 2025-02-24; GA 2025-05-22 — [scriptbyai timeline](https://www.scriptbyai.com/claude-code-timeline/)
- Hooks: 2025-06-30 — [scriptbyai](https://www.scriptbyai.com/claude-code-timeline/)
- Subagents: July 2025 — [scriptbyai](https://www.scriptbyai.com/claude-code-timeline/)
- Plugins and marketplaces (bundling commands, subagents, MCP servers, hooks): v2.0.12, 2025-10-09 — [havoptic October 2025](https://www.havoptic.com/releases/claude-code/2025/10)
- Plan subagent: v2.0.28, 2025-10-27 — [havoptic October 2025](https://www.havoptic.com/releases/claude-code/2025/10)
- Task system with dependencies, blockers and multi-session collaboration (TaskCreate/TaskGet/TaskUpdate/TaskList replacing TodoWrite): reported as "January 23" by a secondary guide which prints 2025 but describes a 2026-era feature; date year unverified — [claudefa.st task management](https://claudefa.st/blog/guide/development/task-management)
- Agent Teams (multiple coordinated Claude Code instances, research preview) with Opus 4.6: 2026-02-05 — [TechCrunch 2026-02-05](https://techcrunch.com/2026/02/05/anthropic-releases-opus-4-6-with-new-agent-teams); [heise](https://heise.de/-11167248)
- Auto-memory on by default, managed by /memory: v2.1.59, 2026-02-25 — [havoptic v2.1.59](https://www.havoptic.com/r/claude-code-2.1.59); [memoryplugin explainer](https://blog.memoryplugin.com/claude-code-memory/)
- Claude Code Security research preview for Enterprise/Team: February 2026; Anthropic claims 4% of public GitHub commits authored by Claude Code (self-reported) — [buildfastwithai 2026 guide](https://buildfastwithai.com/blogs/claude-ai-complete-guide-2026)
- Persistent memory to all Claude users incl. free tier: early March 2026; memory shared across chat and Cowork: August 2026 — [buildfastwithai 2026 guide](https://buildfastwithai.com/blogs/claude-ai-complete-guide-2026) (secondary)
- "Code with Claude 2026" roadmap, as reported by an attendee: "Agents can review their own past sessions to find patterns, identify recurring mistakes, and persist useful insights into long-term memory across an entire team"; also "multi-agent orchestration as a managed primitive" — [mejba.me attendee report](https://www.mejba.me/blog/code-with-claude-2026-agent-future-preview) (secondary, unverified against an Anthropic primary)

**Cursor**
- Cursor 1.0, 2025-06-04: Memories (beta, per-project), Bugbot code review, Background Agent GA, one-click MCP setup — [Cursor changelog 1.0](https://cursor.com/changelog/1-0); [DevClass](https://www.devclass.com/ai-ml/2025/06/06/cursor-ai-editor-hits-10-milestone-including-bugbot-and-high-risk-background-agents/101131)
- Background agents running 10–20 in parallel in cloud VMs, early 2026 — [PromptLayer on Cursor changelog](https://blog.promptlayer.com/cursor-changelog-whats-coming-next-in-2026/)

**GitHub Copilot**
- Agentic memory public preview 2026-01-15: repository-specific memories, validated against the codebase, shared across coding agent / code review / CLI, auto-expired after 28 days — [GitHub changelog 2026-01-15](https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/)
- Copilot Memory on by default for Pro/Pro+, 2026-03-04 — [GitHub changelog 2026-03-04](https://github.blog/changelog/2026-03-04-copilot-memory-now-on-by-default-for-pro-and-pro-users-in-public-preview/)
- Spec Kit (spec → plan → tasks workflow, i.e. a records-in-repo workflow tool) shipped from inside GitHub, 2025-09-02 — [GitHub blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit)

**OpenAI Codex**
- "Codex for (almost) everything," 2026-04-16: desktop control, memory ("project-scoped, cloud-only, and locked inside OpenAI" per a third-party memory vendor), 90+ tool connections — [buildfastwithai](https://www.buildfastwithai.com/blogs/openai-codex-for-almost-everything-2026); [Supermemory on Codex memory](https://supermemory.ai/changelog/memory-for-openai-codex)
- August 2026: OpenAI testing a "Persistent mode" keeping an agent working indefinitely plus "proactivity" that carries follow-up tasks across sessions — [memorylake](https://www.memorylake.ai/blogs/codex-forgets-project-context) (secondary)
- OpenAI's AGENTS.md was contributed to the Agentic AI Foundation alongside MCP (December 2025) — [Linux Foundation press](https://linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)

**Google Gemini CLI**
- MCP client support (stdio/http/sse), an extension system bundling MCP servers + commands + hooks, A2A remote agents — [awesome-slash integration guide](https://cdn.jsdelivr.net/npm/awesome-slash@4.2.2/agent-knowledge/ai-cli-advanced-integration-patterns.md) (secondary)

**Third-party survivors and casualties**
- claude-mem (third-party memory plugin for Claude Code) reached 72.4K stars / 6.2K forks *after* native auto-memory shipped — the native feature did not kill it — [Augment Code on claude-mem](https://www.augmentcode.com/learn/claude-mem-65k-stars); [emelia.io](https://emelia.io/hub/persistent-memory-claude-code-claude-mem)
- Supermemory now runs one memory workspace across Claude Code, Codex, Cursor and OpenCode, and made those plugins free — the cross-harness position is its explicit answer to lab memory — [Supermemory Codex changelog](https://supermemory.ai/changelog/plugins/codex.md); [Supermemory Cursor changelog](https://supermemory.ai/changelog/plugins/cursor.md)
- Third-party memory vendors' own framing: Codex's memory is "project-scoped, cloud-only, and locked inside OpenAI"; Copilot's expires in 28 days — i.e. labs ship *harness-locked* memory — [Supermemory](https://supermemory.ai/changelog/memory-for-openai-codex); [GitHub changelog](https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/)
- Sourcegraph Cody retreated to Enterprise-only (July 2025) and spun out Amp (December 2025) — a well-funded non-lab harness could not hold the individual tier — [Wikipedia: Sourcegraph](https://en.wikipedia.org/wiki/Sourcegraph)
- Cursor has raised $7.6B total; memory startup Mem0 is the "established name in agent memory" but at a tiny fraction of that capital — [neuronfeed comparison](https://neuronfeed.com/compare/mem0-vs-cursor); [hjarni comparison](https://hjarni.com/blog/mem0-vs-supermemory-vs-hjarni)

### Inferences
- Absorption lag: Cursor memories (June 2025) → Copilot (Jan 2026) → Claude Code (Feb 2026) → Codex (Apr 2026): the three labs converged on per-user/per-repo memory within ten months of each other. Plan mode, subagents, hooks, plugins, tasks: each shipped natively in Claude Code within roughly 3–6 months of the community version becoming popular.
- What survived: tools that are (a) cross-harness and (b) own a data layer the harness does not export (claude-mem's SQLite history, Supermemory's workspace). pjman's design (harness-agnostic, files in git, typed records) matches the survivor profile on paper. The threat is not "labs ship memory" (THESIS already says "not a memory tool"); it is labs shipping *team-scoped structure* — Anthropic's reported 2026 roadmap line about persisting insights "across an entire team," Copilot's repository-scoped memory shared across coding agent/review/CLI, GitHub's Spec Kit owning the spec→plan→tasks record shape, and Claude Code's native Task system with dependencies and multi-session collaboration are all steps toward the "shared graph" of pjman Phase 2.
- GitHub is the most dangerous absorber for pjman specifically: it owns the repo, PR and merge evidence (pjman's "observed state"), already ships repo-scoped memory and a records-in-repo workflow kit, and Copilot's memory is "validated against the current codebase" — a drift check.
- The labs' memory is harness-locked by design; harness lock-in is their business model. This is the durable gap pjman can occupy *as long as organisations use more than one harness*. If one harness wins an organisation, the gap closes.

### Gaps
- No primary Anthropic/OpenAI/Google statement about *organisation-level* shared context was found beyond an attendee's report of Code with Claude 2026; the official Claude Code CHANGELOG was not fetched (redirect).
- No quantitative data on third-party tool displacement (install counts before/after a native launch).
- The Claude Code Tasks system launch year is ambiguous in the only source found.

---

## Key Question 4 — MCP as a distribution channel

### Takeaway
MCP is real as a protocol (97M monthly SDK downloads, first-class client support in every major harness, governance under the Linux Foundation since December 2025) but weak as a *distribution* channel: the official registry is still in preview, 30,375 listed servers (Sept 2026) of which 62% have one version and 36% are stale, Anthropic itself lists zero servers there, and no public per-server install/usage data exists — "an MCP server exists" says nothing about daily use.

### Cited Findings
- Official MCP Registry launched in preview 2025-09-08 at registry.modelcontextprotocol.io — [MCP blog: registry preview](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)
- As of July 2026 the registry is "still in preview with breaking changes possible before GA" — [tech-insider MCP update 2026](https://tech-insider.org/ie/model-context-protocol-mcp-update-2026/)
- Registry snapshot 2026-09-10: 30,375 unique servers (99,114 version records); ~3x growth since May 2026 (~9,650); August 2026 alone added 6,265; 54.8% remote-only, 38.9% local packages; 62% have only one published version; 41% still at 1.0.0/0.x; 36% not updated in 3+ months; 23% lack a source repo; top publisher alone has 1,505 servers; 16,356 publishers have exactly one; **Anthropic: 0 servers; GitHub: 1; Microsoft: 16** — [dev.to: MCP registry by the numbers, 2026-09-11](https://dev.to/amareswer/the-mcp-registry-by-the-numbers-38nc); [aiskill.market, May 2026 snapshot](https://aiskill.market/blog/9652-servers-inside-the-mcp-registry)
- Anthropic donated MCP to the Agentic AI Foundation (Linux Foundation), December 2025, alongside Block's goose and OpenAI's AGENTS.md; platinum members AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI; MCP claimed "over 97 million monthly SDK downloads, 10,000 active servers and first-class client support across ... ChatGPT, Claude, Cursor, Gemini, Microsoft Copilot, Visual Studio Code" — [Linux Foundation press](https://linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation); [MCP joins AAIF](https://modelcontextprotocol.info/blog/joins-agentic-ai-foundation/)
- Harness support: Codex CLI is an MCP client; Gemini CLI is an MCP client with an extension system; Cursor shipped one-click MCP in 1.0 (June 2025); Claude Code plugins bundle MCP servers (Oct 2025) — [awesome-slash guide](https://cdn.jsdelivr.net/npm/awesome-slash@4.2.2/agent-knowledge/ai-cli-advanced-integration-patterns.md); [Cursor 1.0](https://cursor.com/changelog/1-0); [havoptic](https://www.havoptic.com/releases/claude-code/2025/10)
- Third-party directories: Glama ~17,000 indexed, Smithery 6,000+ (early 2026); Glama tracked ~51,000–71,000 daily "instances" Jul–Aug 2026 (definition of "instance" unclear) — [Composio on Glama alternatives](https://composio.dev/content/glama-alternatives); [Hugging Face mcptoplist dataset](https://huggingface.co/datasets/BIFF-AI/mcptoplist)
- "One upstream won": by mid-2026 the official registry became the upstream the directories mirror — [Towards AI, mid-2026](https://pub.towardsai.net/mcp-registries-in-mid-2026-one-upstream-won-2ce541b92036)
- Cal.com's and Plausible's experience is irrelevant here, but a related signal: third-party memory tools (Supermemory) distribute as native plugins per harness *and* MCP, not MCP alone — [Supermemory changelog](https://supermemory.ai/changelog/plugins/codex.md)

### Inferences
- The 10,000 "active servers" claimed by the AAIF (Dec 2025) versus 30,375 listed (Sept 2026) implies at most a third of listed servers see activity, consistent with the staleness figures.
- Anthropic's zero registry servers and reliance on its own connector directory suggest the labs treat their own first-party integrations as the real channel; a third-party MCP server competes with the harness's native tools for the same tool-call budget.
- Practical consequence for pjman: MCP is table stakes for Phase 1, not a growth engine; the per-harness adapters (skill, plugin, extension) are the actual distribution and each one is a maintenance surface that churns with the harness.

### Gaps
- No public per-server install or invocation counts for any MCP server on any registry; "active server" is undefined in the AAIF release.
- No evidence either way that an MCP listing drives sustained daily use; the only usage proxy (Glama "instances") is undefined.
- Registry GA date not announced as of the latest source (July 2026).

---

## Key Question 5 — Licence: MIT vs Apache-2.0 for a permissive framework with a closed hosted server

### Takeaway
MIT and Apache-2.0 remain the two most used licences (2025); Apache-2.0 adds an explicit patent grant and clearer contribution terms, which matters more for a company than a hobby project. The relicensing wave (HashiCorp 2023 → OpenTofu fork; Elastic back to AGPL 2024; Redis back to AGPL 2025; Sentry FSL; MinIO AGPL 2021; Plausible AGPL 2020; Cal.com closed 2026) shows that permissive-then-tighten is common, costly in trust, and only possible if the company holds the copyright (CLA) — so a permissive choice today should be made with a CLA and with eyes open that hosted clones *have* approached comparable projects.

### Cited Findings
- MIT and Apache 2.0 remain the most widely used open source licences in 2025 (OSI); Apache 2.0's "strong patent grant and clear terms for contributions make it a preferred choice for many enterprise and cloud-native projects" — [Linuxiac, 2025](https://linuxiac.com/mit-and-apache-2-0-lead-open-source-licensing-in-2025/)
- HashiCorp moved Terraform/Vault from MPL-2.0 to BSL 1.1 in 2023; it is "the only change in the sequence that has not been reversed"; "40-plus companies immediately joined the OpenTofu consortium"; HashiCorp "hit hardest" on community trust — [WZ-IT licence-change chronicle](https://wz-it.com/en/blog/open-source-licence-change-chronicle/); [softwareseni timeline 2018–2026](https://softwareseni.com/the-open-source-license-change-pattern-mongodb-to-redis-timeline-2018-to-2026-and-what-comes-next); [HashiCorp announcement](https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license)
- Elastic added AGPL as an option September 2024; Redis relicensed Redis 8 under AGPLv3 May 2025 — [WZ-IT chronicle](https://wz-it.com/en/blog/open-source-licence-change-chronicle/)
- Sentry's Functional Source License (Fair Source): source-available, no commercial competition, auto-converts to MIT or Apache 2.0 after two years; created because "traditional MIT/Apache 2.0/BSD licenses offer no protection against well-funded competitors taking the code and reselling it as a hosted service" — [Sentry: now Fair Source](https://blog.sentry.io/sentry-is-now-fair-source); [TechCrunch 2024-09-22](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/)
- MinIO moved from Apache 2.0 to AGPLv3 (completed May 2021) to stop cloud providers "freeloading"; in 2023 it publicly objected to Weka's use — [MinIO blog](https://www.min.io/blog/from-open-source-to-free-and-open-source-minio-is-now-fully-licensed-under-gnu-agplv3); [Blocks & Files on Weka](https://blocksandfiles.com/2023/03/26/we-object-minio-says-no-more-open-license-for-you-weka/)
- n8n uses the non-OSI "Sustainable Use License" ("fair-code") restricting hosted resale — [Wikipedia: n8n](https://en.wikipedia.org/wiki/N8n); [OSI license-discuss on fair-code, 2020](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2020-July/021811.html)
- Plausible MIT → AGPLv3 (2020): "we had been approached by large corporations wanting to sell a version of Plausible Analytics without contributing back" — [Plausible](https://ingest.plausible.io/blog/open-source-licenses)
- Cal.com (2026-04-15): commercial edition closed; community edition relicensed AGPL → MIT as Cal.diy; reason cites AI making vulnerability discovery in public code easier — [Cal.com v6.4](https://cal.com/blog/calcom-v6-4)
- Spec Kit (GitHub) and Cal.diy both chose MIT for the community artefact — [Spec Kit history](https://github.github.com/spec-kit/history.html); [Cal.com v6.4](https://cal.com/blog/calcom-v6-4)

### Inferences
- For pjman's shape (schema + CLI/library + MCP server open; hosted graph closed) the licence protects almost nothing either way: the moat THESIS names (the accumulated graph, being the default) is not in the code, and the code is small. Apache-2.0's patent clause and explicit contribution terms are the only material difference, and they favour Apache-2.0 for anything that may later have a company behind it; MIT is the community-expected default for a small framework and is what GitHub (Spec Kit) and Cal.diy picked.
- The relicensing cases show the real risk is not a clone in year one but a *well-resourced* hosted clone once the project has traction — every tightening above happened post-traction and was driven by hosted free-riders. Pre-traction, a permissive licence costs nothing; the decision that matters now is whether contributors sign a CLA/DCO so a later change remains possible without a fork-and-rewrite.
- Cal.com's AI-vulnerability reason is a new argument against publishing a *server* permissively; pjman's hosted server stays closed anyway, which already addresses that reason. The framework (files, CLI, MCP) has a smaller attack surface.
- Evidence that hosted clones actually *hurt* revenue is thin: Plausible and MinIO reported approaches and objections, not measured losses; Sentry and HashiCorp framed it as prevention. The strongest observed harm is reputational confusion (Plausible's "confusing people about whether services they sell are approved").

### Gaps
- No case found where a permissively licensed *framework* (as opposed to a self-hostable application) was damaged by a hosted clone; the harm cases are all applications (analytics, calendars, object storage, databases).
- No data on what fraction of contributors refuse to sign CLAs on small projects.

---

## Key Question 6 — "Build the tool you want" dogfooding as a founding strategy

### Takeaway
The best-documented argument is Paul Graham's "organic" ideas essay (2010) with examples (Apple, Google, Microsoft) and the caveat that "it takes experience to predict what other people will want"; practitioner literature adds the necessary condition that a critical mass of other people share the itch and will pay. No rigorous study quantifying success rates was found; the evidence base is essays and anecdotes. The comparables split along a line that matters for pjman: founder-as-user worked where the founder was representative (Linear's cofounders and their startup friends; Sidekiq's Rails developers; Spec Kit's GitHub engineers) and stalled where the founder's taste drifted from the market (Logseq's long rewrite).

### Cited Findings
- Paul Graham, "Organic Startup Ideas" (April 2010): two types of ideas — those that "grow organically out of your own life" and those "you decide, from afar, are going to be necessary to some class of users other than you"; "the most successful startups seem to be closer to the Apple type"; "it takes experience to predict what other people will want"; examples: Wozniak/Apple, Gates/Altair BASIC, Page & Brin/Google — [paulgraham.com/organic.html](https://paulgraham.com/organic.html)
- Practitioner caveat: "the difference between success and failure is the ability to find others with the same itch"; "the pain you set to solve shouldn't be yours alone, otherwise you risk building a product just for you"; examples Product Hunt (Ryan Hoover, 2013), Buffer (Joel Gascoigne, 2010) — [Indie Hackers: 3 founders who scratched their own itch](https://www.indiehackers.com/post/3-examples-of-founders-who-scratched-their-own-itch-and-succeeded-9039bb89ef); [Startups Magazine](https://startupsmagazine.co.uk/article-how-scratch-your-own-itch-success); [6Q](https://6q.io/blog/startup-model-success-scratching-your-own-itch/)
- Linear: first users were the cofounders' friends at small tech startups who liked that it was "highly opinionated ... built for them" — founder taste matched a reachable early market — [Contrary Research](https://research.contrary.com/report/linear)
- Sidekiq: a decade of prior attempts before the one that worked — [Indie Hackers podcast #016](https://indiehackers.com/podcast/016-mike-perham-of-sidekiq)
- Spec Kit: built by two GitHub engineers for their own AI workflow, then "takes off" eight months after launch — [Spec Kit history](https://github.github.com/spec-kit/history.html); [Visual Studio Magazine, 2026-05-12](https://visualstudiomagazine.com/articles/2026/05/12/github-spec-kit-takes-off-as-antidote-to-piecemeal-vibe-coding.aspx?p=1)
- Logseq: VC-seeded 2022, years in a database rewrite, community asking "Is Logseq dead?" — a founder-driven architecture agenda outrunning user-visible progress — [Logseq forum](https://discuss.logseq.com/t/is-logseq-dead/28849)
- Octoverse 2025: ~80% of new developers use Copilot in their first week — the market pjman eventually needs is less sophisticated than its founder — [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)

### Inferences
- Dogfooding at real work produces a tool shaped by one organisation's process (Linear, cmux, Claude Code). THESIS's constraints (nothing harness/vendor-specific in a record) are the correct hedge; whether they hold is only testable when a user with a different stack installs it.
- The comparables suggest the founder-as-user strategy fails less from wrong taste than from the founder's attention moving to architecture (Logseq) — a risk for a project whose Phase 1 is "the schema as a spec" and whose author is an architecture-first engineer.

### Gaps
- No peer-reviewed or large-sample study on founder-as-user success rates was found; this remains essay-level evidence.

---

## Cross-cutting risk summary for the go/no-go (inferences, drawn from the findings above)

1. **The economics do not close on the solo tier.** 1–3% conversion × $10/mo requires tens of thousands of active free users to matter; every bootstrapped comparable took 4–10 full-time years to a few $M ARR. Phase 1 should be judged as an open-source project with an option value, not a revenue path.
2. **Phase 2 is where the labs are heading.** Per-user/per-repo memory was absorbed by all four harness vendors within ten months (June 2025–April 2026); GitHub already has repo-scoped memory validated against code and a records-in-repo kit; Anthropic's reported 2026 roadmap names team-wide persistence. The window for a third-party "shared graph" is open only while organisations are multi-harness.
3. **What survived absorption is what pjman is designing**: cross-harness, data-layer-owning, open-format tools (claude-mem, Supermemory, Obsidian's format). That is the strongest evidence *for* the thesis, and it is also evidence that the survivors' revenue is small or unknown.
4. **Permissive licensing is safe pre-traction and historically tightened post-traction.** Choose with a CLA. Apache-2.0 if a company is intended; MIT is what the closest peers (Spec Kit, Cal.diy) chose for the community artefact.
