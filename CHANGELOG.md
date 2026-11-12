# Changelog

Every release, derived from the record: one line per change shipped, in the words the change was written in.

## 0.6.0 — 2026-11-12

### Changed

- **Dock live lines**: The docked session shows a copyable change id, and its Claude and pjman lines say what is actually happening (change:dock-now-lines)
- **One name per key**: Every alias of a source or change resolves through one resolver, prints in one form, and every view names how a record relates to a source (change:pjman-22)

### Fixed

- **Stop refusal keys**: The stop refusals suggest a decision key the command accepts, and follow the session off a change it unbound (change:pjman-23)
- **Name unbound sessions**: A session that binds no change and ran a tool is refused once at stop until it is named, so no question-only session ends unnamed (change:pjman-20)
- **Binding follows binds only**: A ticket in a prompt binds only a change that binds it, and a sync that creates a change binds it to the session (change:pjman-21)
- **Sessions find the store**: pjman session name and pjman where find the global store from a session outside any project, and the brief states the one-to-four-word name limit (change:pjman-25)
- **One dock per workspace**: In cmux the docked pane can be turned off, opens for no session outside a project, and is shared by a workspace's sessions instead of one per terminal (change:pjman-24)

## 0.5.0 — 2026-11-12

### Changed

- **Repo hygiene**: A first hygiene pass on the now-public repository: dead files and code gone, src in clear layers that import only downward (change:repo-hygiene)
- **Desktop app**: pjman works in Claude Code's desktop app as it does in the terminal: record, brief, wake, receipt and a view beside the session (change:desktop-app)
- **Dock redesign**: Rethink the dock's design so a working session reads at a glance: a clear order, room to breathe, the change's state unmistakable (change:dock-redesign)

### Fixed

- **Selection close floats**: The selected feature's close overlay on the product map scrolls away with an overflowing map instead of staying put (change:map-selection-close-floats)

## 0.4.0 — 2026-11-11

### Changed

- **Plugin follows brew upgrades**: Under Homebrew, pjman registers the Claude Code plugin at the stable opt path, so brew upgrade never strands it (change:pjman-18)
- **Switch installs without loss**: pjman init points the plugin at the install it runs from, and the adapter keeps its files where removing the plugin cannot reach them (change:pjman-15)
- **Homebrew install docs**: The Homebrew install written down: trusting the tap, an npm copy that shadows the brew one, outdated Command Line Tools, and upgrading (change:pjman-17)
- **pjman doctor**: A read-only check of the install that names each problem with the command that fixes it (change:pjman-19)
- **Follow window**: One browser window that follows the session in focus, opened by itself when a Rex session starts and none is open (change:follow-window)
- **README showcase**: The README opens with getting started and what init shows, says it works best in cmux and Rex, and shows the four lenses and the docked view in a real session (change:readme-showcase)

### Fixed

- **Refused write haunts index**: A refused create stays in the per-machine index cache: validate reports a file that does not exist and the write cannot be retried (change:refused-write-leaves-index-entry)
- **Dashboard keeps its port**: A restarted dashboard comes back on the port it had, so the docks already open keep working (change:pjman-16)

## 0.3.1 — 2026-11-10

### Changed

- **Releases and Homebrew**: pjman is versioned and released by tag, and installed and updated with Homebrew (change:releases-homebrew)
- **Public**: The repository public, the package on npm and the tap ordinary, with a README a newcomer can follow (change:public)

## 0.3.0 — 2026-11-10

### Added

- **Activity timeline**: One timeline component over the event stream at any scope, a single vertical rail: lanes from one axis as colours, the other axis on every dot, folding to a rollup as the scope grows (change:activity-timeline)
- **Map and record**: The product map shows the work at its leaves and the panel reads one node record at every level, product to capability (change:feature-detail)
- **Rex adapter**: A host interface with Rex as its first implementation: a session binds to the block that hosts it, its state is read from the host, the block carries where the work stands, and an answer reaches it through the host (change:rex-adapter)

### Changed

