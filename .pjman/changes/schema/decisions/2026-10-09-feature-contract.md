---
title: A feature is not defined; its contract is. Many parents, one owner
status: decided
decided_by: person:vinh
decided_on: 2026-10-09
supersedes: decision:/ownership-tree-authorities
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-09
---

## Decision

Every feature has a name, zero or more parents, an owner, a maturity claim with evidence, affects edges, and a derived mapping to the mechanism. No kind field, no typed hierarchy, unlimited depth. A feature may sit under several features; ownership inherits along a single line; a feature with several parents names its own owner. A change to a shared feature needs its owner's signature and notifies the owners of every feature that uses it. Mappings are derived; nodes never are. (Layer 3, Phase 2.)

## Why

Product, design and engineering mean different things by feature; any definition is wrong for someone. The contract is what views and derived approvers render from, and whose signature still has one answer.
