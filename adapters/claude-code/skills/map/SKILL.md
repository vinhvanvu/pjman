---
name: map
description: >-
  Giving a product its map: when `pjman context` opens with "no product map" (a product with no feature yet), and when
  the person asks for the map to be regrouped because it has outgrown its shape. Surveys the person's words, the
  documentation, the code's split and the store; drafts the top level as the layers of the stack, each titled as a
  sentence a person would recognise; proposes the whole tree in a proposed decision; applies it only on the go, as one
  batch; verifies. Prescribes the map, never the work.
---

## When

Twice in a product's life, and only then:

- **No map.** `pjman context` opens with `no product map: … has no map yet`. Survey and propose in that session. Never
  create the tree without the go; never create a feature at a time to fill the gap.
- **A regrouping, asked for.** The person says the map should be reorganised. You may say what you see beforehand (many
  flat top-level features; one node holding most of the work; open changes that name no feature, the count `pjman tree`
  prints) and recommend this skill. You never run it unasked.

Intake answers one request; this skill answers the whole product. One request that needs a capability is intake's,
not yours.

## The sentence test

A node is a feature when it can be titled as what the product does for a person, in a sentence a user would recognise.
A package, a module or a directory that cannot be titled that way is not a node: `utils` never appears; `the record of
the work lives as files a person can read` is a store. The layer is the grouping; the sentence is the title.

## 1. Survey, in this order

1. **What the person said** about the product: at init, in the prompt, in `project:<slug>`'s title and the product's.
2. **The documentation**: README, docs, specs, decision records, a changelog. This is where the product is already
   described in a person's sentences, which is what a title must be. Documentation alone is enough for a repository
   with no code yet.
3. **The code's own split**: top-level packages and directories, routes, commands, build targets, test folders. This
   says how the product is cut, not what it is for.
4. **The store**: `pjman ls change`, done and open; `pjman tree`. Work already filed names what people care about, and
   must find a node in the map you propose.

Read; write nothing yet.

## 2. Draft the top level: the layers

The top-level features are the layers of the stack, each titled as a sentence. Surfaces apart from the store and the
model; the app apart from both. The usual shape is four, and the repository's own split decides:

- **store** — what is written: records, keys, validation, provenance
- **model** — what is read from it: the derivations every surface shares
- **io** — how it is reached, in and out: the command line, the HTTP API, syncs, adapters, onboarding
- **app** — what a person sees: shell, lenses, views, the record pane

A library has two or three; a service may have a pipeline where an app would be. Four to seven at the top; never a
layer with one child, never one holding most of the work.

## 3. Nest by the code's split, two levels only

Beneath each layer, groups and capabilities follow the code's own split: `dashboard → lenses → roadmap → gantt`.
Every node beneath the top level is a capability (the last level label repeats beneath depth two); no area level above
feature. Go no deeper than a change would name. Each capability gets `--name`, one to three words, and a title that is
the sentence.

For a regrouping, draft the moves as well as the nodes: which existing node goes under which layer (`parent=` set,
`product=` cleared), which is renamed (`pjman mv feature:<old> feature:<new>`, the old slug kept as an alias so every
reference and every old link still resolves), which new nodes stand for things already built and which done change
names each (`adds feature:<slug>` on that change, so the node reads live). Remove a node only when nothing names it.
Never replace a node by hand: a rename keeps the past true.

## 4. Propose, and wait

Open a change for the map (`change:map` for a bare product; `change:map-by-layer` or the person's name for a regrouping)
and one decision `proposed` on it whose text is the whole tree: every node with its sentence, the moves, the renames,
the new nodes and what names them. Put the tree in your reply as an indented list. Say what the dashboard will read
differently (the roadmap's lanes are the top-level nodes; a bug's home is the top-level node above the one it names).
Then stop. Nothing is written to the tree until the person says go.

## 5. Apply, as one batch

On the go, write the commands one per line and hand them to `pjman apply - --for decision:<change>/<slug>`, in this
order, so the store validates at every line:

```
new feature store --name Store --product product:<slug> --title "…"
new feature lenses --name Lenses --parent feature:dashboard --title "…"
set feature:events parent=feature:store product=
mv feature:board feature:lanes
new feature cli --name CLI --parent feature:io --title "…"
set change:tool "features=adds feature:store,adds feature:cli"
```

Layers, then groups, then moves, then renames, then new nodes, then the naming from done changes. The tool runs them
with every commit held and lands one commit and one `applied` event, or refuses the whole batch at the line that
fails and writes nothing. `pjman undo` reverts it as one commit while nothing later touched its records. Then mark the
change `review` with `next` naming what the person should read.

## 6. Verify, thoroughly

- `pjman validate`: clean.
- `pjman tree product:<slug>`: read it top to bottom; every layer titled as a sentence, nothing deeper than a change
  would name, no node that reads `planned` though it is built (a done change names it).
- `pjman intake "<a request a user might make>"`: the node it should alter is found.
- The dashboard, when it runs: the product map's top nodes, the roadmap's lanes unfolding, a bug's home.
- The open changes that name no feature: each is a milestone, a foundation, or a gap you close through intake.

Anything the dashboard reads wrong at the new depth is a bug to file, not a reason to flatten the map.

## The reply

The tree as the person will see it, then one line per write the batch made (the footer the receipt also shows), and
what reads differently from before. Then `pjman set change:<slug> next=…`: what they should click through.
