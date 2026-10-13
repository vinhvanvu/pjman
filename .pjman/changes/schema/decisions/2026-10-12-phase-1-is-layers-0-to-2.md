---
title: "Phase 1 is layers 0–2: core, sources, work"
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
links:
  - file:reviews/2026-10-11-schema-adversarial/00-verdict.md
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

Layer 3 (product, features, touches) and layer 4 (authority) are Phase 2 and 3. Owner, actors' aliases and links, observed state on sources, and change-to-change edges wait for Phase 2. A record references its own layer or a lower one; the envelope's writer and session are exempt; an observed edge is evidence, never truth.

## Why

Adversarial round 1: Phase-3 concepts had leaked into the Phase 1 contract and nothing in Phase 1 could use them.
