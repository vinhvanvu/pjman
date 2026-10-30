---
name: aspect
description: >-
  Working with an aspect in a pjman store: what applies across the product rather than at one place on the tree (how
  text reads, how the app moves, a component reused in many views). Use when creating an aspect, adding a place it
  applies, writing a place's fork, or editing an aspect's base; and when a change's context shows an Aspects section.
  Shapes the base by the kind of aspect, keeps every fork to what differs, and reconciles the forks whenever the base
  changes. Prescribes the record, never the work.
---

## What an aspect is

An aspect is its own small tree under the product, beside the features. Its body is the **base**: the one source of
truth for what the aspect says. Each **place** names one existing feature where the aspect applies; its body is the
**fork**, only what differs there, and is empty when the base holds as it is. A place at a feature covers everything
beneath it. A place is read as the base, then the forks above it, then its own (`pjman show aspect:<aspect>/<place>`).

The store holds no shape for either text. The shape is yours to choose, here, by what kind of aspect it is.

## Creating an aspect

1. Run `pjman intake` as for any new work, and ask whether an existing aspect already covers it (`pjman ls aspect`).
2. Say what kind of aspect it is, and shape the base for that kind. The kinds differ; do not force one on another:
   - **A guideline** (how text is written, how numbers are formatted): what it is for, who reads it, the rules, what it
     must not carry.
   - **A component** (a control or a card reused across views): what it is for, how it is used, what a place may
     vary, what it never does.
   - **A behaviour** (motion, time, live updates): what a person sees, the cases, what each view must respect.
   - Anything else: whatever lets someone at one place apply it without reading the others.
   Keep the base succinct; it is read in full in the context of every change at every place it reaches.
3. `pjman new aspect <slug> --title "…" --body - <<'EOF' … EOF`, inside a change that names it
   (`--aspects "adds aspect:<slug>"`). The base is markdown, written to the person's go like any record.
4. Add a place for each feature it applies at: `pjman new place <aspect>/<place> --feature feature:<slug>`, the place
   slug usually the feature's. Name the most general feature that holds; a place beneath it only where it forks.

## Writing a fork

Read the base and every fork above the place first (`pjman show aspect:<aspect>/<place>` reads them in order). Then
write only what differs at this place: never restate the base, never contradict it silently. When a fork replaces
something the base says, say which part it replaces, in the base's own words. If most of a fork would restate the
base, the place needs no fork; if every place forks the same way, the base is wrong. Change the base instead.

`pjman set aspect:<aspect>/<place> body=- <<'EOF' … EOF`.

## Editing the base

Writing a base prints every place it reaches, each fork in full. Reconcile each one with the new base before you stop:
a fork the new base makes redundant is emptied, one it contradicts is rewritten, one it leaves alone stays. Land the
base and its forks together as one batch (`pjman apply`), so one commit holds them and one undo puts them back; in a
batch line, `\n` inside double quotes is a line break. A change that names the aspect (`--aspects "changes
aspect:<slug>"`) has the base and every place in its context: read it there before the first edit.

## Working under an aspect

A change's context carries an **Aspects** section for the features it names: each aspect that applies there, read in
full, and the places beneath a broad feature one line each. That is the contract the work is done under. When the work
finds that a place needs something the base does not say, write the fork in the same change; when it finds the base is
wrong, say so to the person and open a decision on the change that names the aspect.
