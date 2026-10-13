---
title: Documents state what is true now; history lives in decision records and in git
status: decided
decided_by: person:vinh
decided_on: 2026-10-13
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-13
---

## Decision

Every document is cleaned so it states only what is true now; what changed and why is a decision record with supersedes, and git has the rest. The content of the project is backfilled into the store as records so that what the store surfaces is the source of truth.

## Why

Two places that both claim to be the record disagree eventually; the surfaced information must be the one that is true.