- **Public**: The repository public, the package on npm and the tap ordinary, with a README a newcomer can follow (change:public)
- **Rail pages**: The rail shows the last few rows, pages back through the rest and filters what it shows (change:rail-pages)
- **Session page**: What following a session shows at desktop width when it is not docked beside the terminal (change:session-detail)
- **Timeline follows the focus**: The session page's timeline holds only the shown change's rows, its own filter goes, and the wide panel grows by 100px (change:session-timeline-focus)
- **Clear moves the dock**: Clearing a session moves the docked pane off the ended session to a view that stands on its own, instead of the next session's empty page (change:clear-moves-the-dock)
- **Change page**: What a change's own page shows at desktop width beyond its record in the side panel (change:change-detail)
- **Cold start gaps**: A product with no map gets one through intake, by what the repository holds, and its first sessions are recorded wherever they start (change:cold-start-gaps)
- **Decision depths**: One decision card at three depths, a row, the ladder and the thread, opened in place with Accept for any option and a line in your words (change:decision-depths)
- **Run to the end**: Once the go is given, the plan runs to its end; the agent stops only at a decision it opened, a blocker it recorded, or the code committed for review (change:run-to-the-end)
- **Bridge rework**: The bridge orients and explores: the transport as its one timeline, the changes in motion as cards in a grid beneath it, hover and a held filter tying the two; no session list, no decisions (change:bridge-rework)
- **Decided decisions fold**: A decided decision's row reads the answer alone, and the decided list on a change folds to one line by default (change:decided-decisions-fold)
- **Aspects as work goes**: Aspects are proposed from what sessions say and do, so the cross-cutting is recorded without anyone asking for it (change:aspects-as-work-goes)
- **Alive step bars**: A change's step bar moves while a session works it, so the plan reads as alive and not as a count (change:alive-step-bars)
- **Interface audit**: The CLI and the HTTP API read as one coherent surface before release: verbs, flags, output and errors an agent uses right first time and a person understands (change:interface-audit)
- **Milestone page**: What a milestone's own page shows: its children, their progress and what waits beneath (change:milestone-detail)
- **Later shows milestones**: Later lists an unordered milestone with its open children beneath it, so it can be found and ordered as one (change:later-shows-milestones)
- **Questions become decisions**: An open question an agent lays out in conversation is recorded as a proposed decision before the turn ends (change:questions-become-decisions)
- **Milestone kind**: A milestone is a change of kind milestone, named at filing, so every surface reads the kind instead of counting children (change:milestone-kind)
- **Named unbound sessions**: A session working outside any change gets a name, a kind and its own sources, so a review or a backlog pass is found and shown as what it is (change:unbound-sessions)
- **Releases and Homebrew**: pjman is versioned and released by tag, and installed and updated with Homebrew (change:releases-homebrew)
- **README tune-up**: The README gets its screenshots and a tighter text before the repository goes public (change:readme-tune-up)

### Fixed

- **Bridge lost on sessions**: Opened from the bridge, the wide session page's rail has no Bridge entry, so the way back is only the pill (change:bridge-lost-on-session-page)
- **Session page too early**: The session page waits for a session the store does not hold yet instead of raising an error, and says plainly when there is no such session (change:session-page-before-record)
- **Start on the bridge**: A new session's docked pane opens on the product's bridge and follows the session only once it binds a change, as a cleared one does (change:start-on-the-bridge)
- **Filing moves the dock**: A session bound by the agent's own write (filing a change, or a bind) brings the parked pane to its page, as a prompt's bind does (change:bind-moves-the-dock)
- **Clear reaches the bridge**: A clear sends the terminal's pane to the bridge wherever the person had browsed it, not only when the hook last pointed it at a session (change:clear-returns-to-the-bridge)
- **Cross-origin server access**: Any web page open in the person's browser can read the whole store from the local server and write to it (change:local-server-cross-origin)
- **Card reads the plan**: A milestone's bridge card reads its own plan steps while its page reads its children, so the two disagree (change:bridge-card-reads-the-plan)
- **Step bar in order**: Every step bar draws the plan sorted, done then the one on then open then dropped, whatever order the steps were worked in (change:step-bar-in-order)
- **Rest takes the slug**: pjman rest accepts a change's bare slug inside the project, as every other command does (change:rest-takes-the-slug)
- **Dashboard reads slow**: The store's reads cost what the page or command asks, not the whole store; at 100x a load takes 12s and the map 7 minutes (change:dashboard-reads-slow)
- **Map page scroll**: The product map page scrolls the whole window past the app instead of scrolling inside its pane (change:map-page-scroll)
- **Host field unknown**: pjman validate warns unknown field 'host' on every session a host recorded, though it checks the field's shape (change:host-field-unknown)

### Store

