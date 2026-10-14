---
title: Hooks are the functional layer; mods curate the experience
status: proposed
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-14
---

## Decision

The adapter is built on the harness's lifecycle hooks (settings or plugin hooks), not on mods. Mods, panes and commands are per-harness experience built on the same store later, optional, and never what the record depends on.

## Why

Hooks hand the adapter the session id on every start, resume, clear and compaction, and an agent id for spawns; they run everywhere a session runs, including headless; they keep the adapter thin and the tool the only writer; they are legible to the second user. The mods session.start does not fire on clear or resume, so a mod must reconstruct session identity itself.
