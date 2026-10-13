---
title: Records are the truth; the index is derived; Phase 1 has one backend
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
supersedes: decision:schema/records-truth-graph-index
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

Files in git are the only Phase 1 backend. A later backend (a hosted database) must provide the same operations — read, write, validate, query, reconcile — and supply what git supplies here: history, provenance, merge with typed conflicts. That is a Phase 2 design, not a layer-0 claim.

## Why

Schema independent of storage was a claim the Phase 1 code could not test; stating it as a backend requirement keeps the door open without designing through it.