- The kinds move: every change named as a parent a milestone by its kind. After installing, run `pjman migrate` until it reports nothing to migrate (each run makes one move; the stamp comes last).
- The session-kinds move: the kinds a session with no change may be given (review, backlog, chat, other) as records. After installing, run `pjman migrate` until it reports nothing to migrate (each run makes one move; the stamp comes last).

## 0.2.0 — 2026-11-06

### Added

- **Branch names**: Branch and worktree names: a change recommends one, derived from its key, and a session on a branch so named binds the change (change:branch-names)
- **The dock**: The dock: the view beside the terminal, following the session that opened it, made for a third of a screen (change:docked-view)
- **The bridge**: The bridge: the overview of every session running now, grouped by what each needs from the person (change:live-sessions)
- **Read at a moment**: The store at a moment: every read can be asked as of a time or an event, so the app can pause, step and rewind (change:read-at-a-moment)

### Changed

- **Dashboard design**: The dashboard's design, decided in conversation one detail at a time and built small (change:dashboard-design)
- **Install as copy**: The installed tool is a copy from a built package, installed after a merge to main, never a link to a development checkout (change:install-as-copy)
- **Store lock**: A lock around every store write and its commit, so two sessions never sweep each other's files into one commit (change:store-lock)
- **Server port**: The dashboard server honours PORT and registers its address only when it is the installed tool's (change:server-port)
- **Handle from the forge**: A person's handle is checked against the forge: init suggests the login and warns when the configured handle is not one (change:handle-from-the-forge)
- **Decided in chat**: A decision made in chat is recorded and acted on: the agent sets it decided by the person and carries out what the agreement implies, never asking for each step (change:decided-in-chat)
- **Worktree URLs**: Each worktree's dev servers run under portless, at a stable name for the worktree's branch (change:worktree-urls)
- **Motion design**: Motion and interaction design: how the dashboard moves and responds, so a live view says what changed, shifted, was added, removed or moved (change:motion-design)
- **Dock waits expand**: The dock's waits-on-you decisions are cards collapsed by default that expand in place, instead of a click opening the change's decisions tab (change:dock-waits-expand-in-place)
- **Copy decision keys**: Copy a decision's key wherever it is referenced: one shared control across the dashboard (change:copy-decision-keys)
- **pjman open**: pjman open: the dashboard brought back for a session, the session's page docked beside it or in the browser (change:session-open)
- **Hydration**: Hydration: the brief with a watermark, what the store has for a session since it was last briefed, carried in by the hooks (change:hydration)
- **Visible dependency edges**: Dependencies in plain sight: the roadmap draws every edge, the dock reads a change stacked on unfinished work (change:dependency-edges-visible)
- **Dock moves**: The dock moves with its session: when the change it shows changes, the old one leaves and the new one arrives (change:dock-moves)
- **Messages**: Messages: a person moves work forward from pjman, and the harness carries it into the session (change:messages)
- **Decide in place**: Decide in place: accept a proposed decision from the dashboard, and the session working its change is told (change:decide-in-place)
- **Dock drops Next**: The dock leaves out Next: a live session is the next, and Waits on you covers what is left (change:dock-next-list)
- **Aspects**: Aspects: what applies across the app, recorded once and linked to every place it applies (change:aspects)
- **Aspects in the dashboard**: Aspects in the dashboard: where an aspect applies, seen from the aspect, from a feature and from a change (change:aspects-dashboard)
- **Aspects on the roadmap**: The roadmap narrows by an aspect: the work on an aspect, in order and in time (change:aspects-roadmap)
- **Order affordances**: Ordering from Later is obvious: a slot to order last, the landing line, the grip, and an Order button (change:roadmap-order-affordances)
- **Aspect work on roadmap**: Aspect work is seen on the roadmap: a place counts as naming its feature, and a diamond marks the work (change:aspect-work-on-the-roadmap)
- **Record foundation**: Changes and decisions read as a ladder: name, gist, then a foundation written in full; facts derived, the rest of the app to follow (change:record-foundation)
- **Foundation migration**: The migration: every change and decision mapped into the new shape, nothing dropped; an ingested ticket creates a change in the new shape (change:foundation-migration)
- **Foundation skill**: The skill, the brief, the schema and the README say how a record is written now (change:foundation-skill)
- **pjman decision**: pjman decision: one command writes a decision at any size (change:decision-verb)
- **Decision card**: A proposed decision reads as its options with one recommendation marked once and its case as points (change:decision-card)
- **Status from the plan**: A change reads planning once it has a plan and active once a step starts or a session works it, without a hand-written status (change:status-from-the-plan)
- **Lanes skip unbound sessions**: The bridge's recent-session lanes show only sessions working a change; unbound ones fold into one line (change:lanes-unbound-sessions)
- **Releases and Homebrew**: pjman is versioned and released by tag, and installed and updated with Homebrew (change:releases-homebrew)

