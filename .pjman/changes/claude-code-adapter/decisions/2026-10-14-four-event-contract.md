---
title: A harness adapter is four event mappings
status: decided
decided_by: person:vinh
decided_on: 2026-10-14
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-14
---

## Decision

Session begins: create the session record if it does not exist and inject pjman context. Session resumes or its context is compacted: hydrate from the graph again, the store overview plus the bound change's full context. A prompt names a change: session bind, and inject that change's context the first time. A tool writes a file in the project: mark the turn as having acted and record an observed `links` edge from the bound change to the file. The turn ends and acted: session log, from the harness's last message, no model call. A subagent starts: a child session with `parent`. Binding follows what the prompt names, never the directory or branch. Only event names and input formats differ between harnesses.

## Why

Every coding agent exposes these events in some form; this is the whole of what the record needs from a harness, and it is portable. The observed edges and the hydration are the point of the graph: it is the reference the agent works from, not a log it writes to.
