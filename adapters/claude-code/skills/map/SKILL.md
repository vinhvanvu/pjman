---
name: map
description: >-
  Giving a product its map: when `pjman intake` or `pjman context` says the product has no map and the repository holds
  docs or code (the first change filed brings the map with it, in the same breath), and when the person asks for the
  map to be regrouped because it has outgrown its shape. Asks the person about the product first, then surveys the
  documentation, the code's split and the store; drafts the top level as what the product does for its users, from the
  person's answers (the stack's layers only when its users would name them); proposes the whole tree in a proposed
  decision; applies it only on the go, as one batch; verifies. Prescribes the map, never the work.
---

## When

Twice in a product's life, and only then:

- **No map, and something to read.** `pjman context` opens with `no product map: … has no map yet; the repository
  holds docs / code / docs and code`, and `pjman intake` opens with **No map yet** the first time a change is filed.
  That filing is the trigger: file the change with no feature, then ask (step 0) and, once answered, survey and
  propose, the change named in the decision as the first it houses, so the person who came to work a ticket leaves
  with the ticket filed and the map waiting in the inbox. Until a decision is opened or the project says
  `map=skip`, every stop is sent back once. Never create the tree without the go.
- **A regrouping, asked for.** The person says the map should be reorganised, or `pjman context` says `map outgrown`
  (more than seven top-level features: a map grown one change at a time has passed the shape a proposal keeps). You
  may say what you see (many flat top-level features; one node holding most of the work; open changes that name no
  feature, the count `pjman tree` prints) and recommend this skill. You never run it unasked.

A **bare** repository (the context says it holds nothing yet) is not yours: there is nothing to survey, so no tree is
proposed. The map grows through intake, a capability under a feature per change, until a regrouping is asked for.

Intake answers one request; this skill answers the whole product. One request that needs a capability is intake's,
not yours.

## The sentence test

A node is a feature when it can be titled as what the product does for a person, in a sentence a user would recognise.
A package, a module or a directory that cannot be titled that way is not a node: `utils` never appears; `the record of
the work lives as files a person can read` is a store. The layer is the grouping; the sentence is the title.

## 0. Ask, for a first map

A first map starts from the person's words, not from the code. Before reading anything, ask two or three short
questions, in plain words, and end the turn:

- Who is the product for?
- What does it do for them (the three or four things they would say it does)?
- What is next for it?

These are facts only the person knows, not choices: ask them as they are, never as a decision. "Skip" is an
answer: set `pjman set project:<slug> map=skip` and say the map can be asked for later. When the person's words are
already in the conversation (they described the product in this session), say what you took from them and go on to
the survey. A regrouping asks nothing: the map it reshapes is the person's already.

## 1. Survey, in this order

The context's line says what the repository holds, so you know before reading which of these exist:

1. **What the person said** about the product: the answers to step 0 first, then at init, in the prompt, in
   `project:<slug>`'s title and the product's.
2. **The documentation**: README, docs, specs, decision records, a changelog. This is where the product is already
   described in a person's sentences, which is what a title must be. Documentation alone is enough for a repository
   with no code yet; each page says what shipped and what is drafted, which gives the status.
3. **The code's own split**: top-level packages and directories, routes, commands, build targets, test folders. This
   says how the product is cut, not what it is for; code alone makes `live` the default status. With both, the
   documentation names the sentences and the code names the split: the better proposal.
4. **The store**: `pjman ls change`, done and open; `pjman tree`. Work already filed names what people care about, and
   must find a node in the map you propose: the change that triggered this, first of all.

Read; write nothing yet.

## 2. Draft the top level: what it does for its users

The top-level features are what the product does for its users, in their words: the three or four things the person
said it does, each titled as a sentence. A small app reads as `people find a recipe by what is in the fridge`, not as
`store / model / io / app`. The code's split decides what nests beneath them (step 3), never the top.

The stack's layers are the top level only when the product's users are the ones who would name them: a developer
tool, a library, a platform whose users build on its store and its API. Then surfaces sit apart from the store and
the model, the app apart from both, and the usual shape is four:

- **store** — what is written: records, keys, validation, provenance
- **model** — what is read from it: the derivations every surface shares
- **io** — how it is reached, in and out: the command line, the HTTP API, syncs, adapters, onboarding
- **app** — what a person sees: shell, lenses, views, the record pane

A library has two or three; a service may have a pipeline where an app would be. Three to seven at the top; never a
layer with one child, never one holding most of the work. These sizes are for a tree proposed or regrouped whole; a
map growing one change at a time through intake is not held to them until it is regrouped.

## 3. Nest by the code's split, two levels only

Beneath each layer, groups and capabilities follow the code's own split: `dashboard → lenses → roadmap → gantt`.
Every node beneath the top level is a capability (the last level label repeats beneath depth two); no area level above
feature. Go no deeper than a change would name. Each capability gets `--name`, one to three words, and a title that is
the sentence.

Keys are paths under the product (`feature:<product>/<slug>`), so a slug need only be unique inside its own product:
two products may each have `activity`, and inside a project the slug alone names the node (`feature:activity`). Check
each slug against the product's own map before proposing it (`pjman tree product:<slug>`). The batch refuses itself at a
collision and writes nothing, so a miss costs one rerun, not a half-made map.

For a cold start there are no done changes to derive a state from, so give each node its status from the documentation
(`--status live` for what the ladder says shipped, `planned` for what is drafted or open, `building` for what is in
hand). The authored status stands until a change names the node; from then on the derivation takes over.

For a regrouping, draft the moves as well as the nodes: which existing node goes under which layer (`parent=` set,
`product=` cleared), which is renamed (`pjman mv feature:<old> feature:<new>`, the old slug kept as an alias so every
reference and every old link still resolves), which new nodes stand for things already built and which done change
names each (`adds feature:<slug>` on that change, so the node reads live). Remove a node only when nothing names it.
Never replace a node by hand: a rename keeps the past true.

## 4. Propose, and wait

Open a change for the map (`change:map` for a product with none, keyed under it as `change:<product>/map`; `change:map-by-layer` or the person's name for a regrouping)
and one decision `proposed` on it whose text is the whole tree: every node with its sentence, the moves, the renames,
the new nodes and what names them, and, when intake triggered this, the change just filed with the node it would name
(the first the map houses). Put the tree in your reply as an indented list. Say what the dashboard will read
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

Layers, then groups, then moves, then renames, then new nodes, then the naming from done changes and from the change
that triggered the map (`set change:<slug> "features=feature:<node>"`). The tool runs them
with every commit held and lands one commit and one `applied` event, or refuses the whole batch at the line that
fails and writes nothing. `pjman undo` reverts it as one commit while nothing later touched its records. Then mark the
change `review`, its plan's open step naming what the person should read.

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
what reads differently from before. Then `pjman step change:<slug> add "…"`: what they should click through.
