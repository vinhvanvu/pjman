# Hosts: where a session runs

A host is the place a session runs: a terminal multiplexer today (Rex, cmux), a cloud session later. The harness
adapter beside this document (`claude-code/`) is for the agent's harness; a host adapter is for the terminal the
harness runs in. pjman asks six things of a host, and each host is one implementation of the same interface
(`src/host.ts`), so pjman stays host-agnostic and a second host is a second implementation, never a second design.

| What pjman asks | What it is for | Rex | cmux (0.62) |
|---|---|---|---|
| **identify** | the host's own ids for the session, read from the environment the session-start hook runs in; never configured | `REX_SESSION`, `REX_BLOCK` | `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` |
| **version** | what the session ran on, so the record says it | `rex version --json` | `cmux --version` |
| **status** | what the program reports: `idle`, `working`, `done`, `blocked` (`permission`, `question`, `auth`), `error` | `rex block call -s <session> -b <block> program_status` (the program status protocol, OSC 7501; Claude Code emits it) | none at 0.62: the record's own rule reads the session |
| **label** | one line on the session's block: the change and where the work stands | `rex block rename -s <session> <block> <text>` | `cmux set-status pjman <text> --workspace <ws>`, the sidebar pill; `clear-status` takes it off |
| **send** | text into the session, as if typed | `rex send -s <session> -b <block> <text>⏎` | `cmux send --workspace <ws> --surface <surface> -- <text>⏎` |
| **open** | the session's block brought to the front | `rex focus -s <session> <block>` | `cmux select-workspace --workspace <ws>` |
| **launch** | a session for a change in its worktree, named for it | `rex new <slug> -c <project> --json -- claude --worktree <slug>` | `cmux new-workspace --cwd <project> --command "claude --worktree <slug>"`, then `rename-workspace` |
| **follow** | the host's events for one session, as they happen | `rex events -s <session> --json`: `program_status_changed`, `child_exited` | none at 0.62: `status` is polled, and answers nothing |

## The manifest

Each adapter carries a manifest (decision rex-adapter/adapter-versioning, bundled-ranged): the environment it serves,
the version of this interface it implements, the environment version range it was validated against, and the command
the environment answers to. The registry in `src/host.ts` (`HOSTS`) is the only place that knows where adapters come
from, so moving one to a package of its own later is a move, not a rewrite.

| Adapter | Interface | Validated against | Validated on |
|---|---|---|---|
| `rex` | 1 | `>=0.1 <1` | not yet: every call is written from Rex's documentation and the first hands-on reports of the beta, and run under test against a fake `rex`; the first real validation pins this range (change:rex-adapter, step 7) |
| `cmux` | 1 | `>=0.62 <1` | cmux 0.62.2 on macOS: presence and version for real; label, send, open and launch under test against a fake `cmux` whose commands match the installed CLI's help |

A session started inside a host whose version sits outside the range still binds and runs as any other; its record
says `validated: false` and the log line says the adapter has not validated that version.

## The record

A session's record carries its host, written once at the first start that knows it:

```yaml
host:
  name: rex
  session: session:01a1…
  block: block:01a1…
  version: 0.3.1
  validated: true
```

with a log line, `runs in rex 0.3.1`. The host is read by `pjman session start` from its own environment, which the
hook hands it; `--no-host` refuses it. The views read it off the record: the bridge row and the session bar say
`in rex 0.3.1`, and `(unvalidated)` when the version is outside the range.

## The state

The dashboard server follows every hosted session that has not ended (`src/host-watch.ts`): the host's stream, and a
poll of `status` until the stream speaks. What the program reports is handed to every read as a fact beside the
record's own, and it decides first (`src/session-state.ts`): `blocked` is **waiting** on the person, `working` is
**working**, a program at rest (`idle`, `done`, `error`) **waits** only when a decision is proposed on its change and
is **stopped** otherwise; `ended` stays with the closing log line. A session in no host, or whose host reports nothing,
is read as before: working while something it did reached the stream inside the live window and its last act was not
a stop line. A change in what a host says is a frame on the event stream (`event: host`), so an open page refetches as
it does for a write; nothing is stored.

## The commands and the routes

- `pjman host` — the host this machine runs, its version, and whether the adapter validated it.
- `pjman host label [<session>] [--clear]` — the block's label: `Rex adapter · 4/7` (the step the work stands on over
  the steps counted), or `Rex adapter · waits: Adapter versioning` when a decision on the change is proposed; the
  tool's name on a session with no change. The hook writes it at a bind, after a turn that wrote the store (the plan or
  a decision may have moved), and clears it at the session's end.
- `pjman host send [<session>] <text>` · `pjman host open [<session>]` · `pjman host status [<session>]`.
- `pjman host launch <change>` — a session for the change on the host this machine runs, in the project's directory,
  the harness in the change's worktree (`claude --worktree <slug>`: the harness adapter owns that line).
- `POST /api/v1/open {session}` and `POST /api/v1/launch {change}` — the same, from the dashboard: the button on the
  session bar, the button on the change bar; `GET /api/v1/store` says which host the server's machine runs.

## Delivery

An accepted decision reaches the sessions working its change (decision rex-adapter/delivery-through-the-host,
by-agent): one voice per session. A session whose agent's harness adapter wakes it itself (Claude Code: the plugin's
wake module submits a turn that the prompt hook briefs) hears it from there. Every other session on the change that
runs in a host, has not ended and spoke inside the window is told through the host's `send`, wherever the acceptance
came from (the dashboard, `pjman decision --accept`): one line naming the decision, the option and the person's words,
and where to read on. The agents with a waking adapter are listed in `src/commands/host.ts` (`WAKING_AGENTS`); a
harness adapter that gains a wake module adds its agent there. The decision's result lists each delivery and whether
the host took it.

## The follow window

A host with no browser pane to dock the session's page in (Rex: its blocks are terminals only) gets the follow window
instead (change:follow-window): one browser window, its own and never a tab (an app window on a Chromium browser, a new
window in Safari and Firefox), at the dashboard's `/follow`, that shows the session the person last prompted. The
harness adapter tells the dashboard at each prompt (`POST /follow`); the window holds `GET /follow` as a stream, which the
dashboard counts as an open window, and goes to each session it names, or, while the person looks around, holds and
offers it. A session's start in such a host asks `POST /follow/ensure` and opens the window (`pjman open --follow`) only
when told to: never while one is open, and to one caller only. Once a host reports which block has the person's focus,
that will move the window too; a host's dock, where it has one (cmux), stays as it is.

## Adding a host

One object in `src/host.ts` implementing `HostAdapter`, with its manifest, added to `HOSTS`; a fake command in
`src/test/host.test.ts` recording every call, so each of the six things is tested without the host installed; a row
in the tables above. Nothing else knows a host's name.