### Fixed

- **Session date at midnight**: A session that starts just before midnight is warned about by validate: its file name date differs from its started instant (change:session-date-midnight)
- **Phone-width record pane**: At phone width the record pane is drawn over the product map instead of replacing it (change:phone-width-record-pane)
- **Retire a decision**: A decision can be retired after the fact: supersedes is settable, so a decision made later can name the proposed one it replaces (change:retire-a-decision)
- **Duplicate rows beneath**: A change naming several features filled the expanded feature with one copy per feature it names (change:beneath-duplicate-rows)
- **Dock waits turn green**: The dock's waits-on-you items all turn green after opening a decision and coming back to the session page (change:dock-waits-turn-green)
- **Dock moves, held moment**: Returning from a held moment to now plays the dock's move animation (change:dock-moves-held-moment)
- **Order reads ahead**: The order reads what is ahead: done entries stay on the sequence and drop out of every reader (change:order-reads-ahead)
- **Fresh dock slow load**: A fresh session's dock is slow to load or never loads (change:dock-fresh-slow-load)
- **Accept is slow**: Accepting a decision from its card takes 10 to 15 seconds before the card clears (change:decide-is-slow)
- **Transport stuck**: Once an event or time is chosen on the transport, further clicks, previous and next do nothing (change:transport-stuck-on-selection)
- **Receipt is the session's**: The turn's receipt lists only what this session and the sessions it spawned wrote (change:receipt-session-scope)
- **Done changes read live**: A feature named by a done change derives live, and the authored status stands when nothing decides it (change:derived-status-done-changes)
- **Fast session start**: A session starts and docks in about a second, however many worktrees the repository has (change:session-start-fast)
- **Clear keeps the dock**: Clearing a session keeps its docked pane and points it at the new session's page (change:clear-keeps-dock)
- **Source chips open sources**: A source chip opens the source itself: its URL when the record has one, one built from the key otherwise (change:source-chips-open-source)

### Store

- The layout move: every record keyed under its product. Run `pjman migrate` once after installing.
- The foundation move: every change and decision in its shape. Run `pjman migrate` once after installing.

### Also

