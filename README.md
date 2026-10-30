# pjman

A context graph for product development: typed records (changes, decisions, sources, sessions, actors) as files in git, under one schema, with a tool that is the schema. The thesis is in `THESIS.md`; the record contract is `SCHEMA.md`.

## Install

```bash
git clone <this repository> && cd pjman && npm install && npm run install:local   # until the package is published
cd ~/Projects/<your-repo> && pjman init
```

`npm run install:local` installs the tool as a copy of a built package, never a link to the checkout: it builds, packs, installs globally, points the Claude Code marketplace at the installed copy and refreshes the plugin, and restarts the dashboard when one was running. Run it again after every merge to main; a session's half-built checkout is then never another session's tool. When the installed tool asks for a store migration, run `pjman migrate` once, after the install.

`pjman init` is the whole onboarding: it creates the global store if missing, registers the repository as a project, sets you as the actor (a handle of your own, suggested from your forge login, else your committer name, else this machine's account name, so there is always one; the accounts it knew, the login and the email, are linked on your person record), installs the Claude Code plugin from this checkout when `claude` is on PATH (hooks, skill, brief, Linear's MCP server), runs `pjman start` (the dashboard, detached) and prints what exists and what is left, which is at most signing in to the tracker from inside a session with `/mcp`. It asks one question, whether the first session should propose a product map from the repository (yes by default; `--map` or `--no-map` answers without asking), and records the answer on the project: while it is yes and the product has no feature, `pjman context` opens with one line saying so, and the map skill surveys the repository and proposes the tree. Running it again is the health check; it repairs what is missing and never undoes anything, and it ends with who you are as the store and the apps see it, the same read as `pjman whoami --verify`: your handle, each account with a verdict (verified, unknown, unchecked), and what is off with the command that resolves it. A handle whose record claims no account of a handle kind (a forge login) is provisional, as one from the committer name or the machine is: init and the session start say so and offer the rename (`pjman mv person:<old> person:<new>`, the old handle an alias, the config and every reference following) or the claim (`pjman set person:<handle> links=…`); a re-run of init claims the forge login itself only when it equals the handle. Once an account of a handle kind is claimed the handle counts as chosen, whether or not it matches a login, and nothing says it again; a sign-in claimed by another person is always said; an account the app does not know is said and never dropped. The apps' answers are cached for a day. `pjman stop` stops the dashboard; `pjman init --brief claude-md` also writes the brief into `~/.claude/CLAUDE.md` for sessions that run without hooks.

After that nothing is asked of you: a session in any git repository registers it as a project (`auto_register: false` in `~/.pjman/config.yaml` turns that off), starts with the brief and the board in front of the model, binds to the change or ticket a prompt names, observes the files, branch and pull request it works on, and docks the dashboard beside itself.

## The store

One global store per person: `~/.pjman/store`, its own git repository. `pjman init` in a repository creates the store the first time, registers the repository as a project (`project:<folder-name>`, or `--name`), and maps the repository's path to that project in `~/.pjman/config.yaml`. The tool commits every write it makes there. A change belongs to the project of the directory it was created from; `pjman context` is that project's board, `--all` every project's.

Resolution from any directory: `--store <path>` / `PJMAN_STORE`; else a store root or a `.pjman/` walking up; else the user map, which also names the current project.

A project may name its `tracker` (`pjman set project:<slug> tracker=linear`): the source kind of its tickets. A ticket id or ticket URL then resolves through the getter to the change that binds it, and the adapter binds a session to that change, creating it when none binds the ticket.

`pjman init --in-project` makes a store at `<repo>/.pjman/` instead, tracked with the project and never committed by the tool. It is set aside: kept for a repository that must carry its own record.

