# pjman reference

The tool in full: the store, `pjman init`, every command, the product tree, trackers, the dashboard and the API, the rules it enforces, the adapter, development and releases. The short version is the [README](../README.md); the record contract is [SCHEMA.md](../SCHEMA.md); the thesis is [THESIS.md](../THESIS.md).

## The store

One global store per person: `~/.pjman/store`, its own git repository. `pjman init` in a repository creates the store the first time, registers the repository as a project (`project:<folder-name>`, or `--name`), and maps the repository's path to that project in `~/.pjman/config.yaml`. The tool commits every write it makes there. A change belongs to the project of the directory it was created from; `pjman context` is that project's board, `--all` every project's.

Resolution from any directory: `--store <path>` / `PJMAN_STORE`; else a store root or a `.pjman/` walking up; else the user map, which also names the current project.

A project may name its `tracker` (`pjman set project:<slug> tracker=linear`): the source kind of its tickets. A ticket id or ticket URL then resolves through the getter to the change that binds it, and the adapter binds a session to that change, creating it when none binds the ticket.

`pjman init --in-project` makes a store at `<repo>/.pjman/` instead, tracked with the project and never committed by the tool. It is set aside: kept for a repository that must carry its own record.

```
pjman.yaml                                             name, layers, vocabulary, source_kinds, version (the format the store is in)
products/<p>/product.md                                product:<p>                 the root and the namespace
products/<p>/features/<slug>/feature.md                feature:<p>/<slug>          nests by its parent field, never by folder
products/<p>/changes/<slug>/change.md                  change:<p>/<slug>           carries its project (a project of <p>)
products/<p>/changes/<c>/decisions/<date>-<slug>.md    decision:<p>/<c>/<slug>
products/<p>/decisions/<date>-<slug>.md                decision:<p>/<slug>         (product level)
products/<p>/aspects/<slug>/aspect.md                  aspect:<p>/<slug>           what applies across the product; the body is the base
products/<p>/aspects/<a>/places/<place>.md             aspect:<p>/<a>/<place>      where it applies (a feature); the body is the fork
products/<p>/releases/<version>.md                     release:<p>/<version>       a version the product shipped, and the changes it ships
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
project drops the product segment, JSON keeps it.

The store names the format it is in (`version:` in `pjman.yaml`, the pjman version that introduced its latest move), stamped by `pjman init` and by `pjman migrate` and never by an ordinary write; a store with no stamp reads as 0.1.0. `pjman migrate` makes the one move the store still waits for, in order: the layout (from the flat layout before keys were paths under the product), the foundation (changes and decisions into their shape), then the stamp. A pjman older than the store refuses to write it and names the version to install; one newer says to migrate. Each move names the version that introduced it, and the release that ships a new move is at least a minor. When an installed pjman asks for a migration, run `pjman migrate` once.

## `pjman init` in full

`pjman init` creates the global store if missing, registers the repository as a project, sets you as the actor (a handle of your own, suggested from your forge login, else your committer name, else this machine's account name, so there is always one; the accounts it knew, the login and the email, are linked on your person record), installs the Claude Code plugin from the installed package when `claude` is on PATH (hooks, skills, brief, Linear's MCP server), runs `pjman start` (the dashboard, detached) and prints what exists and what is left, which is at most signing in to the tracker from inside a session with `/mcp`. It asks one question, whether a product map should be proposed from the repository (yes by default; `--map` or `--no-map` answers without asking), and records the answer on the project. It also inventories the repository, docs (a README that says more than a title, a docs folder, a spec), code (a manifest, a directory of source), both or nothing yet, records that as the project's `holds`, and says how the map will come: while the answer is yes and the product has no feature, `pjman context` opens with one line saying the product has no map and what the repository holds, and `pjman intake` opens with the same the first time a change is filed, so the map comes with that change, in the same breath. With docs or code the change is filed with no feature and the map skill proposes the whole tree in a proposed decision naming it; a bare repository grows its map through intake instead, a capability under the feature it correlates to per change, until the context says the map has outgrown its shape (more than seven top-level features) and a regrouping is offered, which only the person asks for. A session started outside any registered repository (a parent directory, the home folder) is recorded in the global store with no project and resolved to the project of the repository it first works in. Running it again is the health check; it repairs what is missing and never undoes anything, and it ends with who you are as the store and the apps see it, the same read as `pjman whoami --verify`: your handle, each account with a verdict (verified, unknown, unchecked), and what is off with the command that resolves it. A handle whose record claims no account of a handle kind (a forge login) is provisional, as one from the committer name or the machine is: init and the session start say so and offer the rename (`pjman mv person:<old> person:<new>`, the old handle an alias, the config and every reference following) or the claim (`pjman set person:<handle> links=…`); a re-run of init claims the forge login itself only when it equals the handle. Once an account of a handle kind is claimed the handle counts as chosen, whether or not it matches a login, and nothing says it again; a sign-in claimed by another person is always said; an account the app does not know is said and never dropped. The apps' answers are cached for a day. `pjman stop` stops the dashboard; `pjman init --brief claude-md` also writes the brief into `~/.claude/CLAUDE.md` for sessions that run without hooks.

After that nothing is asked of you: a session in any git repository registers it as a project (`auto_register: false` in `~/.pjman/config.yaml` turns that off), starts with the brief and the board in front of the model, binds to the change or ticket a prompt names, observes the files, branch and pull request it works on, and docks the dashboard beside itself.

## Commands

<!-- commands: generated by npm run docs from src/surface.ts -->

Every record is one of these entities. The verbs `new`, `show`, `ls`, `set`, `rm` and `mv` work on all of them; an entity with operations of its own (a change's plan, a decision's thread, a session's log) has its own command. A dash says an operation is absent by design, and why.

### product

The root: the thing with a name and users.

| operation | command |
|---|---|
| create | `pjman new product <slug> --title <sentence> [--name …]` |
| read | `pjman show <product> · pjman tree <product> · pjman context <product> · pjman activity <product>` |
| list | `pjman ls product` |
| update | `pjman set <product>... <field>=… \| <list>+=<item> \| <list>-=<item>` |
| order | `pjman order [<product>]   (print the roadmap's order)` |
| rename | `pjman mv product:<old> product:<new>   (every key beneath it follows)` |
| delete | `pjman rm <product>` |

### feature

What the product does for a person; a capability is a feature beneath one, nesting.

| operation | command |
|---|---|
| create | `pjman new feature <slug> --title <sentence> [--name <one to three words>] --product <product> \| --parent <feature>` |
| read | `pjman show <feature> · pjman tree <feature> · pjman context <feature> · pjman activity <feature>` |
| list | `pjman ls feature [--product <p>] [--parent <feature>] [--status …]` |
| update | `pjman set <feature>... <field>=… \| <list>+=<item> \| <list>-=<item>` |
| rename | `pjman mv feature:<old> feature:<new>   (the old slug stays an alias)` |
| delete | `pjman rm <feature>... [--detach]` |

### project

Where the code lives: one or more repositories, attached to a product.

| operation | command |
|---|---|
| create | `pjman new project <slug> --title <t> --product <product>   (pjman init registers a repository as one)` |
| read | `pjman context project:<slug> · pjman show project:<slug>` |
| list | `pjman ls project [--product <p>]` |
| update | `pjman set project:<slug> <field>=… \| <list>+=<item> \| <list>-=<item>` |
| rename | `pjman mv project:<old> project:<new>` |
| delete | `pjman rm project:<slug>   (refused while changes are in it)` |

### aspect

What applies across the product (how text reads, a shared component), with a base; a place is where it applies, with its fork.

| operation | command |
|---|---|
| create | `pjman new aspect <slug> --title <t> [--body -] · pjman new place <aspect>/<place> --feature <feature> [--body -]` |
| read | `pjman show aspect:<slug> (the base and every place) · pjman show aspect:<aspect>/<place> (read there)` |
| list | `pjman ls aspect · pjman ls place` |
| update | `pjman set aspect:<slug> body=- < base.md · pjman set aspect:<aspect>/<place> body=- < fork.md` |
| rename | `pjman mv aspect:<old> aspect:<new> · pjman mv aspect:<a>/<old> aspect:<a>/<new>` |
| delete | `pjman rm aspect:<slug> · pjman rm aspect:<aspect>/<place>` |

### change

A unit of work: name, gist, sections, a plan of steps; a parent change is a milestone.

| operation | command |
|---|---|
| create | `pjman new change <slug> --name … --gist … --origin … --intent … --done-when … [--step <text>]...` |
| read | `pjman context <change> (to work it) · pjman show <change> (as stored) · pjman get <ref> (with its neighbourhood) · pjman view <change>` |
| list | `pjman ls change [--status …] [--kind bug] [--parent <milestone>] [--feature <node>] [--project <p>] · pjman context (the board)` |
| update | `pjman set <change>... <field>=… \| <list>+=<item> \| <list>-=<item>   (sections by name: origin, intent, done-when, scope, …)` |
| plan | `pjman step <change> add\|start\|done\|drop\|reopen\|note\|edit\|move …   (see step)` |
| order | `pjman order <change> --before <change> \| --after <change> \| --first \| --last \| --later` |
| note | `pjman note <change> <text>   (to whoever works it)` |
| rename | `pjman mv change:<old> change:<new>   (the old slug stays an alias)` |
| delete | `pjman rm <change>... [--detach]   (takes its decisions with it)` |
| bulk | `pjman sync linear\|github --from -   (tickets to changes) · pjman apply` |

### step

One step of a change's plan: a text, a state (open, active, done, dropped), a note.

| operation | command |
|---|---|
| create | `pjman step <change> add <text>... [--before <n>\|--after <n>\|--first\|--last]   (several quoted texts, or --from -: one commit)` |
| read | `pjman context <change>   (the plan, with the next step)` |
| update | `pjman step <change> start\|done\|drop\|reopen <n>... [--note …] · note <n> <text> · edit <n> <text> · move <n> --before <m>` |
| delete | `pjman step <change> drop <n>   (kept as dropped: the plan keeps its history)` |

### decision

What was chosen and why: an append-only thread a person decides.

| operation | command |
|---|---|
| create | `pjman decision <change>/<slug> --name … --gist … --question … --option <id>=… --recommend <id>=…` |
| read | `pjman show <decision> · pjman context <change>   (its decisions in full)` |
| list | `pjman ls decision [--status proposed\|decided\|superseded\|reverted] [--parent <change>]   (--status proposed: what waits on a person)` |
| update | `pjman decision <key> --option\|--comment\|--reject\|--recommend … · --accept <id> --by person:<handle> · --reopen · pjman set <decision> name\|gist\|links\|supersedes` |
| rename | `pjman mv decision:<change>/<old> decision:<change>/<new>` |
| delete | `pjman rm <decision>` |
| bulk | `pjman decision <key> --from -   (entries as JSON)` |

### source

Something outside the store, by key: a ticket, a PR, a branch, a doc, a file, a URL.

| operation | command |
|---|---|
| create | `pjman new source <kind>:<key> [--title …] [--url …] · pjman sync linear\|github · --links <key> on any record (no record needed)` |
| read | `pjman get <ref> · pjman show <kind>:<key>` |
| list | `pjman ls source` |
| update | `pjman set <kind>:<key> title=… url=… links+=…` |
| rename | `— (its key is the outside thing's)` |
| delete | `pjman rm <kind>:<key> [--detach]` |

### actor

A person or an agent, with their accounts.

| operation | command |
|---|---|
| create | `pjman new actor person:<handle> \| agent:<handle> [--links github-user:<login>]...   (pjman init makes yours)` |
| read | `pjman whoami [--verify] · pjman show person:<handle>` |
| list | `pjman ls actor` |
| update | `pjman set person:<handle> name=… links+=email:<address>` |
| rename | `pjman mv person:<old> person:<new>   (the old handle stays an alias)` |
| delete | `pjman rm person:<handle>   (refused while it wrote anything)` |

### session

A run of an agent on behalf of a person: append-only.

| operation | command |
|---|---|
| create | `pjman session start <id> --agent <agent> --on-behalf-of <person>   (the adapter does it)` |
| read | `pjman show session:<id> · pjman brief --session <id> · pjman open --session <id>` |
| list | `pjman ls session` |
| update | `pjman session log\|bind\|unbind\|observe\|focus\|project <id> … · pjman note session:<id> <text>` |
| rename | `— (its id is the harness's)` |
| delete | `pjman rm session:<id>   (refused while anything was written in it)` |

### release

A version the product shipped.

| operation | command |
|---|---|
| create | `pjman new release <version> --at <timestamp> [--ships <change>]...   (npm run release writes it)` |
| read | `pjman show release:<version>` |
| list | `pjman ls release [--product <p>]` |
| update | `pjman set release:<version> url=… links+=…   (the version, tag and what it ships are facts)` |
| rename | `— (a version is a fact)` |
| delete | `pjman rm release:<version>` |

### Reading across the store

- `pjman context`: what an agent reads first: the board, or one change in full
- `pjman get`: anything in (key, slug, ticket, URL, file): the record, its edges, the changes in reach
- `pjman tree`: the product by its features, with derived status, owners and backlog
- `pjman activity`: the events beneath any node and what they say about health
- `pjman intake`: what already exists for a request, before it is filed
- `pjman refs`: every reference in a text and the change it leads to
- `pjman view`: one reference as a Markdown document
- `pjman rest`: whether a stop on a change is one the record allows (exit 1 when not)
- `pjman events`: the store's event stream, one event per write
- `pjman follow`: print events as they are appended

### Sessions

- `pjman session`: a session's record: start it, log to it, bind it to a change, observe an edge
- `pjman brief`: what an agent needs in front of it, every session or since its last brief
- `pjman wakes`: the events that wake a session

### Batches and history

- `pjman apply`: many writes of any kind as one commit
- `pjman undo`: revert the last batch, or the commit named

### The dashboard

- `pjman start`: start the dashboard and print its URL
- `pjman open`: open the dashboard, at a session's page when one is named
- `pjman stop`: stop the dashboard
- `pjman serve`: the store over HTTP: the API under /api/v1 and the app

### Setup

- `pjman init`: the whole onboarding, in one command; again, the health check
- `pjman where`: the store this directory resolves to, its project and product
- `pjman whoami`: who you are: the person, their record, their accounts

### Maintenance

- `pjman validate`: check every record and every reference (exit 1 on errors)
- `pjman fmt`: rewrite records in canonical form
- `pjman lift`: move every change up to what its plan says, as one batch
- `pjman migrate`: the one move the store still waits for
- `pjman index`: rebuild index.db (exit 1 on conflicts)
- `pjman query`: a read-only SQL query against the index

### Every command in full

```
pjman new product <slug> --title <sentence> [--name <one to three words>] [--owners <actor>]... [--levels <label>]... [--sequence <change>]... [--summary <s>] [--links <key>]...
pjman new feature <slug> --title <sentence> [--name <one to three words>] --product <product> | --parent <feature> [--status planned|building|live|retired] [--level <label>] [--owners <actor>]... [--summary <s>] [--links <key>]...
pjman new project <slug> --title <t> [--product <product>] [--parent <project>] [--tracker <source-kind>] [--owners <actor>]... [--links <key>]...
pjman new aspect <slug> --title <t> [--name <one to three words>] [--parent <aspect>] [--owners <actor>]... [--body <base>|-] [--links <key>]...
pjman new place <aspect>/<place> --feature <feature> [--body <fork>|-] [--links <key>]...
pjman new change <slug> --name <one to four words> --gist <one line> --origin <the request in the person's words, or the key it came from> --intent <the need, for whom> --done-when <the outcome that closes it>
        [--scope …] [--open-questions …] [--blocked-on …] [--notes …] [--status open] [--project <key>] [--parent <change>] [--step <text>]...
        [--features "adds feature:<slug>"]... [--aspects "changes aspect:<slug>"]... [--depends-on <change>]... [--owners <actor>]... [--binds <key>]... [--links <key>]...
        [--kind bug --severity product|feature|capability|nuisance|cosmetic] [--target <date>]
pjman new release <version> --at <timestamp> [--tag v<version>] [--level patch|minor|major] [--commit <sha>] [--url <u>] [--ships <change>]... [--links <key>]... [--body <notes>|-]
pjman new source <kind>:<key> [--title <t>] [--url <u>] [--links <key>]... [--body <text>]
pjman new actor person:<handle> | agent:<handle> [--name <n>] [--url <u>] [--links github-user:<login>]... [--links email:<address>]...
pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>] [--started <ts>] [--project <key>]   (the bare record; pjman session start is the start)
    create a record; refused if it would not validate. Keys are paths under the product (feature:<product>/<slug>, change:<product>/<slug>, decision:<product>/<change>/<slug>); inside a project the slug alone names a record. A decision is created with pjman decision, a session with pjman session start

pjman show <ref> [--json]
    print one record by its key or slug, as it is stored (an aspect with every place it reaches; a place read through its aspect)

pjman ls [product|feature|aspect|place|project|change|decision|release|source|session|actor] [--status <s>] [--kind bug|work] [--project <key>] [--product <key>] [--parent <key>] [--feature <key>] [--json]
    list records, by entity, status, kind and where they sit: --project for a change's project, --product for anything under a product, --parent for a milestone's children or a feature's nodes, --feature for the changes naming a node or anything beneath it. A status or kind outside the vocabulary is refused. Bugs come worst first, then oldest

pjman set <ref>... <field>=<value> | <field>+=<item> | <field>-=<item> ...
pjman set <ref> <field>=- < file   (one value from stdin)
    change authored fields on one or several records, one commit (pjman undo reverts it). field=value replaces (an empty value removes the field); on a list field (links, owners, binds, features, aspects, depends_on, levels, sequence) field+=item adds one item when absent and field-=item removes one; field=- reads one value from stdin. A change's sections are set by name: origin, intent, done-when, scope, open-questions, blocked-on, notes; a product's or feature's summary likewise; body sets an aspect's base or a place's fork whole. A decision's supersedes only adds, and marks each named decision superseded. A change's or decision's name and gist are the rungs views show; written from a changed foundation they are said to be stale until rewritten

pjman rm <ref>... [--detach] [--json]
    remove one or several records, one commit (a change takes its decisions with it). Refused while anything refers to one, naming each referrer; --detach drops the references that can be dropped (a key in a list, a parent, a superseded decision, an observed edge) in the same commit. A change's project, a writer or a session can never be dropped

pjman mv <kind>:<old> <kind>:<new>   (product, feature, aspect, place, project, change, decision, person, agent)
    rename a product (every key beneath it follows), a feature or a change (the folder moves, the old slug stays as an alias; <product>/<slug> moves it to another product), an aspect or a place, a project (directories bound to it follow), a decision (within or across changes) or a person (the old handle stays as an alias; the user config follows); every reference is rewritten in the same commit. Sources and sessions keep their keys, which are external; a release keeps its version, which is a fact

pjman decision <change>/<slug> --name <one to four words> --gist <one line> --question <text> [--criterion <text>]... --option <id>=<text>... [--case <id>=<points, one per line>]... [--recommend <id>[=<why>]] [--supersedes <decision>] [--links <key>]...
pjman decision <ref> [--question <reframed>] [--option <id>=<text>]... [--comment <words> [--on <option id>] [--by person:<handle>]] [--reject <id>[=<why>]]... [--recommend <id>[=<why>]] [--name …] [--gist …]   (a comment without --by is the writer's own)
pjman decision <key> --accept <id>[=<their words>] --by person:<handle> [--revisit <when to look again>]   (the person decides; an agent never does)
pjman decision <key> --reopen [--comment <why>]
pjman decision <key> --from -   (entries as JSON on stdin)
    write a decision at any size, one commit: created when it does not exist (then --name, --gist, --question and one --option are required), added to otherwise. Its foundation is a thread of entries: the question, criteria, options with their case, the recommendation with its reasoning, the person's comments in their words (--on <id> when about one option), rejections, the acceptance (a person's, with their words and when to revisit), a reopening. Status, decider and date follow the thread. --from - takes {name, gist, entries:[{type, text, id, case, option, by, revisit}]} as JSON on stdin

pjman step <change> add <text>... [--before <n>|--after <n>|--first|--last] [--note <text>]   (each quoted text a step)
pjman step <change> add --from - [--before <n>|…]   (one step per line on stdin)
pjman step <change> start|done|drop|reopen <n>... [--note <where the work stands>]   (several numbers: one commit)
pjman step <change> note <n> <text>
pjman step <change> edit <n> <text>
pjman step <change> move <n> --before <m>|--after <m>|--first|--last
    a change's plan, written only through commands: steps as data, each with a text, a state (open, active, done, dropped) and a note of where the work stands; every write is one commit and one event on the change. add takes several texts, each its own step, in one commit (--from - reads them one per line); edit rewrites a step's text; a step added in error is dropped, never removed. The next step (the active one, else the first open), the plan's progress and the active step's note are derived

pjman order [<product>] [--json]
pjman order <change> --before <change> | --after <change> | --first | --last | --later
    the product's sequence, the roadmap's order. With a product (or nothing, inside a project), print it; with a change and a move, put it before or after another entry, first, last, or off the sequence (later). The rest of the order is never touched

pjman note <change|session:<id>> <text>
    a note to whoever works a change, or to one running session: one line under Notes on that record, given in full in the session's next brief; a session working the change, or the one addressed, is woken for it where its adapter can (pjman undo <commit> takes it back)

pjman sync linear --from <file|-> [--project <key>] [--team <KEY>] [--json]
pjman sync github --from <file|-> [--project <key>] [--repo <owner/name>] [--json]
pjman sync github            (no --from: prints the gh command that reads the issues)
    apply a tracker's tickets to the store, as observed by whoever holds the connection (the harness's MCP session): each ticket becomes a source and the change that binds it; title, status and parent follow the ticket; everything pjman adds is kept. --from takes the issues as JSON, in whatever shape the tracker's tools answered

pjman context [<change> | project:<slug> | product:<slug> | feature:<slug>] [--all] [--json]
    what an agent reads first: this project's open changes (--all: every project; project:<slug>: that project), or one change with its decisions, sources and sessions; a product or a feature with its tree and activity

pjman get <ref> [--json]
    the getter: a key, a source key, a URL, a ticket id, a file path or a slug in; the record, every edge into and out of it, and the full context of every change within two hops out

pjman tree [<product>|<feature>] [--json]
    the product tree: products, their features at every level (label from the template or the node), each with its authored and derived status, effective owners and the changes beneath it by status and project; a product also counts the open changes under its projects that name no feature

pjman activity <ref> [--days 14] [--since <iso>] [--json]
    the activity of a subtree: every event beneath a key (a product, feature, project or change, through every chain) in a window, with what it says about health: when it last moved, what got done, what is new, what is blocked, what waits on a person. A batch (pjman apply, a bulk set or rm, several steps added) is one entry

pjman intake <text> [--json]
pjman intake - [--json]   (text on stdin)
    what already exists for a request, before it is filed: open changes that share its words or are named in it (duplicates), done ones like it, the nodes of the map it may alter with their path, the milestones in flight, the order's tail. Never writes; the intake skill answers its four questions from this

pjman refs <text> [--json]
pjman refs - [--json]   (text on stdin)
    every reference in a text that resolves to something, in order, each with the change it leads to: change:<slug>, a URL, a ticket in any shape the store's source kinds know, an existing slug; the last mention is what a prompt is about. Never writes

pjman view [<ref>] [--out <file>] [--watch]
    one reference as a Markdown document, or the project's board without one; --out writes a file, --watch re-renders whenever the store changes. A session's view is the dashboard's: pjman open --session

pjman rest <change> [--json]
    where a change may rest: whether a stop on it is one the record allows, and why. It rests when a decision on it is proposed, a blocker is recorded (blocked-on, a dependency not done), a person set it blocked, review, done or dropped, or its plan has run to its end; with steps still open and none of those it does not rest, and the open steps are listed (exit 1). The adapter's stop hook reads this; never writes

pjman events [--since <seq>] [--session <key>] [--json]
pjman events --receipt [--since <seq>] [--session <key>] [--json]
pjman events rebuild
    the store's event stream: one event per write (seq, at, op, key, type, path, fields, writer, session, commit); --receipt says what the store received, one line per record, for a person; `rebuild` rewrites the stream from the store's git history

pjman follow [--since <seq>] [--json]
    print events as they are appended, after --since (default: only new ones), until interrupted; what a view subscribes to

pjman session start <id> --agent <agent> --on-behalf-of <person> [--parent session:<id>] [--log <line>] [--branch <name>] [--full] [--json]
pjman session log <id> <text>
pjman session bind <id> <change> [--reason prompt|created|branch]
pjman session unbind <id> <change>
pjman session observe <id> <edge> <from> <to>
pjman session focus <id> <change>   (what the session is looking at; pjman context <change> sets it for the session in PJMAN_SESSION)
pjman session project <id> <project>   (a session that started outside any project, resolved to the one whose repository it works in)
    a session is a run of an agent, its record append-only: start creates it (unless it exists) with the start line, binds the change its branch names and returns the brief; log, bind, unbind, observe, focus and project append to it. unbind backs out a binding made in error (the change, the edges observed on it), logging that it did

pjman brief
pjman brief --session <id> [--full] [--json]
    print the brief: what an agent needs in front of it every session (the adapter injects it; pjman init --brief claude-md writes it to ~/.claude/CLAUDE.md); with --session, what the store has for that session since its last brief: the bound change's context in full when the binding moved (or --full), else what changed on it, its milestone, its decisions and its dependency edges, without the session's own writes, one line per record, and the other live sessions near it; the brief records how far it reached and ends with its size

pjman wakes --session <id> [--since <seq>] [--follow] [--json]
    the events that wake a session: a decision on its bound change set decided, a note on that change or on the session, by anyone but the session; --follow keeps printing them as they land, from the stream's tail (or --since), until the session's process ends

pjman apply [<file>|-] [--for <ref>]
    many writes as one commit: the commands one per line (new, set, decision, step, mv, rm, order, session, note; as typed after pjman), run in order with every commit held, then one commit and the events with it, closed by one 'applied' event on the record --for names (a decision that proposed a map, a change). A line that fails refuses the whole batch and nothing is written

pjman undo [<commit>]
    revert the last batch (or the commit named) as one commit, every record put back; refused while a later write touched a record of that batch

pjman start [--port <n>] [--open]
    the dashboard: install and build the app if the checkout has none, start the server detached if none is running, print its URL

pjman open [--session <id>]
    the dashboard brought back: started if none is running, opened at a session's page when one is named (--session, else PJMAN_SESSION), its front page otherwise; docked beside the terminal where the terminal can (cmux), in the default browser elsewhere

pjman stop
    stop the dashboard server

pjman serve [--port <n>] [--host <addr>] [--static <dir>] [--register|--no-register]
    the store over HTTP: the library's results as JSON under /api/v1 (records by key, the getter as /resolve, a session's view, a project's board, the event stream as server-sent events) and the bundled app; writes its address to ~/.pjman/serve.json while it runs. PORT from the environment when --port is absent; a checkout registers only with --register

pjman init [--name <project-name>] [--product <product>] [--map|--no-map] [--brief claude-md] [--no-adapter] [--no-start] [--port <n>] [--in-project]
    the whole onboarding: join the global store (~/.pjman/store, its own git repository), register this repository as a project under a product (one made with its name, or --product names an existing one), set the actor (a person keyed by their handle, holding their forge login and git email as accounts), ask whether the first session should propose a product map (--map or --no-map answers without asking), install the harness adapter found on the machine, start the dashboard, report; --in-project makes a store inside the repository instead (set aside; kept for a repository that must carry its own record). Run again, it is the health check

pjman where [--json]
    print the store this directory resolves to and its mode; --json adds the project, its product, its tracker and the actor

pjman whoami [--verify] [--fresh] [--json]
    who you are: the configured person, their record and their accounts in order, the first of a handle kind as the primary one; from the store alone, no app asked. --verify asks each account kind's checker (GitHub through gh; a kind with no checker reports unchecked) and gives each account a verdict, verified, unknown or unchecked, with the answers cached for a day (--fresh asks again). What is off is said with the command that resolves it. Writes nothing

pjman validate [--json]
    check every record and every reference; errors are reported, never dropped (exit 1 on errors)

pjman fmt [--check]
    rewrite records in canonical form: field order, the YAML rule, repaired quoting (--check reports only, exit 1 when any differ)

pjman lift [--check]
    move every open, planning or active change up to what its plan says, as one batch (pjman undo reverts it): planning once it has a step, active once a step has started, review once every step is done. The same rule runs after every write; this is the backfill for a store written before it (--check lists the lifts only)

pjman migrate
    the one move the store still waits for, one commit, one event, pjman undo <commit> reverts it: the layout (every product a folder holding its features and changes, keys under the product), the foundation (every change and decision mapped into its shape, nothing dropped, each marked migrated until it is next written), then the stamp (pjman.yaml names the format the store is in, so a store from a newer pjman is refused by an older one)

pjman index [--json]
    rebuild index.db: ids, reverse edges, conflicts (exit 1 on conflicts)

pjman query "<sql>"
    run a read-only SQL query against the index; the answer is JSON

```

```
global flags: --store <path>  --writer <actor>  --session <session>  --created <date>  --json  --help  --version
environment:  PJMAN_STORE  PJMAN_WRITER  PJMAN_SESSION  PJMAN_HOME
exit codes:   0 ok · 1 refused or not found · 2 usage; with --json an error is {"error":{"code","message","tried"?}} on stdout
```

<!-- /commands -->

With `--session` (or `PJMAN_SESSION`) set, every write is refused until that session record exists: create the session first.

One writer at a time: every write command takes a lock on the store (a file under `~/.pjman/locks`) before it touches a file and releases it after its commit, so two sessions writing at once never commit each other's half-written records; a second writer waits a few seconds, then refuses naming the holder; a lock whose process is gone is reclaimed.

## The product tree

Three lenses onto the same changes in the library: **project**, where the code lives (a grouping of code one team ships together, with one or more repositories), **feature**, what the product does, and **milestone**, toward what (a parent change, its progress its children done). The dashboard shows two of them, feature and milestone; a project is a chip on a card and a record on the getter page, not a place to stand. Project and feature sit under a product; a milestone lives in the work. A `product:<slug>` is the fixed root. Features are one nestable kind, `feature:<slug>`, any depth; the level names (feature, then capability, by default; `tree_levels` in pjman.yaml, or `levels` on the product) are labels, not kinds. Each level is defined by the question it answers and who asks it, not by size: a **product** is the thing with a name and users, asked about by everyone; a **feature** is what the product does for a person, nameable in a sentence a user would recognise, asked about by owners and users, the top level of the map; a **capability** is a distinct behaviour a change can add, change or remove, asked about by builders and agents, the most specific node a change names, which is why capabilities nest. A product that outgrows one map sets its own levels (`area`, `feature`, `capability`); there is no industry standard to follow, so the definitions are the contract. Projects attach to the product (`product`), and nest too (`parent`). Owners, a list of actors on any node, are inherited downward. A change names the features it affects with an effect, `adds`, `changes` or `removes`, and a feature's status is derived from those changes (live once an adding change is done, retired once a removing one is), with an authored status shown beside it when they differ. `pjman tree` renders the tree with roll-ups; `pjman activity <key>` is the event stream of everything beneath a node, which is where health is read from: when it last moved, what got done, what is new, what is blocked, what waits on a person.

### Aspects

Some work is not one place on the tree: how text reads, how the app moves, a component reused across views. An **aspect** records it once, as its own small tree under the product (`aspect:<slug>`, nesting by `parent`), beside the features and never inside them. Its body is the base, the one source of truth. Each **place** (`aspect:<aspect>/<place>`) names one existing feature where the aspect applies; its body is the fork, only what differs there, empty when the base holds as it is. A place at a feature covers everything beneath it, and a place nearer a feature layers over one above it, so a place reads as the base, then the forks above it, then its own (`pjman show aspect:<aspect>/<place>`). Because places are links, the feature tree keeps one parent per node and nothing is counted twice. A change's context carries an Aspects section for the features it names: each aspect over them read in full, and the places beneath a broad feature one line each; a change that names the aspect itself (`--aspects "changes aspect:<slug>"`) carries the base and every place. Writing a base (`pjman set aspect:<slug> body=- < base.md`) prints every place it reaches with each fork, to be reconciled in the same batch. The store holds no shape for a base or a fork; the `aspect` skill shapes them by the kind of aspect.

## Trackers: Linear and GitHub

pjman never signs in to a tracker. The harness holds the connection (the Claude Code plugin declares Linear's MCP server; the person signs in there once) and reads tickets with the tracker's own tools; pjman is the translation layer. A project names its tracker and its team (`pjman set project:<slug> tracker=linear ext.linear.team=ABC`). `pjman sync linear --from <file|->` (or `pjman sync github --from -` for a project whose tracker is `github-issue`: the reader is the `gh api graphql` command that `pjman sync github` prints when run without `--from`, since `gh issue list --json` has no sub-issue parent; open maps to open or to the vocabulary's word for a label, closed to done, closed as not planned to dropped, a sub-issue's parent to the change's parent) takes the issues as JSON, in whatever shape the tracker's tools answered (one issue, a list, a page, or the tool result pasted whole), and applies them: each becomes a source record `linear:ABC-1234` with its observed state under `ext.linear`, and the change that binds it is created when none does, with the ticket linked in its Origin and a draft gist from its title; afterwards a sync writes the source, the binding and the owners, never the change's name, status or parent. Status on ingestion maps through the store's vocabulary by state name, then by state type, then the built-in map (triage and backlog → open, unstarted → planning, started → active, completed → done, canceled → dropped). Issues from another team are skipped and named; nothing is written back. Each run is a session by `agent:linear-sync`, one commit, one event per record. The translation does not depend on who held the connection: another harness, or a pushed feed, hands pjman the same JSON.

## The dashboard and the API

`pjman serve` serves the store over HTTP: the library's results as JSON under `/api/v1` and the bundled dashboard, a React app with one shell and two lenses: the product map (what the product is) and the roadmap (in what order it comes). The shell is a rail (product, lens, view, theme, person), a one-line top bar (the node's breadcrumb in this lens, presence, ⌘K to jump to any record) and two panes at desktop width, one column below 860px. A page is a node of the product tree (the product, a feature, a change) seen through a lens: `/feature/<key>` is the product map, features only with connectors from parent to child, state as a dot, and an overview in the record pane whose body follows the node's level (the product's portfolio, a feature's capabilities and work, a capability's work by intent); `/roadmap/<key>` is the roadmap: lanes on one horizontal axis, the features of the map as rows (nested, collapsible), left of now the past by time (a change is a bar from when it began to when it was done, in flight reaching the seam), right of now the future by sequence (a column per entry of the product's order, a milestone holding its children, later closing the list), dependencies drawn when an entry is focused, a warning where the order contradicts a dependency or a date, and drag to reorder (one of the app's writes). A milestone selected is its page: a ring, the next line first, the children as a checklist, the decisions, the features touched. Views are a search param (`?view=tree|lanes|inbox|bugs`): lanes are the work beneath the node grouped by status, by milestone or by who moves it next (`?group=status|milestone|actor`); the inbox lists every change that needs a person (a decision proposed, in review, blocked) with its asks beneath it; bugs is the queue beneath the node, worst first then oldest, grouped by what is lost, each listed once at its home (the rail counts it only while a product or a feature is out); activity is a tab of the record pane. Done changes and retired features are hidden until asked for (`?done=1`, `?retired=1`); the window is 14 days (`?days=`). A link opens a node in the current lens when it lives there, else in its home lens. A feature's short `name` (one to three words, `--name` on `pjman new feature`) is what trees, chips and crumbs show; the title stays the sentence. Themes are token files under `ui/src/themes` (Graphite is the default; Paper, Nord, Catppuccin, Tokyo Night and Gruvbox ship) picked in the rail and remembered. A session's page (`/session/<id>`) follows what the session is on; `/get/<ref>` opens whatever a reference resolves to.

The API is the contract any UI can build on: the page as data (`/scope?lens=&key=&days=&done=&retired=`, with the tree, the flat changes, the roll-up, live sessions, the decisions waiting beneath the node, the recent events, the open bugs beneath it worst first, and the roadmap: the product's sequence as it falls in the scope, what comes after it, and where the order contradicts a dependency or a date), records by key (`/records/{kind}/{rest}`, `…/neighbourhood`), the getter for anything (`/resolve?ref=`), the references in a text (`/refs?text=`), the product tree (`/tree?key=`), the activity beneath a node (`/activity?key=&days=`), a session's view (`/sessions/{id}/view`), a project's board (`/projects/{slug}/board`), the listing (`/records?type=&status=&kind=&project=&product=&parent=&feature=`, the filters of pjman ls), the store (`/store`) and the stream (`/events?since=`, live with `Accept: text/event-stream`). Every read takes `at=` (an event's sequence number, or an instant that resolves to the last event at or before it) and answers as of that moment: the records at the event's commit, read from the store's history without touching the working tree and cached by commit, the stream cut after it, the clock set to it; such a response carries `moment` ({seq, at, commit}), and `/events?since=&until=` lists the events between two points. In the app the cursor is the `at` search param: every query carries it, the page holds still at that moment while the stream keeps running, and a chip in the top bar says what it resolved to with the way back to now. Every response carries `seq`, the stream position, in the body and in `X-Pjman-Seq`; errors are `{ error: { code, message, tried } }`, with the codes the CLI uses (not-found 404, ambiguous 409, bad-request 400). `GET /api/v1` is the index as data: every route with its method, path, query or body and purpose. One style throughout: a collection's member is named in the path (`/records/{kind}/{rest}`, `/products/{slug}/…`, `/projects/{slug}/…`, `/sessions/{id}/…`), a view over any record takes it as `key`, and filters are named as the CLI's flags. The API reads, and writes through three routes, each the same function the command calls, as the person signed in: `POST /order` (`{change, before|after|first|last|later}`), the dashboard's reorder; `POST /decide` (`{decision}`), a proposed decision decided, which wakes the sessions bound to its change; and `POST /reopen` (`{decision}`), its reverse, back to proposed. A proposed decision shown with its text has Accept, which asks Confirm in place before it writes; a decided one has Reopen on its change's Decisions tab. The server writes as the person even when a session's shell started it. The app's architecture (three kinds of state with one owner each, feature-sliced folders with enforced import boundaries, contract types from the tool's declarations) is in `ui/README.md`.

The server answers only its own pages and the person's own tools (decision local-server-cross-origin/who-may-call): a request's Host must be a loopback name, the bound address or any `*.localhost` name (the port is not compared, so a proxy such as portless passes), a request that carries an Origin must come from such a name, a write must say `Content-Type: application/json`, and no CORS header is ever sent, so a page on another site reads nothing and writes nothing and a site rebound to the address is refused by its Host. A refusal is 403 `forbidden-host` or `forbidden-origin`, a write in another type 415 `unsupported-media-type`; curl and the CLI, which send no Origin, are unaffected.

The app lives in `ui/` (React, Vite) and builds into `dist/ui`, which ships with the tool (`npm run build:ui`); the runtime has no UI dependency. For development, `npm run dev` builds the tool and runs this checkout's own `pjman serve` and the app's Vite server under [portless](https://github.com/vercel-labs/portless), each at a stable name: `http://pjman.localhost:1355` for the app (which proxies `/api` to the server) and `http://api.pjman.localhost:1355` for the API, with the branch in front in a linked worktree (`http://live-sessions.pjman.localhost:1355`), so worktrees never collide and nobody picks a port. The proxy is plain HTTP on 1355 and starts itself on first use, with no root and no trusted certificate; a server change needs a restart, the app reloads itself. `npm --prefix ui run dev` alone still proxies `/api` to `PJMAN_SERVE`, else the installed dashboard on 7331. `pjman serve --static <dir>` serves a different app on the same API.

## Rules the tool enforces

- **References are keys** (`person:vinh`, `project:pjman`, `change:schema`, `decision:schema/keys`, `linear:ABC-1`, `file:THESIS.md`). Projects, changes, decisions and sessions must exist; sources and actors need no record.
- **The YAML rule:** any scalar containing `: ` or `#`, or starting with a special character, is quoted. `validate` reports; `fmt` quotes.
- **A change and a decision read as a ladder.** A name (one to four words), a gist (one line), then the foundation in full: a change's sections in order of depth (Origin, Intent, Done when, then Scope, the plan as steps, Open questions, Blocked on, Notes), a decision's append-only thread. Status, progress, the next step and what waits are derived. The name and gist record the foundation they were written from (`rungs_from`); written without them, the foundation leaves them stale, and the context says so. A record mapped by `pjman migrate` from the old shape (title, summary, next, Decision and Why) carries `migrated` until it is next written through the tool.
- **A decision is decided by a person.** An acceptance is an entry in its thread by a `person:`; an agent never accepts. `supersedes` marks its targets `superseded`, at creation or later through `pjman set decision:<k> supersedes=<key>,…` (a decision made later retires the proposals it overtook; the list only grows, a target another decision already supersedes is refused).
- **A source binds at most one change.** A second bind is refused on write and reported as a conflict on hand edit.
- **Nothing is dropped.** An invalid record is reported with its path and reason; a reference to it is "resolved, invalid", not "missing".
- **Extensions** go under `ext.<owner>.<field>` and are never validated.

## The Claude Code adapter

`adapters/claude-code/` is a plugin: seven hooks and four skills. Every session starts from `pjman context`, binds to the change the prompt names, records observed edges for the files it writes, and leaves a log line per turn that acted. `pjman init` installs it from the installed package; the manual routes are in [adapters/claude-code/README.md](../adapters/claude-code/README.md).

```
/plugin marketplace add vinhvanvu/pjman
/plugin install pjman@pjman
```

## Development

```bash
git clone https://github.com/vinhvanvu/pjman.git && cd pjman && npm install
npm test                            # the tool's tests; cd ui && npx vitest run for the app's
npm run dev                         # this checkout's own server and app at http://pjman.localhost:1355
npm run install:local               # install this checkout's build as the pjman on this machine
```

`npm run install:local` installs the tool as a copy of a built package, never a link to the checkout: it builds, packs, installs globally, points the Claude Code marketplace at the installed copy and refreshes the plugin, and restarts the dashboard when one was running. Run it again after every merge to main; a session's half-built checkout is then never another session's tool. When the installed tool asks for a store migration, run `pjman migrate` once, after the install.

Work on a change happens in a git worktree named for it, which the Claude Code adapter creates; pjman itself is built with pjman, and its own record is the first store.

## Releases

```bash
npm run release -- --dry-run        # what the next release would be, and its changelog entry
npm run release                     # the release, from main: patch, minor or major derived from the record
npm run release -- minor            # a typed level overrides the derived one
```

A release is derived from the record, never from commit prose. The script reads every first-parent commit on main since the last `v*` tag and resolves each to a change by the trailer a merge carries, `(change:<slug>)`, or by the merged branch's name (`worktree-<slug>`); what each change is comes from the store. A bug (`kind: bug`) is a patch; a change that names a feature it adds, changes or removes is a minor; a change naming no node is a patch; a store migration the release ships makes it at least a minor; the highest level wins, and major is typed only. A commit resolving to no change is listed under Also and counts as a patch, so nothing is dropped silently. The script prints that derivation, then stamps the version into `package.json`, the lockfile and the plugin manifest, writes the entry into `CHANGELOG.md` (one line per change, its name and gist, grouped Added, Changed, Fixed, Removed, Store, Also), commits, tags `v<version>` with the entry, builds, packs, pushes, creates the GitHub release with the tarball attached and the entry as its notes, publishes the same tarball to npm, and records the release in the store (`release:<version>`, the changes it ships). It refuses off main, on a dirty tree, on an existing tag, with nothing since the last tag, or with `gh` or `npm` signed out. From the push on, a step that fails prints exactly what is left to do by hand.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