- tool: the roadmap's model — depends_on on a change (what must land before it; cycles and self refused; an edge the getter and the context show both ways), kind=bug with a severity read from the tree (product, feature, capability, nuisance, cosmetic; severity is a bug's field; the listing orders bugs worst first then oldest; a sync sets the kind from the tracker's bug label and never the feature or severity), target on a change (a milestone's date, a person's), sequence on a product (the order, change keys, no repeats); set, rm --detach, mv and the index follow; schema and README (c6a71e2)
- tool: the roadmap derived — pjman order moves a change in its product's sequence (before, after, first, last, later) and POST /order is the API's one write, the same function as the person signed in; the scope carries each change's position, dependencies, target, began and finished, a bug's home at its severity's level with counts rolled up and nothing repeated beneath, the bug queue worst first, and the roadmap: the sequence in scope, what comes later, and the four checks (order, target against dependency, target against order, overdue) that warn and never reorder (0112265)
- tool, adapter: intake — pjman intake <text> answers with what already exists before a request is filed: open changes that share its words or are named in it (the duplicates, a referenced ticket scoring highest), done ones like it (a regression or the old change to link), the nodes of the map it may alter with their path and level, the milestones in flight nearest to done first, the order's tail; also /intake?text= on the API. The intake skill carries the procedure: duplicates first, then four questions with defaults (what on the map, one or several, where in the order, when) and the one-line answer; the pjman skill and the brief send every filing through it (245f2cf)
- ui: the roadmap lens replaces the milestone lens — lanes on one horizontal axis: the features of the map as rows (nested, collapsible), the past by time as bars from began to done with in-flight work reaching the seam, the future by sequence as a column per entry of the product's order (a milestone holding its children, a loose change itself, later closing the list), dependencies drawn when an entry is focused, a warning where the order contradicts a dependency or a date with 'move it after' as the repair, drag to reorder as the app's first write through POST /order; a roadmap home in the record pane (the order as a list, later, warnings, the loudest bugs); a bugs view on any scope (worst first, grouped by what is lost, each listed once at its home) with the rail counting only product and feature severity; the node header's health line names the bugs beneath; change and milestone records show kind, severity, target, depends on and needed by; old /milestone links open the roadmap (00dc28b)
- license: Apache License 2.0 — LICENSE verbatim, NOTICE with the copyright line, the license field on both packages, a License section in the README (5660046)
- tool, adapter: the map — pjman apply lands many writes as one commit (the commands one per line, every commit and event held, one 'applied' event on the record --for names; a line that fails refuses the whole batch and nothing is written) and pjman undo reverts a batch as one commit, refused while a later write touched its records; pjman mv renames a feature with the old slug kept as an alias, every effect rewritten; pjman init asks once whether the first session should propose a product map (--map/--no-map; the project's map field) and pjman context opens with one line while the product has no map; the map skill: survey the person's words, the documentation, the code's split and the store, draft the top level as the layers of the stack titled as sentences, nest by the code's split two levels deep, propose the whole tree in a proposed decision, apply it on the go as one batch, verify; the pjman skill and the brief point at it; the receipt shows a batch as one line (50fd72d)
- tool, adapter: a cold-started map reads as authored — a feature's derived state lets the authored status stand when no change names it, so a map proposed from the documentation shows live where the ladder says shipped until changes take over; the map skill checks every slug against the store (feature keys are global across products), gives cold-start nodes their status from the documentation, and names the map change for its product (a93bea7)
- tool, ui: the product switcher — the rail's header is a menu when the store holds more than one product (each with its short name and one line of health: open changes, in flight, loud bugs; the current one checked; choosing one opens the same lens at that product's overview) and the product's name alone when there is one; the generated monogram is gone; a product carries a short name like a feature (name on new product and set; the crumbs, the rail and the scope node show it, the title stays the sentence); the store route lists products with their health. Bug: a refused write on an existing record put nothing back, so a bind to a missing change left the session file modified for the next write to commit; every path a write touches is snapshotted first and restored on refusal (session log, bind, observe; the decision a new one supersedes) (137389b)
- ui: the product stays the root node and the rail mimics a frame over it — the top bar's crumb starts beneath the product (the rail already names it) and on the product's own page names the lens (Product map, Roadmap) with no kind tag; the root of the app opens the product last opened (remembered in preferences), else the first, and shows the store's root only when it holds no product (decision product-frame/product-stays-the-root) (dadf8f9)
- ui: one source of truth for the page's product — the URL names it when its node is a product, else the page's own scope says which product it is beneath; a previous page's scope kept as placeholder and the store's product list are never consulted, so the rail no longer flashes another product before the scope arrives, and the top bar's crumb and current node wait for fresh data instead of showing the last page's (9ca0d1d)
- ui: identity has one source — lib/identity.ts is the one place a page's product is read (the URL's node when it is a product, else the page's own scope once it has arrived, never the store's list or a previous page's placeholder), with its tests; the README states the rule beside the three kinds of state (fa47e63)
- tool, ui, adapter: keys are paths under the product — a feature, a change and a decision are keyed feature:<product>/<slug>, change:<product>/<slug>, decision:<product>/<change>/<slug> (product level decision:<product>/<slug>; store level decision:/<slug>); position in the tree stays a field, never part of a key; the store's folders follow the key (products/<p>/{product.md, features/, changes/, decisions/}); a bare slug resolves through the scope at hand (the record's product, the current project's product, the page's node), store-wide when one product has it, refused as ambiguous otherwise; the store writes full keys (new, set, session bind and observe, order normalise what was typed), text output read inside a project drops the product segment and JSON keeps it; pjman migrate moves a flat store once as one commit with every record's old slug kept as an alias and the old flat key still resolving (the holder wins when two products share a slug); mv renames products (every key beneath follows, old segment aliased), moves a feature or change to another product (a change into that product's one project), and renames a person (old handle aliased, the user config follows); set refuses a project of another product and names the move; init creates the product with the project (--product joins an existing one), names the person by their forge login or git name and makes their record with their accounts (github-user, email) as links; identity source kinds in the grammar, personOf resolves an account to the person who claims it (one person per account), GitHub assignees become owners when claimed; the dashboard's key helpers know the product segment and route a decision to its change; the schema, the README, the brief and the skills state the rule (decisions keys-under-the-product/product-is-the-namespace, layout-follows-the-key, person-key-is-the-handle). Also carries the session-date fix from the parallel session: a session file is named by the local day it started. (d01a730)
- tool: the install restarts the dashboard on the port it had (79e775c)
- repo: worktrees branch from local main and share the checkout's node modules by symlink; the project instructions say to work on a change in a worktree named for it and to remove it once merged (09b70c8)
- Merge branch 'main' into live-sessions (5b24fbd)

