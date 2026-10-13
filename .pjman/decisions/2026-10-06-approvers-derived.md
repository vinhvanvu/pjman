---
title: Approvers are derived from a design record's deltas, never configured
status: decided
decided_by: person:vinh
decided_on: 2026-10-06
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-06
---

## Decision

Who must sign a change is computed from what the change touches and affects, through the ownership tree and the authorities' scopes.

## Why

Configured approver lists go stale; derived ones cannot.
