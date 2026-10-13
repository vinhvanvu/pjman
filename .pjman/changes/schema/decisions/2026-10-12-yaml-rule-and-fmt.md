---
title: "The YAML rule: scalars with colon-space, hash, or a special leading character are quoted"
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

pjman validate reports; pjman fmt quotes and normalises field order. A hand-written record that fails to parse is reported with the repair.

## Why

The commonest agent error on frontmatter is an unquoted colon in a title.
