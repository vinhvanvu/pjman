# pjman

The record of a software product, kept in git by the agents that build it.

![The dashboard: every running session, grouped by what each needs from you](assets/hero.png)

A change, a decision, a feature, a session and a release are records in one git store, under one schema. Coding agents read the record at the start of every session and write back through one command. You read it on a dashboard and make the decisions.

## Install

```bash
npm install -g pjman
cd <your-repo> && pjman init
```

Node 22.13 or newer and git. With Claude Code on the PATH, `pjman init` installs the plugin, and every session from then on starts from the record.

## What you get

### Sessions that start from the record

![A session's first screen: the board, the bound change, the rules the agent works by](assets/session-start.png)

The agent opens with what is in flight, the change it is on, and the rules. Say what you want done; it files the work as a change.

### A change with its plan

![pjman context change:<slug>: name, gist, origin in your words, intent, done when, the steps](assets/change.png)

Where it came from in your words, what it is for, what done means, and the steps. Status and progress are derived, never written.

### Decisions you make, not the agent

![A proposed decision on the dashboard: the options, the recommendation, Accept](assets/decision.png)

The agent lays out the options and recommends one. You accept it, in your words, and the session working the change is told.

### The product map

![The product map: features and the capabilities beneath them, state as a dot](assets/map.png)

What the product is. A change names the node it adds, changes or removes, and a feature's state follows from the changes that built it.

### The roadmap

![The roadmap: the past by time on the left, the order on the right, milestones holding their children](assets/roadmap.png)

In what order it comes. Drag to reorder; dependencies and dates that contradict the order are flagged.

### Releases from the record

![npm run release: the version level and the changelog derived from the changes shipped](assets/release.png)

One command reads what main shipped since the last tag, resolves each merge to its change, derives the version level, writes the changelog, and records the release.

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
