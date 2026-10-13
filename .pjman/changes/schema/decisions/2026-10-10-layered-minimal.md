---
title: The schema is layered and minimal; content lives under ext or in the body
status: decided
decided_by: person:vinh
decided_on: 2026-10-10
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-10
---

## Decision

Layers, each depending only on those below; a store enables what it needs. The foundation fixes structure only. Harness-, tool- and vendor-specific things live in adapters, configuration and under ext.<owner>.<field>, one writer per subtree, never validated.

## Why

A foundation others build experiences on must not pre-decide their content; the extension rule lets fields grow without collisions.
