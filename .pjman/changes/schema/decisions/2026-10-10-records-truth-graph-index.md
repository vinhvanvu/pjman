---
title: Records are the truth, a graph is the index, the schema is independent of both
status: superseded
decided_by: person:vinh
decided_on: 2026-10-10
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-10
---

## Decision

Records are files in git. Edges are typed and declared on the record that made them; reverse edges derived. Authored edges live on records; observed edges on append-only session records. An embedded graph or SQLite is a disposable index. The CLI is the schema. The same schema runs over a hosted database in Phase 2.

## Why

A side store kept in sync is a second source of truth. Files are readable by any harness, diffable, mergeable, and the open format.