## 0.1.0 — 2026-10-26

Everything before the record existed: the thesis, the schema, the tool, the adapter and the first dashboard, as 77 commits with no change behind them. Tagged after the fact, at the last commit before the first change-attributed one, so that 0.2.0 reads from here.

### Also

- docs: the thesis — alignment is hard, execution is easy (2670f75)
- docs(thesis): positioning — solo first, pay per signer, growth-path displacement (376aec9)
- docs(thesis): pricing revised (paid solo tier), views over one graph, the customer's question (81f0990)
- docs(thesis): the shape — free framework + hosted service; domain-agnostic core, software first; open-core line sharpened (767a10b)
- docs(thesis): open-source framework, proprietary hosted service, built in parallel (decision 23) (6a8e8a2)
- docs(thesis): tenets — the free framework is complete on its own; build the tool its builder wants to use (2129990)
- docs(thesis): two phases — the open-source framework first, the hosted product second (decision 24; 23 revised) (cf865d7)
- docs(thesis): a feature is not defined, its contract is (decision 25) (dff4ef2)
- docs(thesis): software factories — pjman as the PLM and quality system around the line (ad1c3c5)
- docs(thesis): Phase 1 re-pointed — the framework is the work tool (claude-session-board) extracted; the three distances (17084b4)
- docs: the roadmap — five phases, Phase 1 in order, the constraints on decisions made now (81306f6)
- docs: many parents, one owner (decision 25 revised); the four-noun vocabulary (decision 26); roadmap wording aligned (506379a)
- docs(thesis): identity — generated UUIDs with a map to external entities (decision 27, provisional); paused (e05e1c2)
- docs: storage architecture — records are the truth, a graph is the index, the schema is independent of storage (decision 28); identity firmed (27) (ea3c8bf)
- docs(thesis): how to read this — the context graph as substrate, the alignment thesis as a layer on it (4065527)
- docs: thesis resynthesised as pitch + roadmap around the context graph; decision log split out; ROADMAP.md folded in (fd3d87d)
- research: is pjman worth building — landscape, problem evidence, evolvability (go narrowly, with a kill gate) (18d8f59)
- docs: layers catalog — the most popular technology at each layer, and where pjman rolls its own (22cb32a)
- docs: humans and agents are the same kind of participant (decision 30); tenet restated; writer field as a Phase 1 constraint (935034d)
- docs: schema draft v0 — five record types, the edge set, the status vocabulary, identity, location, validation, six open points (08e9608)
- docs(schema): draft v1 — organised in five layers (core, sources, work, product, authority); default/due moved to layer 4; open points narrowed to five (df01f0e)
- docs(schema): draft v2, minimal — the envelope with provenance, principals as records, the extension rule, the spawn rule, content pruned to ext/body (0283f1d)
- pjman: bootstrap the store on itself — product, two principals, five sources, five Phase 1 changes, seven decisions, one session (8cee6c5)
- schema: four amendments from the walk-through; source filenames re-slugged; change opened for DECISIONS.md as a view (ef07359)
- docs(schema): the graph as a Mermaid ER diagram beside the tables (a87832a)
- rename: principal -> actor across the schema, thesis, decisions and the store (6c5354b)
- reviews: adversarial round 1 on schema v2 and the Phase 1 plan — six reports and the verdict (975998a)
- docs(schema): v3 — Phase 1 only, adversarial round 1 folded in (4e69e2d)
- docs(schema): v3 — aliases and pjman mv for renames; the store as a git repository in two modes (in-project, standalone) (17b02f3)
- docs(schema): init defaults to standalone; the git policy (init, mv, read, commit-in-standalone-only) (3142eda)
- docs: thesis rewritten to the current plan; schema history moved to the decision log (31, 32) (b8b8b22)
- feat: the pjman tool — init, new, session, validate, fmt, ls, context, show, mv, index, query (24048e0)
- store: rebuilt through the tool; documents cleaned; DECISIONS.md retired; pjman set (646dd03)
- docs: example ticket keys are ABC-1234 (1678984)
- fix(view): a superseded decision names what superseded it; ls orders by date within a type (37c0582)
- store: adapter decisions opened proposed; change to planning (caba0da)
- cli: help per command, exits 0; --version; where listed (e6a267c)
- store: adapter decisions decided; contract amended with observed edges, hydration, subagents; change active (8a2705b)
- feat(adapter): the Claude Code plugin — seven hooks and a skill; every session starts from the record (d8f3255)
- store: session closed; handoff to the first adapter-recorded session (d88c370)
- store, docs: the review fixes land; the test dropped; Phase 1 folds in the first two stages; the second user restated (9620826)
- store: the record moves to the global store at ~/.pjman/store; the repository no longer carries .pjman (8ef6e19)
- cli: pjman set edits a proposed decision's text (decision=, why=); a decided decision's text is fixed (53739ad)
- feat: the global store and the project level — init joins ~/.pjman/store and registers the repository as a project; changes carry their project; the board scopes by project (1f1b013)
- tool: ls shows each record's date; dates are local calendar days; the store resolves from inside its own directory (5e5ceaa)
- tool, adapter: the getter — pjman get resolves any reference and returns the record, its edges and every change in reach (eed4007)
- schema, tool: a change may name its parent change — any depth, no cycles, any project; children derived; the board nests them (157bd0f)
- tool, adapter: the view beside the session — pjman view renders what a session is on as a document; the adapter docks it in cmux and refreshes it on every event (e294a49)
- tool, adapter: the event stream — every write appends an event to events.jsonl; pjman follow tails it; views subscribe; rebuilt from git (795f5a7)
- tool, ui, adapter: the dashboard — pjman serve exposes the library under /api/v1 with the stream as server-sent events; a React app on it; the adapter docks the session page (2005271)
- tool: the Linear sync — an MCP client over Streamable HTTP, OAuth 2.1 with dynamic registration, and pjman sync linear (4b6322f)
- tool, adapter: pjman never signs in to a tracker — the harness holds the Linear connection; pjman sync linear --from applies observed JSON (6402012)
- tool, adapter: agent-first — pjman init is the whole onboarding; start/stop; the brief every session; repositories register themselves; branch and PR observed (f3b8cae)
- tool: tracker sync split into a shared apply step and per-tracker translations; pjman sync github for GitHub issues (311da56)
- tool, adapter: GitHub sync verified on a real repository; the read command is the GraphQL query pjman sync github prints; #n and owner/repo#n resolve (a03a657)
- tool, adapter: one reference grammar per source kind — src/refs.ts is the only place a shape lives; pjman refs scans text; the hook knows no patterns; a change is created for a ticket only from what the tracker answered (5669859)
- tool: pjman rm — remove a record; refused while referenced, naming each referrer; --detach drops droppable references in the same commit; a change takes its decisions; the event is removed, rebuilt from git (aa81b67)
- tool: pjman mv renames projects and decisions too — a project's bound directories follow it in the user config; a decision moves within or across changes with its date prefix; every reference rewritten in one commit. set reaches actors (name, url); sessions stay append-only (ae01c2a)
- tool: the product tree — product (fixed root) and feature (one nestable kind, levels labelled from the template) records; owners on any node, inherited; a change names the features it affects with an effect; derived feature state; pjman tree; pjman activity over the event stream rolled up through the tree (9817ee9)
- tool: a feature is building only while a change affecting it is active, in review or blocked; planning and open are not in flight (bc99741)
- tool, adapter: the receipt — pjman events --receipt folds the stream since a point into one line per record for a person; the Stop hook shows it as a system message after every turn that touched the store (71d07ec)
- tool: a parent change is a milestone — progress derived as children done over children (dropped excluded), shown in context and on the board; the docs say "the features a change adds, changes or removes" and "name the most specific node", and name the third lens (d2c1a0b)
- tool, ui: the dashboard foundation — one page template over /api/v1/scope: a node of the product tree in a lens (project, feature, milestone) drawn as a tree or as lanes, with the shared components (change row, health strip, live sessions, owners, activity) scoped to the node; home is the product; the width decides panes, never routes (dce503e)
- ui: the toolchain for the rebuild — Vite 8, React 19, TypeScript 7, Tailwind 4 with the token contract, shadcn components copied in, TanStack router and query, zustand, headless-tree, oxlint with import boundaries, oxfmt, vitest; six themes as token files (Graphite default, Paper, Nord, Catppuccin, Tokyo Night, Gruvbox); the old app removed (a7fbde9)
- ui: the app rebuilt on the design — one shell (rail, top bar, two panes), the feature lens as a product map with connectors and a detail panel, the project lens as a work queue in lanes by status, milestone or who moves it next with an inbox of what only a person can move, the milestone lens as a goal page, activity as a view, ⌘K to jump anywhere, the link rule; three kinds of state with one owner each (URL, query cache fed by the event stream, a preferences store); contract types from the tool's declarations; tool: feature name field, the inbox list and project progress on the scope, names on every feature (09423d9)
- ui, tool, docs: tests for the models and the link rule; the scope tests cover feature names, the inbox list, project progress and named crumbs; crumbs carry names, the backlog is summarised by feature at the product root; README for the app's architecture and the dashboard section rewritten; the skill asks for a feature name (9c9af43)
- ui: the palette's search text never stringifies an object (bf1a5c2)
- ui: scope and selection are two things — the path is the scope, ?sel is the selection (history replaced), a click selects and highlights, double-click or Focus drills; the record pane names what it shows (this/selected kind, the path from the scope) with tabs overview, activity, decisions; the lanes open the record as a peek panel; activity leaves the rail; keyboard navigation left for later (58e2c32)
- ui: a filter bar over the product map (text, state, level; all URL state, the seed of saved views) replaces double-click drilling; the milestone lens opens on a home page across the goals (progress together, reached, waiting, live, nearest to done first); a floating selection badge at the bottom of the structure pane clears the selection in every lens, as does the pane's close and clicking the selection again (a926408)
- ui: the product map opens collapsed every time, only the path to the selection open, expansion no longer persisted; the level toggles leave the filter bar (text and state stay) (c77bfde)
- ui: the overview of a node is one shared header (level, name, sentence, owner, a health line: active, stale or not started, last moved, open and in flight, done in the window, waiting on you) over a body chosen by template level: the product is the portfolio (features by state as filter links, goals nearest to done, features by motion, what waits, who is live), a feature is its capabilities and the work beneath grouped by intent and capped into lanes, a capability is the work itself; intent groups lead with waiting on you; the change card can say the verb on the node it is seen at; the reserved Signals slot (e0367ea)
- ui: a capability that holds capabilities lists them first, the same compact list a feature shows (683b3ee)
- docs, skill, brief: the three levels defined by the question each answers and who asks it (product, feature, capability), nesting as the robustness, area as the per-product insertion; the agent files by these definitions (e0f2232)
- ui: a waiting decision opens in place on click, the whole decision and its why, a copy of its reference and a link out to the change's decisions tab; nothing navigates on the first click (a2b17fb)
- ui, tool: the person's queue is indexed by change — a work card carries its asks (decide n, review, unblock) and opens in place in the record pane (next in full, each decision readable with a copy, every feature with its verb, an explicit open), or selects in a structure pane; the inbox lists changes needing a person most recently moved first with their decisions beneath, strays shown on their own; waiting wins whatever the status; one grouping in lib/work shared by every lens. History follows places: select, clear and focus push so Back undoes the last click, tab, grouping, filter and flags replace, each pane restores its scroll. Tool: the change row carries when it last moved (c1d6699)
- ui, docs: two lenses — the project lens is removed; feature and milestone remain, with tree, lanes and inbox as views of any scope; the work views move to features/work; a project has no lens: it is a chip on cards when a scope spans several and a page on the getter listing its open changes; the link rule sends project keys to the getter; a session on a project is followed at the product root; the READMEs say what the dashboard shows and that the server still answers lens=project (affead7)
- ui: a milestone filter on the feature lens (?milestone=<change>) narrows the scope and the selection to the work beneath one goal before anything is drawn — the map to the features touched with ancestors kept and counts recomputed, lanes, the inbox and the overview's work to those changes, the waiting decisions to theirs; a picker of goals in flight on the filter bar, a chip with progress when chosen, a banner on the record pane, the no-feature footer names the milestone; the goal page links to it; health stays the node's (a85ac2e)

