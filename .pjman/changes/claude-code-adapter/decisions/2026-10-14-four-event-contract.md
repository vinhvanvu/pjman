---
title: A harness adapter is four event mappings
status: proposed
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-14
---

## Decision

Session begins, resumes or compacts: create the session record if needed and inject pjman context. A prompt names a change: session bind. A tool writes: mark the turn as having acted. The turn ends and acted: session log. Binding follows what the prompt names, never the directory or branch. Only event names and input formats differ between harnesses.

## Why

Every coding agent exposes these four events in some form; this is the whole of what the record needs from a harness, and it is portable.
