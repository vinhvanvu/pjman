---
title: The core is domain-agnostic; software is built first
status: decided
decided_by: person:vinh
decided_on: 2026-10-07
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-07
---

## Decision

Nothing in the entities says code. Software comes first because its observed state is machine-readable; elsewhere drift detection degrades to human report.

## Why

The model should outlive the first domain.
