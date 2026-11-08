---
name: intake
description: >-
  Filing new work into a pjman store: before `pjman new change` or `pjman new feature`, and when first working a
  change that names no feature. Checks for duplicates, then answers four questions (what on the map, one deliverable
  or several, where in the order, when) with defaults, and states the answers in one line. Prescribes the record,
  never the work.
---

## When

Every time a request becomes a record: a sentence from the person, a ticket the sync brought, a report of a fault.
Whether a request is work at all is your judgment; whether to run intake is not. Also when you first work a change
that names no feature (a synced ticket arrives that way): answer the first question then. On a product with no map,
intake is where the map begins (below): the first change filed brings the map with it.

## How

Run `pjman intake "<the request in its own words>"`. It answers with what already exists: open changes that share
the request's words or are named in it (the duplicates), done ones that covered something like it, the nodes of the
map it may alter, the milestones in flight, and the order's tail. The tool searches exactly; you judge.

### 0. Duplicates first

If an open change already covers the request, file nothing. Link the new source to it (`pjman set change:<slug>
links=…,<key>` or `binds=` for a ticket), note the second report in its Notes (`pjman note <change> "…"`), and name that change in your reply.
A second report of a bug is a signal of reach: reopen the severity question. If the match is done, the request is new
work that links the old change (`--links` or `--depends-on` as fits); for a bug that is a regression.

### 1. What does it alter on the map?

- **Default: an existing node**, named as specifically as the level definitions allow (`--features "feature:<slug>"`,
  the capability rather than the feature above it). Look for it honestly first: the tool's word match, then the tree
  (`pjman tree`) for the feature the request correlates to.
- **A new capability** only when the request describes a behaviour a user would recognise that no node covers:
  `pjman new feature <slug> --name "…" --title "…" --parent feature:<slug>`, then `--features "adds feature:<slug>"`.
  Never from a ticket label. Name it in the one-line reply: one `pjman rm` undoes it.
- **Nothing** when it alters no behaviour (a refactor, a build step, docs): the change names no feature and sits in
  the foundations row.
- **A removal** names the node with its verb: `--features "removes feature:<slug>"`.

A bug (`--kind bug`) names the live node it breaks and carries a severity, where on the tree the behaviour is lost:
`product` (nobody can use it), `feature` (a feature's sentence is false), `capability` (one behaviour is gone; deeper
nesting reads as capability), `nuisance` (works with a workaround), `cosmetic` (nothing lost). Start from the level of
the node named and raise it when the blast radius is wider. A report of behaviour the map does not have is not a bug;
it is a request, filed as work. When the behaviour plainly exists and is broken but the map has no node for it, the
bug is the evidence the node was missing: after the honest search, create the live node it breaks under the feature it
correlates to (`--status live`, the feature too when none exists) and name the bug on it. The search comes first, so a
mapped product never gets a duplicate.

#### When the product has no map

The tool's output opens with **No map yet** while the product has no feature (unless the project said `map=skip`),
and says what the repository holds. The map comes with this change, in the same breath; the change is filed either
way, since the person came to work it.

- **Docs, code, or both:** file the change with no feature, then follow the `map` skill at once: survey, and open the
  whole tree as one proposed decision whose text names this change as the first it houses and the node it would name.
  The apply batch sets the change's features (`set change:<slug> "features=…"` as its last line). Say in the reply
  that the map waits in the inbox. Docs give the sentences and their status; code gives the split; both give the
  better proposal.
- **Bare (nothing to survey):** no tree can be proposed, so the map grows from the work. Create the capability this
  change needs under the feature it best correlates to, creating that feature when none exists, so every node has a
  parent from the first change; name both in the reply. The sizes a proposed map keeps (four to seven layers, no layer
  of one) apply at proposal and regroup time, not to a growing map; the context offers a regrouping once the shape has
  outgrown its first guesses.

### 2. One deliverable or several?

- **Default: one change.**
- Several things that ship together become a milestone with children (`--parent change:<milestone>`), or children of
  a milestone the request names. Name the features the milestone delivers on the milestone itself when it is formed
  before its children.

### 3. Where in the order?

- **Default: the tail**, as later. Nothing to do: a change not on the sequence comes after it.
- It moves up only when the person says so: `pjman order change:<slug> --before change:<x>` / `--after` / `--first`.
- A dependency only when the request states it or the work cannot start without another change's result:
  `--depends-on change:<x>`. Never from resemblance. Say in the reply that it was recorded.
- A bug is never placed in the sequence by you; it joins the pool, ordered by severity then age. A person places it.

### 4. When?

- **Default: no date.** A target goes on a milestone only when a person gives one: `--target yyyy-mm-dd`.

## The reply

One line, every time: what you did (filed, attached to an existing change, or filed against a done one) and the four
answers. For example: *filed change:card-export · changes feature:saved-cards · one change · later · no date.*
Every answer is revised by the tool's own moves (`pjman set … parent=`, `features=`, `depends_on=`, `target=`;
`pjman order`), never by re-filing.
