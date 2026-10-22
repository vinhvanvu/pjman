# pjman adapter for Claude Code

A plugin: seven hooks and one skill. Every write goes through `pjman`; the plugin holds no record logic of its own.

| Claude Code event | What happens |
|---|---|
| `SessionStart` (startup, resume, clear, compact, fork) | creates `session:<id>` if missing, appends a log line, injects `pjman context`; on resume and compact also the bound change's context |
| `UserPromptSubmit` | a prompt naming `change:<slug>` (or an existing hyphenated slug) binds the session to it and injects that change's context the first time |
| `PostToolUse` (Write, Edit, MultiEdit, NotebookEdit, Bash) | an edit, or a shell call that writes the store (`pjman new|set|session|mv|fmt|init`), marks the turn as having acted; a file write in the project records an observed `links` edge from the bound change to `file:<path>`. A shell call that only reads, builds or tests does not count; a file edited through the shell is not observed |
| `Stop` | if the turn acted, appends one log line from the first line of the assistant's message |
| `SubagentStart` / `SubagentStop` | a child session with `parent`, and its own log line |
| `SessionEnd` | a closing log line |

Binding follows what the prompt names, never the directory or branch; a change the agent creates is bound by the agent itself (`pjman session bind`, as the skill says). The log line is the harness's own text; no model is called. The hook never blocks and never fails a session: errors go to `hook.log` in the plugin's data directory.

## Install

Requires `pjman` (this repository: `npm install && npm link`) and the repository registered in the global store (`pjman init`).

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