```
pjman.yaml                                             name, layers, vocabulary, source_kinds
products/<p>/product.md                                product:<p>                 the root and the namespace
products/<p>/features/<slug>/feature.md                feature:<p>/<slug>          nests by its parent field, never by folder
products/<p>/changes/<slug>/change.md                  change:<p>/<slug>           carries its project (a project of <p>)
products/<p>/changes/<c>/decisions/<date>-<slug>.md    decision:<p>/<c>/<slug>
products/<p>/decisions/<date>-<slug>.md                decision:<p>/<slug>         (product level)
products/<p>/aspects/<slug>/aspect.md                  aspect:<p>/<slug>           what applies across the product; the body is the base
products/<p>/aspects/<a>/places/<place>.md             aspect:<p>/<a>/<place>      where it applies (a feature); the body is the fork
decisions/<date>-<slug>.md                             decision:/<slug>            (store level)
projects/<slug>.md                                     project:<slug>              a repository, naming its product
sources/<kind>/<key-slug>.md                 <kind>:<key>                (optional; a source may exist as a key only)
sessions/<date>-<id>.md                      session:<id>
actors/<handle>.md                                     person:<handle> · agent:<handle>  (a person's accounts are links, the first of a handle kind the primary one: github-user:<login>, email:<address>)
index.db                                     derived, git-ignored, rebuilt by `pjman index`
```

Keys are a namespace and a slug: the product for features, changes and decisions, the store for the rest. Position in
the tree is a field, never part of a key. Inside a project the slug alone names a record (`change:schema`,
`feature:store`, `decision:schema/keys`): the tool resolves the short form in the project's product, store-wide when
one product has the slug, and refuses it as ambiguous otherwise. The store writes full keys; text output read inside a
project drops the product segment, JSON keeps it. `pjman migrate` moves a store from the flat layout before this, once.

## Commands

