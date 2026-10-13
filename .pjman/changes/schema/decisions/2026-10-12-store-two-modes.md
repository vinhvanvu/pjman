---
title: The store is a git repository in one of two modes; standalone by default
status: decided
decided_by: person:vinh
decided_on: 2026-10-12
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-12
---

## Decision

Standalone: ~/.pjman/stores/<name>/, its own repository, bound to project paths in ~/.pjman/config.yaml; the tool commits after every write with a Pjman-Session trailer. In-project: <repo>/.pjman/, tracked; the tool never commits. The tool shells out to git for init, mv, reading history and committing in standalone mode, and wraps nothing else.

## Why

A standalone store is what the founder's job requires (nothing in product PRs) and what Phase 2 syncs with; in-project is what lets a decision be reviewed in the same PR as the work.
