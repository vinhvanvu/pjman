# pjman

The record of a software product, kept in git by the agents that build it.

![The bridge: the day's writes on one timeline, and the changes in motion grouped by what each needs from you](assets/hero.png)

A change, a decision, a feature, a session and a release are records in one git store, under one schema. Coding agents read the record at the start of every session and write back through one command. You read it on a dashboard and make the decisions.

> Works best in [cmux](#works-best-in-cmux-and-rex) and [Rex](#works-best-in-cmux-and-rex): the dashboard docks beside the session and follows it. Any terminal works.

## Getting started

**1. Install.** Node 22.13 or newer and git; Homebrew brings its own Node.

```bash
npm install -g @vinhvanvu/pjman   # or: brew install vinhvanvu/pjman/pjman
```

**2. Run `pjman init` in a repository.** It asks one question, whether a product map should be proposed from the repository, and prints what it did:

```console
$ cd acme && pjman init
Should the first session propose a product map from this repository? [Y/n]
created the global store at ~/.pjman/store (its own git repository)
created person:ada
the repository holds code (package.json)
created product:acme
registered project:acme under product:acme
the first change through intake proposes a product map …
you are person:ada
Claude Code: installed the pjman plugin at user scope (hooks, skill, brief, Linear MCP); it loads at the next session or /reload-plugins
dashboard: http://127.0.0.1:7331
left to do: nothing here; to read tickets, sign in to the tracker from inside a session (/mcp)
```

When it worked you have four things: a store of your own at `~/.pjman/store`, the repository registered as a project under a product, the Claude Code plugin installed (when `claude` is on the PATH), and the dashboard running at the address it printed. Running it again is the health check: it repairs what is missing and undoes nothing.

**3. Start a session.** Run `claude` in the repository. The agent opens with what pjman is, the rules it works by, and what is in flight:

![A session's first screen: what pjman is, the rules the agent works by, then the board of what is in flight](assets/session-start.png)

**4. Say what you want done.** The agent files it as a change with a plan, and with the first one proposes the product map as a decision for you to accept. `pjman open` brings the dashboard to the session's page; in cmux it is already docked beside you.

## Works best in cmux and Rex

pjman runs in any terminal. In a terminal it knows, the session and the dashboard become one workspace.

![A real session in cmux: the agent at work on the left, the dashboard docked beside it on the session's page](assets/docked.png)

- **Docked beside the session** (cmux). At session start a pane opens on the bridge. Once the session takes up a change the pane follows it: what the session is on, the decisions waiting on you, its log, the handoff. It closes with the session.
- **Labelled.** The session's block (Rex) or sidebar pill (cmux) says which change it is on and where the work stands.
- **Live state** (Rex). The dashboard reads working, waiting on you, or stopped from the terminal itself, as it happens.
- **Open and launch from the dashboard.** A session's row brings its terminal to the front; a change can start a session in a worktree named for it.

Elsewhere the dashboard opens in your browser and reads a session's state from the record. What each terminal gives is in [`adapters/hosts.md`](adapters/hosts.md).

## The dashboard

Four places, one per question.

### The bridge: what needs you now

The picture at the top. The day's writes on one timeline, every live session, and the changes in motion grouped by what each needs from you.

### The product map: what the product is

![The product map: features, the capabilities beneath them and the open work at the leaves, state as a dot; the product's record beside it](assets/map.png)

A change names the node it adds, changes or removes, and a node's state follows from the changes that built it.

### Milestones: toward what

![Milestones: the ones in flight nearest to done first, each with its progress, its count of changes done and the next one; the done folded beneath](assets/milestones.png)

A milestone is a goal whose plan is the changes filed under it. Its progress is their done count.

### The roadmap: in what order

![The roadmap: done by the day and in flight on the left, what is in order and what comes later on the right](assets/roadmap.png)

Drag a column to reorder; dependencies and dates are checked against the order and never move it.

## Working with it

### Start a change by saying what you want

```text
you    export a saved card as a PDF
agent  filed change:card-export · changes feature:saved-cards · one change · later · no date
```

The agent checks for a duplicate, finds the node on the map the request alters, and files a change: where it came from in your words, what it is for, what done means, and the steps. Status and progress are derived, never written.

![A change's page: name, gist, the plan as steps, its decisions, then the origin in your words, the intent and done when](assets/change.png)

### Name a ticket and get its change

```console
$ pjman get vinhvanvu/pjman#11
vinhvanvu/pjman#11 → github-issue:vinhvanvu/pjman#11 (ticket id; source)
source github-issue:vinhvanvu/pjman#11 — /clear closes the cmux dock and reopens it in a new pane about 14s later

referenced by:
- binds change:clear-keeps-dock

reached change:clear-keeps-dock through binds

# change:clear-keeps-dock — Clear keeps the dock
Clearing a session keeps its docked pane and points it at the new session's page
status: done
kind: bug · severity nuisance
…
```

Issues from GitHub and Linear are read with the tracker's own tools and handed to `pjman sync`. Each becomes a source in the store and, when no change has it yet, a change with the ticket in its origin. From then on the ticket's id is a way in: `pjman get` with an id, a URL, a file or a key answers with the record and every change in reach, and a session whose prompt names a ticket starts on its change.

### Decisions you make, not the agent

![A proposed decision: the question, the options with the recommended one marked and its why, Accept with a line in your words](assets/decision.png)

Before a choice that forecloses options, the agent lays the options out and recommends one. It never accepts its own. You accept on the dashboard or in the chat, in your words, and the session working the change is told.

### Releases from the record

![npm run release -- --dry-run: the level each change implies, the version it adds up to, and the changelog written from the changes' own names and gists](assets/release.png)

One command reads what main shipped since the last tag, resolves each merge to its change, derives the version level, writes the changelog, publishes to npm and the Homebrew tap, and records the release.

## How it works

- The store is `~/.pjman/store`: Markdown files with YAML frontmatter, one per record, in a git repository of its own.
- The `pjman` command is the schema. Every write goes through it and is validated.
- A skill tells the agent what to record and when. Hooks do the rest: the brief, the binding, the log line, the receipt after every turn.
- The terminal the session runs in is a host (Rex, cmux), reached through one interface: the session's record says which, its block is labelled with the change and where the work stands, the dashboard reads the session's state from the host and opens or launches a session on it (`adapters/hosts.md`).
- Nothing is dropped and nothing is written by hand.

## Docs

- [Reference](docs/reference.md): the store, every command by entity (create, read, list, update, delete, rename), the dashboard and the API, trackers, releases. In the terminal, `pjman help` prints the same by entity and `pjman help <entity>` one of them.
- [SCHEMA.md](SCHEMA.md): the record contract.
- [THESIS.md](THESIS.md): why.
- [The Claude Code adapter](adapters/claude-code/README.md): the hooks and the skills.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