```
pjman init [--name <project-name>] [--map|--no-map] [--brief claude-md] [--no-adapter] [--no-start] [--in-project]
pjman new product <slug> --title … [--name <one to three words>] [--owners <actor>]… [--levels <label>]… [--sequence <change>]… [--summary …]
pjman new feature <slug> --title … --product <product> | --parent <feature> [--status planned|building|live|retired] [--level <label>] [--owners <actor>]…
pjman new project <slug> --title … [--product <product>] [--parent <project>] [--tracker <source-kind>] [--map propose|skip] [--owners <actor>]… [--links <key>]…
pjman new aspect <slug> --title … [--parent <aspect>] [--owners <actor>]… [--body <base>|-]
pjman new place <aspect>/<place> --feature feature:<slug> [--body <fork>|-]
pjman new change <slug> --title … [--status open] [--project <key>] [--parent <change>] [--features "adds feature:<slug>"]… [--aspects "changes aspect:<slug>"]… [--depends-on <change>]… [--owners <actor>]… [--summary …] [--plan …] [--next …] [--binds <key>]… [--links <key>]…
                                [--kind bug --severity product|feature|capability|nuisance|cosmetic] [--target <date>]
pjman new decision <change>/<slug> | /<slug> --title … [--decided-by <person>] [--decided-on <date>] [--supersedes <decision>] [--decision …] [--why …]
pjman new source <kind>:<key> [--title …] [--url …]
pjman new actor person:<handle> | agent:<handle> [--name …] [--url …]
pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>]
pjman session log <id> <text>          append to the session's ## Log
pjman session bind <id> <change> [--reason prompt|created|branch]   record that the run worked on a change (pjman new change binds the session creating it)
pjman session focus <id> <change>      what the run is looking at (pjman context <change> sets it for the session in PJMAN_SESSION); the dock follows it
pjman brief --session <id> [--full]    what the store has for the run since its last brief: the bound change in full when the binding moved, else what others changed on it, its milestone, decisions and dependency edges; recorded as its watermark; ends with its size
pjman note <change|session:<id>> <text>   a note to whoever works a change, or to one running session; given in full in the next brief, and it wakes an idle session bound to it where the adapter can
pjman wakes --session <id> [--follow]  the events that wake a session (a decision on its bound change decided, a note to it or its change); --follow as they land, for the adapter
pjman session unbind <id> <change>     back out a binding made in error, with the edges observed on it; logged
pjman session observe <id> <edge> <from> <to>   record an observed edge (evidence)
pjman validate [--json]                every record, every reference; errors are reported, never dropped
pjman fmt [--check]                    canonical field order, the YAML rule, repaired quoting
pjman ls [type] [--status s] [--project <key>] [--kind bug|work] [--json]   records in creation order, with their date; bugs worst first, then oldest
pjman events --receipt [--since <seq>]  what the store received, one line per record, for a person (the adapter shows it after every turn)
pjman tree [product:<slug>|feature:<slug>]   the product tree: features at labelled levels, derived status, owners, backlog by project
pjman activity <key> [--days 14]       the events beneath a node, through every chain, and what they say about health
pjman context [<change> | project:<slug>] [--all] [--json]   what an agent reads first: this project's board, or one change with its decisions, sources, sessions
pjman get <ref>                        the getter: a key, a URL, a ticket id, a file path or a slug in; the record, its edges both ways and the context of every change within two hops out
pjman intake <text|->                  what already exists for a request before it is filed: duplicates (open changes sharing its words or named in it), done ones like it, the nodes it may alter with their path, milestones in flight, the order's tail; never writes
pjman refs <text|->                    every reference in a text, in order, with the change it leads to; what a prompt is about
pjman view [<ref>] [--out <file>] [--watch]   one reference as Markdown; --watch re-renders on every event in the stream
pjman open [--session <id>]   the dashboard brought back, at a session's page when one is named (else PJMAN_SESSION); docked beside the terminal in cmux, the default browser elsewhere
pjman show <key>
pjman order <change> --before <change> | --after <change> | --first | --last | --later   move a change in its product's sequence, the roadmap's order; the rest is never touched
pjman set <key> <field>=<value>…   change an authored field (title, status, kind, severity, project, parent, depends_on, features, target, next, links, binds, summary, plan; name and sequence on a product; map on a project; on a proposed decision also decision, why; on any decision supersedes, which only adds and marks each named decision superseded in the same commit; ext.<owner>.<field> on any record); a list is comma-separated
pjman mv <key> <new key>               rename a change or a feature (alias kept), a product, a project or a decision; every reference rewritten
pjman apply [<file>|-] [--for <key>]   many writes as one commit: the commands one per line (new, set, mv, rm, order, session), one commit and one 'applied' event at the end; a line that fails refuses the whole batch
pjman undo [<commit>]                  revert the last batch (or the commit named) as one commit; refused while a later write touched a record of it

One writer at a time: every write command takes a lock on the store (a file under `~/.pjman/locks`) before it touches a file and releases it after its commit, so two sessions writing at once never commit each other's half-written records; a second writer waits a few seconds, then refuses naming the holder; a lock whose process is gone is reclaimed.
pjman rm <key> [--detach]              remove a record (a change with its decisions); refused while referenced, --detach drops droppable references
pjman events [--since <seq>] [--json]   the store's event stream, one event per write; `pjman events rebuild` derives it from git history
pjman follow [--since <seq>] [--json]   print events as they are appended, until interrupted; what a view subscribes to
pjman sync linear|github --from <file|-> [--project <key>]   apply tickets observed through the harness's tracker tools: sources and the changes that bind them
pjman start [--port <n>] [--open]      the dashboard, detached (installs and builds the app if the checkout has none); pjman stop stops it
pjman brief                             the brief an agent needs every session (the adapter injects it)
pjman serve [--port <n>] [--host <addr>] [--static <dir>] [--register|--no-register]   the store over HTTP: the API under /api/v1 and the dashboard. The port: --port, else PORT from the environment (how a proxy such as portless hands one down), else a free one. The installed tool writes its address to ~/.pjman/serve.json while it runs (what the hook docks and pjman start reuses); a server started from a checkout or a worktree prints its URL and claims nothing unless told --register
pjman index [--json]                   rebuild index.db: ids, reverse edges, conflicts
pjman query "<sql>"                    read the index
pjman where
pjman whoami [--verify] [--fresh]      who you are: the person, their record, their accounts in order with the first of a handle kind as primary; from the store alone. --verify asks each account kind's checker (GitHub through gh; a kind with no checker is unchecked), cached for a day (--fresh asks again), and says what is off with the command that resolves it. Writes nothing
```

