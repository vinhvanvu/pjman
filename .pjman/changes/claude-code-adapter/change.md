---
title: The Claude Code adapter
status: done
links:
  - file:adapters/claude-code/README.md
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-13
---

## Summary

Phase 1 step 3. A plugin of hooks and one skill. At session start the session record is created and the store's context injected; a prompt naming a change binds the session and injects that change's context; a file write in the project records an observed links edge from the bound change; a turn that edited a file or wrote the store leaves one log line from the assistant's own first line, with no model call; a subagent is a child session. Harness-specific things live in the adapter and under ext, never in a record.
