---
title: Fields are authored or maintained; nothing is verified against a previous write
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

A field is authored by an actor on intent (may be hand-edited) or maintained by one named writer (hand edits are reported, not forbidden). There is no derived-and-checked class; updated is gone (git has it). Hand edits are tolerated and reported; invalid records are reported with path and reason, never dropped.

## Why

The derived-field drift rule was unimplementable without a baseline and produced merge conflicts.