Global flags: `--store`, `--writer <actor>`, `--session <session>`, `--created <date>`, `--json`. Environment: `PJMAN_STORE`, `PJMAN_WRITER`, `PJMAN_SESSION`, `PJMAN_HOME`.

With `--session` (or `PJMAN_SESSION`) set, every write is refused until that session record exists: create the session first.

## The product tree

Three lenses onto the same changes in the library: **project**, where the code lives (a grouping of code one team ships together, with one or more repositories), **feature**, what the product does, and **milestone**, toward what (a parent change, its progress its children done). The dashboard shows two of them, feature and milestone; a project is a chip on a card and a record on the getter page, not a place to stand. Project and feature sit under a product; a milestone lives in the work. A `product:<slug>` is the fixed root. Features are one nestable kind, `feature:<slug>`, any depth; the level names (feature, then capability, by default; `tree_levels` in pjman.yaml, or `levels` on the product) are labels, not kinds. Each level is defined by the question it answers and who asks it, not by size: a **product** is the thing with a name and users, asked about by everyone; a **feature** is what the product does for a person, nameable in a sentence a user would recognise, asked about by owners and users, the top level of the map; a **capability** is a distinct behaviour a change can add, change or remove, asked about by builders and agents, the most specific node a change names, which is why capabilities nest. A product that outgrows one map sets its own levels (`area`, `feature`, `capability`); there is no industry standard to follow, so the definitions are the contract. Projects attach to the product (`product`), and nest too (`parent`). Owners, a list of actors on any node, are inherited downward. A change names the features it affects with an effect, `adds`, `changes` or `removes`, and a feature's status is derived from those changes (live once an adding change is done, retired once a removing one is), with an authored status shown beside it when they differ. `pjman tree` renders the tree with roll-ups; `pjman activity <key>` is the event stream of everything beneath a node, which is where health is read from: when it last moved, what got done, what is new, what is blocked, what waits on a person.

### Aspects

Some work is not one place on the tree: how text reads, how the app moves, a component reused across views. An **aspect** records it once, as its own small tree under the product (`aspect:<slug>`, nesting by `parent`), beside the features and never inside them. Its body is the base, the one source of truth. Each **place** (`aspect:<aspect>/<place>`) names one existing feature where the aspect applies; its body is the fork, only what differs there, empty when the base holds as it is. A place at a feature covers everything beneath it, and a place nearer a feature layers over one above it, so a place reads as the base, then the forks above it, then its own (`pjman show aspect:<aspect>/<place>`). Because places are links, the feature tree keeps one parent per node and nothing is counted twice. A change's context carries an Aspects section for the features it names: each aspect over them read in full, and the places beneath a broad feature one line each; a change that names the aspect itself (`--aspects "changes aspect:<slug>"`) carries the base and every place. Writing a base (`pjman set aspect:<slug> body=- < base.md`) prints every place it reaches with each fork, to be reconciled in the same batch. The store holds no shape for a base or a fork; the `aspect` skill shapes them by the kind of aspect. See `change:aspects`.

## Trackers: the Linear sync

