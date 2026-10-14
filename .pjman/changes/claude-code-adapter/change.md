---
title: The Claude Code adapter
status: review
next: Vinh installs the plugin (claude --plugin-dir, or the local marketplace) and runs a real session on pjman; then the eight-week test rule.
links:
  - file:adapters/claude-code/README.md
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-13
---

## Summary

Phase 1 step 3. A hook that injects `pjman context` at session start and writes the session record; a skill rule that opens a decision proposed before acting; a bridge that emits the work tool's summary.md so the existing sidebar keeps working. Harness-specific things live in the adapter and under ext, never in a record.
