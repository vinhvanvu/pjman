---
id: 01a127d2-7897-779a-8525-96f76e8fdb0d
type: decision
writer: person:vinh
session: 01a127d2-7897-7590-bf0f-b16c7d82fc78
created: 2026-10-10T18:00:00-07:00
updated: 2026-10-10T18:00:00-07:00
title: The schema is layered and minimal; content lives in ext: or the body
status: decided
decided_by: person:vinh
decided_on: 2026-10-10
change: 01a127d2-7897-731b-a4f0-670b9078ddd0
links:
  - 01a127d2-7897-76b9-a84f-817c3d0667d9
---

## Decision
Five layers (core, sources, work, product, authority), each depending only on those below. The foundation fixes structure only: ids, types, provenance, edges, status, the decided fields. `next`, `goal`, `parent` on change, `evidence` as a field, `claim`, Plan and Feedback sections are pruned to `ext:` or the body. Principals are records; a spawn is a session, never a principal; every write has provenance.
## Why
A foundation others build experiences on (a client, cmux, mods, a custom app) must not pre-decide their content. The extension rule lets core fields grow without collisions. Layering lets a store adopt complexity optionally and keeps the code compartmentalised. (Conversation, 2026-10-10.)
