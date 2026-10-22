# pjman

A context graph for product development: typed records (changes, decisions, sources, sessions, actors) as files in git, under one schema, with a tool that is the schema. The thesis is in `THESIS.md`; the record contract is `SCHEMA.md`.

## Install

```bash
git clone <this repository> && cd pjman && npm install && npm link   # until the package is published
cd ~/Projects/<your-repo> && pjman init
```

`pjman init` is the whole onboarding: it creates the global store if missing, registers the repository as a project, sets you as the actor from your git name, installs the Claude Code plugin from this checkout when `claude` is on PATH (hooks, skill, brief, Linear's MCP server), runs `pjman start` (the dashboard, detached) and prints what exists and what is left, which is at most signing in to the tracker from inside a session with `/mcp`. Running it again is the health check; it repairs what is missing and never undoes anything. `pjman stop` stops the dashboard; `pjman init --brief claude-md` also writes the brief into `~/.claude/CLAUDE.md` for sessions that run without hooks.

After that nothing is asked of you: a session in any git repository registers it as a project (`auto_register: false` in `~/.pjman/config.yaml` turns that off), starts with the brief and the board in front of the model, binds to the change or ticket a prompt names, observes the files, branch and pull request it works on, and docks the dashboard beside itself.

## The store

One global store per person: `~/.pjman/store`, its own git repository. `pjman init` in a repository creates the store the first time, registers the repository as a project (`project:<folder-name>`, or `--name`), and maps the repository's path to that project in `~/.pjman/config.yaml`. The tool commits every write it makes there. A change belongs to the project of the directory it was created from; `pjman context` is that project's board, `--all` every project's.

Resolution from any directory: `--store <path>` / `PJMAN_STORE`; else a store root or a `.pjman/` walking up; else the user map, which also names the current project.

A project may name its `tracker` (`pjman set project:<slug> tracker=linear`): the source kind of its tickets. A ticket id or ticket URL then resolves through the getter to the change that binds it, and the adapter binds a session to that change, creating it when none binds the ticket.

`pjman init --in-project` makes a store at `<repo>/.pjman/` instead, tracked with the project and never committed by the tool. It is set aside: kept for a repository that must carry its own record.

```
pjman.yaml                                   name, layers, vocabulary, source_kinds
projects/<slug>.md                           project:<slug>              a repository
changes/<slug>/change.md                     change:<slug>               carries its project
changes/<slug>/decisions/<date>-<slug>.md    decision:<change>/<slug>
decisions/<date>-<slug>.md                   decision:/<slug>            (store level)
sources/<kind>/<key-slug>.md                 <kind>:<key>                (optional; a source may exist as a key only)
sessions/<date>-<id>.md                      session:<id>
actors/<handle>.md                           person:<handle> · agent:<handle>  (optional)
index.db                                     derived, git-ignored, rebuilt by `pjman index`
```

## Commands

```
pjman init [--name <project-name>] [--brief claude-md] [--no-adapter] [--no-start] [--in-project]
pjman new project <slug> --title … [--tracker <source-kind>] [--links <key>]…
pjman new change <slug> --title … [--status open] [--project <key>] [--parent <change>] [--summary …] [--plan …] [--next …] [--binds <key>]… [--links <key>]…
pjman new decision <change>/<slug> | /<slug> --title … [--decided-by <person>] [--decided-on <date>] [--supersedes <decision>] [--decision …] [--why …]
pjman new source <kind>:<key> [--title …] [--url …]
pjman new actor person:<handle> | agent:<handle> [--name …] [--url …]
pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>]
pjman session log <id> <text>          append to the session's ## Log
pjman session bind <id> <change>       record that the run worked on a change
pjman session observe <id> <edge> <from> <to>   record an observed edge (evidence)
pjman validate [--json]                every record, every reference; errors are reported, never dropped
pjman fmt [--check]                    canonical field order, the YAML rule, repaired quoting
pjman ls [type] [--status s] [--project <key>] [--json]   records in creation order, with their date
pjman context [<change> | project:<slug>] [--all] [--json]   what an agent reads first: this project's board, or one change with its decisions, sources, sessions
pjman get <ref>                        the getter: a key, a URL, a ticket id, a file path or a slug in; the record, its edges both ways and the context of every change within two hops out
pjman view [<ref>] [--session <id>] [--out <file>] [--watch]   the view beside a session, as Markdown: one reference, or what a session is on; --watch re-renders on every event in the stream
pjman show <key>
pjman set <key> <field>=<value>…   change an authored field (title, status, project, parent, next, links, binds, summary, plan; on a proposed decision also decision, why; ext.<owner>.<field> on any record); a list is comma-separated
pjman mv change:<old> change:<new>     move the folder, leave an alias, rewrite every reference
pjman events [--since <seq>] [--json]   the store's event stream, one event per write; `pjman events rebuild` derives it from git history
pjman follow [--since <seq>] [--json]   print events as they are appended, until interrupted; what a view subscribes to
pjman sync linear --from <file|-> [--project <key>] [--team <KEY>]   apply tickets observed through the harness's tracker connection: sources and the changes that bind them
pjman start [--port <n>] [--open]      the dashboard, detached (installs and builds the app if the checkout has none); pjman stop stops it
pjman brief                             the brief an agent needs every session (the adapter injects it)
pjman serve [--port <n>] [--host <addr>] [--static <dir>]   the store over HTTP: the API under /api/v1 and the dashboard; the address is written to ~/.pjman/serve.json while it runs
pjman index [--json]                   rebuild index.db: ids, reverse edges, conflicts
pjman query "<sql>"                    read the index
pjman where
```

Global flags: `--store`, `--writer <actor>`, `--session <session>`, `--created <date>`, `--json`. Environment: `PJMAN_STORE`, `PJMAN_WRITER`, `PJMAN_SESSION`, `PJMAN_HOME`.

With `--session` (or `PJMAN_SESSION`) set, every write is refused until that session record exists: create the session first.

## Trackers: the Linear sync

pjman never signs in to a tracker. The harness holds the connection (the Claude Code plugin declares Linear's MCP server; the person signs in there once) and reads tickets with the tracker's own tools; pjman is the translation layer. A project names its tracker and its team (`pjman set project:<slug> tracker=linear ext.linear.team=ABC`). `pjman sync linear --from <file|->` takes the issues as JSON, in whatever shape the tracker's tools answered (one issue, a list, a page, or the tool result pasted whole), and applies them: each becomes a source record `linear:ABC-1234` with its observed state under `ext.linear`, and the change that binds it is created or updated so that title, status and parent follow the ticket. Status maps through the store's vocabulary by state name, then by state type, then the built-in map (triage and backlog → open, unstarted → planning, started → active, completed → done, canceled → dropped). Everything pjman adds to a change (next, summary, plan, decisions, other links) is left alone; issues from another team are skipped and named; nothing is written back. Each run is a session by `agent:linear-sync`, one commit, one event per record. The translation does not depend on who held the connection: another harness, or a pushed feed, hands pjman the same JSON.

## The dashboard and the API

`pjman serve` serves the store over HTTP: the library's results as JSON under `/api/v1` and the bundled dashboard, a React app that shows a session's change as it works (`/session/<id>`), any reference's neighbourhood (`/get/<ref>`), a project's board (`/board/<project>`) and the store (`/`), all live over the event stream. The API is the contract any UI can build on: records by key (`/records/{kind}/{rest}`, `…/neighbourhood`), the getter for anything (`/resolve?ref=`), a session's view (`/sessions/{id}/view`), a project's board (`/projects/{slug}/board`), the listing (`/records?type=&status=&project=`), the store (`/store`) and the stream (`/events?since=`, live with `Accept: text/event-stream`). Every response carries `seq`, the stream position, in the body and in `X-Pjman-Seq`; errors are `{ error: { code, message, tried } }`. Read-only in this version; writes come later over the same library functions. See `decision:dashboard/api-contract`.

The app lives in `ui/` (React, Vite) and builds into `dist/ui`, which ships with the tool (`npm run build:ui`); the runtime has no UI dependency. For development, `npm --prefix ui run dev` proxies `/api` to a running `pjman serve` (set `PJMAN_SERVE` to its URL if not on port 7331). `pjman serve --static <dir>` serves a different app on the same API.

## Rules the tool enforces

- **References are keys** (`person:vinh`, `project:pjman`, `change:schema`, `decision:schema/keys`, `linear:ABC-1`, `file:THESIS.md`). Projects, changes, decisions and sessions must exist; sources and actors need no record.
- **The YAML rule:** any scalar containing `: ` or `#`, or starting with a special character, is quoted. `validate` reports; `fmt` quotes.
- **A decision is decided by a person.** `--status decided` needs `--decided-by` unless the writer is a `person:`; `supersedes` marks its target `superseded`.
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
