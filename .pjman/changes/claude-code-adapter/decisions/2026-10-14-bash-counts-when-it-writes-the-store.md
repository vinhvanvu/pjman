---
title: A shell call counts as acting only when it writes the store
status: decided
decided_by: person:vinh
decided_on: 2026-10-14
writer: agent:claude-code
session: session:0d82d62c-3adf-48f4-ac2f-187f83294bca
created: 2026-10-14
---

## Decision

A turn is logged when it wrote a file through an editing tool, or when a shell command invoked a store write (new, set, session, mv, fmt, init). A shell call that only reads, builds or tests does not count, and a read-only turn leaves no log line. A file edited through the shell is not observed; that is a known gap, accepted for now.

## Why

Counting every shell call as acting logged read-only turns: a status question produced a session log line. The log is for turns that changed the record or the project, and store writes through the shell are the common case worth keeping.
