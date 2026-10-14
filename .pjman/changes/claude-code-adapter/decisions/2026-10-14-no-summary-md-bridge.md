---
title: No bridge to the work tool's summary.md
status: proposed
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-14
---

## Decision

The adapter does not emit the work tool's summary.md. The adapter is the hooks and the skill only.

## Why

The work tool's mod binds a session only when a prompt matches its own ticket pattern, so no file pjman emits can place a pjman session in its lanes. Keeping that sidebar working on pjman sessions is a change to the work tool, not to pjman.
