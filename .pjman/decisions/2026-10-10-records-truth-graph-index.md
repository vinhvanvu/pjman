---
id: 01a127d2-7897-7a71-bf85-b66c2c59d46c
type: decision
writer: person:vinh
session: 01a127d2-7897-7590-bf0f-b16c7d82fc78
created: 2026-10-10T18:00:00-07:00
updated: 2026-10-10T18:00:00-07:00
title: Records are the truth, a graph is the index, the schema is independent of both
status: decided
decided_by: person:vinh
decided_on: 2026-10-10
links:
  - 01a127d2-7897-7374-972d-c956cffd0735
---

## Decision
Records are files in git. Edges are typed and declared on the record that made them; reverse edges derived. Authored edges live on records; observed edges on append-only session records. An embedded graph (or SQLite) is a disposable index. The CLI is the schema. No priority chain: disagreement is drift. The same schema runs over a hosted database in Phase 2.
## Why
A side store that must be kept in sync is a second source of truth (the Backstage failure). Files are readable by any harness, diffable, mergeable, and the open format. (DECISIONS.md 28.)
