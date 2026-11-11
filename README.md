# pjman

The record of a software product, kept in git by the agents that build it.

![The bridge: the day's writes on one timeline, and the changes in motion grouped by what each needs from you](assets/hero.png)

A change, a decision, a feature, a session and a release are records in one git store, under one schema. Coding agents read the record at the start of every session and write back through one command. You read it on a dashboard and make the decisions.

## Install

```bash
npm install -g @vinhvanvu/pjman   # or: brew install vinhvanvu/pjman/pjman
cd <your-repo> && pjman init
```

Node 22.13 or newer and git; Homebrew brings its own Node. With Claude Code on the PATH, `pjman init` installs the plugin, and every session from then on starts from the record. Installing with Homebrew, an npm copy that shadows it, and upgrading: [docs/install.md](docs/install.md).

## What you get

### Sessions that start from the record

![A session's first screen: what pjman is, the rules the agent works by, then the board of what is in flight](assets/session-start.png)

The agent opens with what pjman is, the rules it works by, and what is in flight. Say what you want done; it files the work as a change.

### A change with its plan

![A change's page: name, gist, the plan as steps, its decisions, then the origin in your words, the intent and done when](assets/change.png)

Where it came from in your words, what it is for, what done means, and the steps. Status and progress are derived, never written.

### Decisions you make, not the agent

![A proposed decision: the question, the options with the recommended one marked and its why, Accept with a line in your words](assets/decision.png)

The agent lays out the options and recommends one. You accept, in your words, and the session working the change is told.

### The product map

![The product map: features, the capabilities beneath them and the open work at the leaves, state as a dot; the product's record beside it](assets/map.png)

What the product is. A change names the node it adds, changes or removes, and a node's state follows from the changes that built it.

### The roadmap

![The roadmap: done by the day and in flight on the left, what is in order and what comes later on the right](assets/roadmap.png)

In what order it comes. Drag a column to reorder; dependencies and dates are checked against the order and never move it.

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
