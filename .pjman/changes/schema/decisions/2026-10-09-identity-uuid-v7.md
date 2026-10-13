---
title: "Identity: UUID v7 ids; external entities map onto them"
status: superseded
decided_by: person:vinh
decided_on: 2026-10-09
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-09
---

## Decision

Every record gets a time-ordered UUID at creation; external entities bind to it; references inside files use ids; the CLI accepts a unique prefix.

## Why

Agnostic to the source of a change; globally unique before multi-writer forces it.
