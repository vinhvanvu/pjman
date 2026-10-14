# pjman

A context graph for product development: typed records (changes, decisions, sources, sessions, actors) as files in git, under one schema, with a tool that is the schema. The thesis is in `THESIS.md`; the record contract is `SCHEMA.md`.

## Install

Node 22.13 or later and git on `PATH`.

```bash
npm install && npm link
```

## The store

A store is a git repository (or a tracked directory inside one) holding `pjman.yaml` and the record folders. `pjman init` creates one in either mode:

| Mode | Command | Where | Commits |
|---|---|---|---|
| standalone (default) | `pjman init` | `~/.pjman/stores/<name>/`, its own repository, bound to the project in `~/.pjman/config.yaml` | the tool commits after every write it makes |
| in-project | `pjman init --in-project` | `<repo>/.pjman/`, tracked with the project | the tool never commits; the project's workflow does |

Resolution from any directory: an in-project `.pjman/` walking up, else the user map, else `--store <path>` / `PJMAN_STORE`.

```
pjman.yaml                                   name, layers, vocabulary, source_kinds
changes/<slug>/change.md                     change:<slug>
changes/<slug>/decisions/<date>-<slug>.md    decision:<change>/<slug>
decisions/<date>-<slug>.md                   decision:/<slug>            (store level)
sources/<kind>/<key-slug>.md                 <kind>:<key>                (optional; a source may exist as a key only)
sessions/<date>-<id>.md                      session:<id>
actors/<handle>.md                           person:<handle> · agent:<handle>  (optional)
index.db                                     derived, git-ignored, rebuilt by `pjman index`
```

## Commands

```
pjman init [--in-project] [--dir <path>] [--name <name>]
pjman new change <slug> --title … [--status open] [--summary …] [--plan …] [--next …] [--binds <key>]… [--links <key>]…
pjman new decision <change>/<slug> | /<slug> --title … [--decided-by <person>] [--decided-on <date>] [--supersedes <decision>] [--decision …] [--why …]
pjman new source <kind>:<key> [--title …] [--url …]
pjman new actor person:<handle> | agent:<handle> [--name …] [--url …]
pjman new session <id> --agent <agent> --on-behalf-of <person> [--parent <session>]
pjman session log <id> <text>          append to the session's ## Log
pjman session bind <id> <change>       record that the run worked on a change
pjman session observe <id> <edge> <from> <to>   record an observed edge (evidence)
pjman validate [--json]                every record, every reference; errors are reported, never dropped
pjman fmt [--check]                    canonical field order, the YAML rule, repaired quoting
pjman ls [type] [--status s] [--json]
pjman context [<change>] [--json]      what an agent reads first: the change, its decisions, sources, sessions
pjman show <key>
pjman set <key> <field>=<value>…   change an authored field (title, status, next, links, binds); a list is comma-separated
pjman mv change:<old> change:<new>     move the folder, leave an alias, rewrite every reference
pjman index [--json]                   rebuild index.db: ids, reverse edges, conflicts
pjman query "<sql>"                    read the index
pjman where
```

Global flags: `--store`, `--writer <actor>`, `--session <session>`, `--created <date>`, `--json`. Environment: `PJMAN_STORE`, `PJMAN_WRITER`, `PJMAN_SESSION`, `PJMAN_HOME`.

## Rules the tool enforces

- **References are keys** (`person:vinh`, `change:schema`, `decision:schema/keys`, `linear:ABC-1`, `file:THESIS.md`). Changes, decisions and sessions must exist; sources and actors need no record.
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
