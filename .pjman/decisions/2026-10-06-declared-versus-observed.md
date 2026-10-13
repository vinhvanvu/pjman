---
title: Declared versus observed state; drift is first-class
status: decided
decided_by: person:vinh
decided_on: 2026-10-06
writer: agent:claude-code
session: session:8b4adf71-3b40-4665-956a-d2abae55f01c
created: 2026-10-06
---

## Decision

Observed state belongs to code, deploys, telemetry and the organisation's tools; declared state belongs to pjman. Drift is the gap, surfaced and routed, never silently resolved. Reconciliation at merge time is the core loop.

## Why

Terraform for product development: nobody owns the declared state today.