pjman never signs in to a tracker. The harness holds the connection (the Claude Code plugin declares Linear's MCP server; the person signs in there once) and reads tickets with the tracker's own tools; pjman is the translation layer. A project names its tracker and its team (`pjman set project:<slug> tracker=linear ext.linear.team=ABC`). `pjman sync linear --from <file|->` (or `pjman sync github --from -` for a project whose tracker is `github-issue`: the reader is the `gh api graphql` command that `pjman sync github` prints when run without `--from`, since `gh issue list --json` has no sub-issue parent; open maps to open or to the vocabulary's word for a label, closed to done, closed as not planned to dropped, a sub-issue's parent to the change's parent) takes the issues as JSON, in whatever shape the tracker's tools answered (one issue, a list, a page, or the tool result pasted whole), and applies them: each becomes a source record `linear:ABC-1234` with its observed state under `ext.linear`, and the change that binds it is created or updated so that title, status and parent follow the ticket. Status maps through the store's vocabulary by state name, then by state type, then the built-in map (triage and backlog → open, unstarted → planning, started → active, completed → done, canceled → dropped). Everything pjman adds to a change (next, summary, plan, decisions, other links) is left alone; issues from another team are skipped and named; nothing is written back. Each run is a session by `agent:linear-sync`, one commit, one event per record. The translation does not depend on who held the connection: another harness, or a pushed feed, hands pjman the same JSON.

## The dashboard and the API

`pjman serve` serves the store over HTTP: the library's results as JSON under `/api/v1` and the bundled dashboard, a React app with one shell and two lenses: the product map (what the product is) and the roadmap (in what order it comes). The shell is a rail (product, lens, view, theme, person), a one-line top bar (the node's breadcrumb in this lens, presence, ⌘K to jump to any record) and two panes at desktop width, one column below 860px. A page is a node of the product tree (the product, a feature, a change) seen through a lens: `/feature/<key>` is the product map, features only with connectors from parent to child, state as a dot, and an overview in the record pane whose body follows the node's level (the product's portfolio, a feature's capabilities and work, a capability's work by intent); `/roadmap/<key>` is the roadmap: lanes on one horizontal axis, the features of the map as rows (nested, collapsible), left of now the past by time (a change is a bar from when it began to when it was done, in flight reaching the seam), right of now the future by sequence (a column per entry of the product's order, a milestone holding its children, later closing the list), dependencies drawn when an entry is focused, a warning where the order contradicts a dependency or a date, and drag to reorder (one of the app's two writes). A milestone selected is its page: a ring, the next line first, the children as a checklist, the decisions, the features touched. Views are a search param (`?view=tree|lanes|inbox|bugs`): lanes are the work beneath the node grouped by status, by milestone or by who moves it next (`?group=status|milestone|actor`); the inbox lists every change that needs a person (a decision proposed, in review, blocked) with its asks beneath it; bugs is the queue beneath the node, worst first then oldest, grouped by what is lost, each listed once at its home (the rail counts it only while a product or a feature is out); activity is a tab of the record pane. The project and milestone lenses the server answers (`lens=project`, `lens=milestone`) are not shown. Done changes and retired features are hidden until asked for (`?done=1`, `?retired=1`); the window is 14 days (`?days=`). A link opens a node in the current lens when it lives there, else in its home lens. A feature's short `name` (one to three words, `--name` on `pjman new feature`) is what trees, chips and crumbs show; the title stays the sentence. Themes are token files under `ui/src/themes` (Graphite is the default; Paper, Nord, Catppuccin, Tokyo Night and Gruvbox ship) picked in the rail and remembered. A session's page (`/session/<id>`) follows what the session is on; `/get/<ref>` opens whatever a reference resolves to. The API is the contract any UI can build on: the page as data (`/scope?lens=&node=&days=&done=&retired=`, with the tree, the flat changes, the roll-up, live sessions, the decisions waiting beneath the node, the recent events, the open bugs beneath it worst first, and the roadmap: the product's sequence as it falls in the scope, what comes after it, and where the order contradicts a dependency or a date), records by key (`/records/{kind}/{rest}`, `…/neighbourhood`), the getter for anything (`/resolve?ref=`), the references in a text (`/refs?text=`), the product tree (`/tree?root=`), the activity beneath a node (`/activity?key=&days=`), a session's view (`/sessions/{id}/view`), a project's board (`/projects/{slug}/board`), the listing (`/records?type=&status=&project=`), the store (`/store`) and the stream (`/events?since=`, live with `Accept: text/event-stream`). Every read takes `at=` (an event's sequence number, or an instant that resolves to the last event at or before it) and answers as of that moment: the records at the event's commit, read from the store's history without touching the working tree and cached by commit, the stream cut after it, the clock set to it; such a response carries `moment` ({seq, at, commit}), and `/events?since=&until=` lists the events between two points. In the app the cursor is the `at` search param: every query carries it, the page holds still at that moment while the stream keeps running, and a chip in the top bar says what it resolved to with the way back to now. Every response carries `seq`, the stream position, in the body and in `X-Pjman-Seq`; errors are `{ error: { code, message, tried } }`. The API reads, and writes through three routes, each the same function the command calls, as the person signed in: `POST /order` (`{change, before|after|first|last|later}`), the dashboard's reorder; `POST /decide` (`{decision}`), a proposed decision decided, which wakes the sessions bound to its change; and `POST /reopen` (`{decision}`), its reverse, back to proposed. A proposed decision shown with its text has Accept, which asks Confirm in place before it writes; a decided one has Reopen on its change's Decisions tab. The server writes as the person even when a session's shell started it. The app's architecture (three kinds of state with one owner each, feature-sliced folders with enforced import boundaries, contract types from the tool's declarations) is in `ui/README.md`. See the decisions under `change:dashboard-design`.

The app lives in `ui/` (React, Vite) and builds into `dist/ui`, which ships with the tool (`npm run build:ui`); the runtime has no UI dependency. For development, `npm run dev` builds the tool and runs this checkout's own `pjman serve` and the app's Vite server under [portless](https://github.com/vercel-labs/portless), each at a stable name: `http://pjman.localhost:1355` for the app (which proxies `/api` to the server) and `http://api.pjman.localhost:1355` for the API, with the branch in front in a linked worktree (`http://live-sessions.pjman.localhost:1355`), so worktrees never collide and nobody picks a port. The proxy is plain HTTP on 1355 and starts itself on first use, with no root and no trusted certificate; a server change needs a restart, the app reloads itself. `npm --prefix ui run dev` alone still proxies `/api` to `PJMAN_SERVE`, else the installed dashboard on 7331. `pjman serve --static <dir>` serves a different app on the same API.

## Rules the tool enforces

- **References are keys** (`person:vinh`, `project:pjman`, `change:schema`, `decision:schema/keys`, `linear:ABC-1`, `file:THESIS.md`). Projects, changes, decisions and sessions must exist; sources and actors need no record.
- **The YAML rule:** any scalar containing `: ` or `#`, or starting with a special character, is quoted. `validate` reports; `fmt` quotes.
- **A decision is decided by a person.** `--status decided` needs `--decided-by` unless the writer is a `person:`; `supersedes` marks its targets `superseded`, at creation or later through `pjman set decision:<k> supersedes=<key>,…` (a decision made later retires the proposals it overtook; the list only grows, a target another decision already supersedes is refused).
- **A source binds at most one change.** A second bind is refused on write and reported as a conflict on hand edit.
- **Nothing is dropped.** An invalid record is reported with its path and reason; a reference to it is "resolved, invalid", not "missing".
- **Extensions** go under `ext.<owner>.<field>` and are never validated.

## The Claude Code adapter

`adapters/claude-code/` is a plugin: seven hooks and one skill. Every session starts from `pjman context`, binds to the change the prompt names, records observed edges for the files it writes, and leaves a log line per turn that acted. See [adapters/claude-code/README.md](adapters/claude-code/README.md).

```bash
claude --plugin-dir /path/to/pjman/adapters/claude-code
```

## Development

```bash
npm test
```

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
