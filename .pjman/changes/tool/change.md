---
title: The tool
status: review
next: Vinh reviews the tool and the rebuilt store; then the Claude Code adapter.
links:
  - file:README.md
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-13
---

## Summary

TypeScript, one package: init (standalone by default, --in-project by flag), new, session, validate, fmt, ls, context, show, mv, index, query. Keys in files, ids in the index. The YAML rule enforced on write and repaired by fmt. In standalone mode the tool commits every write with a Pjman-Session trailer; in-project it never commits.

## Plan

Built in one pass on 2026-10-13 against SCHEMA.md v3, with 17 tests. Phase 1 step 1.
