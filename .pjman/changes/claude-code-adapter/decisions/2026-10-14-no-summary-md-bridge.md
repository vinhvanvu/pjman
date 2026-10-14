---
title: No bridge to the work tool's summary.md
status: decided
decided_by: person:vinh
decided_on: 2026-10-14
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-14
---

## Decision

The adapter does not emit the work tool's summary.md. The adapter is the hooks and the skill only. A bridge to any board is a user's to write, inspired by the work tool and never copied from it.

## Why

The work tool's mod binds a session only when a prompt matches its own ticket pattern, so no file pjman emits can place a pjman session in its lanes. Keeping that sidebar working on pjman sessions is a change to the work tool, not to pjman.
