---
title: Renames go through pjman mv and leave aliases
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

The folder moves, the old slug is appended to aliases, every reference in the store is rewritten in one commit. A reference to an alias resolves and is reported as resolving via alias. One folder per change slug; two machines creating the same slug meet a git add/add conflict at merge, visible, never silent.

## Why

Keys make renames a tool operation where ids made them free; aliases keep stale references resolvable in between.
