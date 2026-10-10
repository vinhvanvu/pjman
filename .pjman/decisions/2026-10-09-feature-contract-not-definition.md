---
id: 01a127d2-7897-717e-b7a8-9aa6f9c7572f
type: decision
writer: person:vinh
session: 01a127d2-7897-7590-bf0f-b16c7d82fc78
created: 2026-10-10T18:00:00-07:00
updated: 2026-10-10T18:00:00-07:00
title: A feature is not defined; its contract is
status: decided
decided_by: person:vinh
decided_on: 2026-10-10
links:
  - 01a127d2-7897-76b9-a84f-817c3d0667d9
---

## Decision
Every feature has a name, zero or more parents, an owner, `affects` edges and a derived mapping. No `kind`, no typed hierarchy, unlimited depth. Many parents, one owner: ownership inherits only along a single parent line. Mappings are derived; nodes never are.
## Why
Product, design and engineering mean different things by "feature"; any definition is wrong for someone. The contract is what views and derived approvers render from. (DECISIONS.md 25; revised 2026-10-09 from one-parent to many-parents.)
