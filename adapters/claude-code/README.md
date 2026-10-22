# pjman adapter for Claude Code

A plugin: seven hooks, one skill and one MCP server declaration (Linear's hosted server, so a session can read tickets after the person signs in with `/mcp`; the tool itself never signs in anywhere). Every write goes through `pjman`; the plugin holds no record logic of its own. The view beside the session is `pjman view`, rendered by the tool and docked by the plugin.

| Claude Code event | What happens |
|---|---|
| `SessionStart` (startup, resume, clear, compact, fork) | in a git repository that is not a project yet, runs `pjman init` so it becomes one (`auto_register: false` in `~/.pjman/config.yaml` turns that off); creates `session:<id>` if missing, appends a log line, injects the brief (`pjman brief`) and `pjman context`; on resume and compact also the bound change's context; observes the branch and open pull request of a bound change |
| `UserPromptSubmit` | the prompt goes to `pjman refs`, which returns every reference in it (`change:<slug>`, an existing hyphenated slug, a ticket in any shape the store's source kinds know, a URL) with the change each leads to; the last one binds the session, and the branch and open pull request are observed as its sources. The hook holds no pattern of its own. A ticket of the project's `tracker` with no record is read from the tracker and created through the sync (GitHub: the hook runs `gh issue view` and `pjman sync github` itself; otherwise the agent is told to read it and sync); a pattern match alone never creates a record. The change's context is injected the first time |
| `PostToolUse` (Write, Edit, MultiEdit, NotebookEdit, Bash) | an edit, or a shell call that writes the store (`pjman new|set|session|mv|fmt|init`), marks the turn as having acted; a file write in the project records an observed `links` edge from the bound change to `file:<path>`. A shell call that only reads, builds or tests does not count; a file edited through the shell is not observed |
| `Stop` | if the turn acted, appends one log line from the first line of the assistant's message |
| `SubagentStart` / `SubagentStop` | a child session with `parent`, and its own log line |
| `SessionEnd` | a closing log line; the view's pane is closed |

**The view beside the session.** Inside cmux, at session start the plugin finds the dashboard server (`~/.pjman/serve.json`) or starts `pjman serve`, and docks a browser pane at the session's page, `/session/<id>`: the change the session is bound to, live over the event stream, following the session as it binds; the pane is closed when the session ends. Elsewhere, at session start the plugin starts one detached `pjman view --session <id> --out view/<id>.md --watch` in its data directory: a subscriber to the store's event stream that keeps the file current for as long as the session runs, whoever writes the store. The file shows the change the session is bound to (status, ticket, decisions, sources, files touched, sessions), or the project's board before a bind, and follows the session when it binds another change. Inside cmux the file is docked beside the session in cmux's document viewer (live reload) when the session starts and closed, with the watcher, when it ends; the bound change is named in the workspace sidebar. In any other terminal, open the same file, or run `pjman view --session <id> --watch` in a split.

Binding follows what the prompt names, never the directory or branch; a change the agent creates is bound by the agent itself (`pjman session bind`, as the skill says). The log line is the harness's own text; no model is called. The hook never blocks and never fails a session: errors go to `hook.log` in the plugin's data directory.

## Install

`pjman init` installs this plugin when `claude` is on PATH; the rest of this section is the manual route.

For a session:

```bash
claude --plugin-dir /path/to/pjman/adapters/claude-code
```

Permanently, add this repository as a local marketplace and install from it:

```
/plugin marketplace add /path/to/pjman
/plugin install pjman@pjman
```

The user config `~/.pjman/config.yaml` must name the person the sessions run for (`actor: person:<handle>`); `pjman init` sets it from `git config user.name`.

## What the skill adds

`skills/pjman/SKILL.md` carries the rules an agent follows in a pjman project: read the change's context first, open a decision `proposed` before a choice that forecloses options and never set it `decided`, keep `next` true before stopping, name new work as `change:<slug>`. Skills load on demand, so for a rule that must hold every session add one line to the project's `CLAUDE.md`:

```markdown
This project has a pjman store. Follow the `pjman` skill: read `pjman context change:<slug>` before working on a change, open decisions `proposed` before acting, and set `next` before stopping.
```
