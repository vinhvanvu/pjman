---
title: The vocabulary is product, feature, change, decision, source, session, actor
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
supersedes: decision:schema/four-nouns
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

Source: a thing outside the store, which may exist only as a key. Session: a run, a record in layer 0, written by one adapter, append-only. Actor: a person or an agent; a definition, where a session is a run and a spawn is a session, never an actor. Product and feature are Phase 2.

## Why

Sessions and sources carry provenance and evidence; deriving them in adapters left nothing for the record to point at.
