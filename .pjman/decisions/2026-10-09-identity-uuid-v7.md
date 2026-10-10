---
id: 01a127d2-7897-79d1-9f8d-42dd3ea3256f
type: decision
writer: person:vinh
session: 01a127d2-7897-7590-bf0f-b16c7d82fc78
created: 2026-10-10T18:00:00-07:00
updated: 2026-10-10T18:00:00-07:00
title: Identity: UUID v7 ids; external entities map onto them
status: decided
decided_by: person:vinh
decided_on: 2026-10-10
---

## Decision
Every record gets a time-ordered UUID at creation. External entities bind to it; refs live on the record and the map is a derived index. Humans never type a UUID: folders and prompts use the key or slug; references inside files use ids; the CLI accepts a unique prefix.
## Why
Agnostic to the source of a change; globally unique before multi-writer forces it; moves and renames break nothing. (DECISIONS.md 27.)
