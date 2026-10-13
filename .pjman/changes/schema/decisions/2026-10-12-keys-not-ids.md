---
title: References are keys, not ids; ids live only in the index
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
supersedes: decision:schema/identity-uuid-v7
links:
  - file:reviews/2026-10-11-schema-adversarial/00-verdict.md
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

Inside records every reference is a human-readable key: person:vinh, agent:claude-code, change:schema, decision:schema/keys-not-ids, linear:ABC-1, file:THESIS.md, session:<harness-id>. The index mints UUID v7 ids, maps keys to them, and records conflicts: two records at one key, one source bound twice.

## Why

Tokens, readability and agent error rate: a UUID in a prompt is a cost paid on every read for a benefit paid on no read. The v2 store proved it: four of twenty-two hand-written records were invalid.
