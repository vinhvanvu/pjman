# pjman

pjman is a command-line tool and a Claude Code plugin. It keeps a record of your product work in a store: Markdown files in a git repository on your machine.

The agent reads the store at the start of each session and writes to it through the `pjman` command, so a new session starts from what earlier sessions recorded. A local dashboard shows the same files. pjman needs no account.

The records link to each other, so the store is a graph. A change knows the part of the map it changes, the decisions made on it, and the tickets and sessions behind it. A capability knows the files of code that implement it. A person knows the accounts they hold, their stakes on the map and their parts in the work. The links also cross the tree drawn below: one file can implement several capabilities, and one session or ticket can belong to several changes. The store holds these records:

```text
product           pantry               what you are building
└─ feature        shopping-list        what it does for a person
   ├─ person      ada                  tied to it as owner, a stake the nodes beneath inherit
   └─ capability  share-a-list         one behaviour of that feature
      ├─ source   src/share/pdf.ts     a file that implements it: a source of kind code
      └─ change   list-as-pdf          one unit of work: origin, intent, done when, plan
         ├─ decision  page-size        a choice: options, one recommended, accepted by you
         ├─ source    ABC-1234         a ticket, PR or doc the work points at
         └─ session   2026-11-21       one agent run that worked on it
```

Most state is derived from the records. A change becomes `planning` once its plan has a step and `active` once a step starts, and a capability is live once the change that adds it is done.

The examples on this page follow one made-up product: `pantry`, a shopping list app.

## Install

pjman needs git. The plugin needs [Claude Code](https://claude.com/claude-code).

With npm, on Node 24 or newer:

```bash
npm install -g @vinhvanvu/pjman
```

With Homebrew, which brings its own Node:

```bash
brew trust --formula vinhvanvu/pjman/pjman
brew install vinhvanvu/pjman/pjman
```

If the install stops, see [docs/install.md](docs/install.md).

## Set up a repository

```bash
cd pantry
pjman init
```

Init creates your store, registers the repository as a project, and installs the Claude Code plugin when `claude` is on your PATH. It asks once whether anything runs beside the store: by default nothing does, and the store and the agent's guidance are the whole of pjman. The dashboard, and the dock that keeps it beside each session, are opt-in, at init or later with `pjman configure`. Your repository is not changed. The store is a git repository of its own, and every write to it is a commit:

```text
~/.pjman/store/
└─ products/pantry/
   ├─ product.md
   ├─ features/shopping-list/feature.md
   └─ changes/list-as-pdf/
      ├─ change.md
      └─ decisions/2026-11-21-page-size.md
```

Init asks one question:

```text
Should the first session propose a product map from this repository? [Y/n]
```

A product map is a tree of what your product does: its features, and the distinct behaviours under each. Every piece of work names its place on it.

### If you say yes

Run `claude` in the repository and ask for your first piece of work. The agent files it, then asks you three questions: who the product is for, what it does for them, and what is next for it. From your answers, your docs and your code, it proposes the whole map as one decision:

```text
pantry
├─ shopping-list     Keep a list of what to buy
│  ├─ add-items      Add an item by typing it or scanning its barcode
│  └─ share-a-list   Send a list to someone else
├─ recipes           Turn a recipe into the items it needs
└─ stores            Sort a list by the aisles of your store
```

Nothing is created until you accept it. A repository with no docs or code yet gets no proposal: its map grows as changes are filed.

### If you say no

No map is proposed, and your requests are filed the same way. To turn the offer back on, run `pjman set project:pantry map=propose`.

## Ask for work

Say what you want done:

```text
you    let me save my shopping list as a PDF
agent  filed change:list-as-pdf · changes feature:share-a-list · one change · later · no date
```

For each request, the agent does three things:

- **It checks for a duplicate.** If an open change already covers the request, it attaches yours to that change and files nothing new.
- **It finds the place on the map.** The change names the most specific feature it adds, changes or removes.
- **It files a change.** A change is one unit of work: where it came from in your words, what it is for, what done means, and a plan as steps.

This is the change in the store, trimmed to its main fields:

```markdown
---
name: List as PDF
gist: A shopping list can be saved as a PDF
status: planning
features:
  - feature:pantry/share-a-list
plan:
  - text: Render a list to a PDF page
    state: open
  - text: Add Save as PDF to the share menu
    state: open
---

## Origin

> "let me save my shopping list as a PDF"

## Intent

A person in a shop with no signal still has their list.

## Done when

Save as PDF on any list downloads a file that shows every item on it.
```

A ticket or a URL named in your request is linked to the change as a source. Each file the agent writes for the change is linked too.

## Pick the work up in any session

Start a session on the change's branch, or name the change in your prompt. The session opens with the change's whole record: where it came from, what done means, every decision made, and the plan with the step the last session stopped on.

When the agent needs what came before on that part of the product, it runs `pjman history`. That lists the earlier changes, their decisions and their sources, for a node of the map and each parent above it.

When the agent reaches a choice that closes off options, it opens a decision with the options laid out and one recommended. It then works on what does not depend on the answer. Only a person can accept: the command refuses an acceptance from an agent.

```text
Page size (decision:list-as-pdf/page-size)
Question: Which page size does the PDF use?
Options:
- a4: Always A4
- letter: Always US Letter
- by-locale (accepted): US Letter in the US and Canada, A4 everywhere else
Why by-locale: A list printed at home should fit the paper in the printer.
Accepted by-locale by person:ada on 2026-11-21: by locale, and let me change it later
```

A session that wrote code for the change stops where the record says it can: at a decision that waits on you, at a recorded blocker, at a status you set, or with every step done and the work committed for review. If the agent tries to stop anywhere else, the plugin sends it back once.

## Start from the code

The record a session opens with lists the files of the capabilities the change names, so the agent reads those before it searches:

```text
## Code

feature:share-a-list:
- src/share/menu.ts (pinned)
- src/share/pdf.ts (found)
- src/share/ShareSheet.tsx (3×)
- src/share/ShareSheet.test.tsx (2×)
```

Each file is a source of kind `code`, linked to the capability it implements. Links are made in three ways:

- **By you.** `pjman code link share-a-list src/share/menu.ts` pins a file. A pinned link stays until you take it off.
- **By the agent.** When a search turns up a file that implements the capability, the agent links it, so the next session skips that search. When a listed path is gone, it moves the link to where the file went.
- **By the merge.** When a change in review lands, its diff updates each capability the change names. `pjman merge` does this when it merges. A pull request merged on GitHub is found by `pjman sync git`, which runs after any agent turn that pulls, while the branch is still in your checkout. A renamed file's links follow it, and each touched file counts once more. A link no person made drops after five merged changes to its capability pass without touching it.

The count after a file is how many merged changes to the capability touched it. `pjman validate` names any linked path that no longer exists. In a repository with history, `pjman code seed` gives each capability its first links from past commits that each name a single change and touch at most 15 files.

## People

A person is a record that holds their role, the accounts they use (`github-user:ada`, `linear-user:ada`, `email:ada@example.com`) and their ties. A tie is a typed edge from the person: its type is the relationship. A tie to a node of the map is a stake, and every node beneath inherits it until a nearer node names its own. A tie to anything else is a part.

```text
person:ada   Ada · designer
├─ owner     feature:shopping-list   a stake on the map
└─ author    url:…/share-spec        a part on a doc

linear-user:ada                      her account, not a tie
└─ assignee  ABC-1234                a synced ticket names the account, which leads to her
```

The agent keeps people from the conversation:

- **A name.** When you mention someone, the agent looks for their record by an account, the handle, an alias or the full name, and creates one only when no one matches. A first name alone lists the people it could be, so two people are never merged on a name.
- **A tie.** When you say who owns or wrote something ("Ada owns the shopping list"), the agent records the tie as said. A passing mention ties no one. `pjman tie person:ada owner feature:shopping-list` sets it yourself, and replaces what was said.
- **An account.** A ticket synced from GitHub or Linear names its assignee and author. Each reaches its person through the account, and an account no one holds shows as itself.

Two reads use them:

```bash
pjman people change:list-as-pdf   # who to tag on its pull request: stakes on what it changes, its ties, its tickets' people
pjman people person:ada           # her dossier: stakes, open changes she is on, tickets, decisions, last seen
```

The dossier is read from the store each time it is asked for. It holds keys and titles, never the text of a message or a doc.

## Read the store

Every record is a file you can open. Four commands read the store for you:

```bash
pjman context                     # what is in flight
pjman context change:list-as-pdf  # one change in full
pjman tree                        # the product map, with the state of each node
pjman code shopping-list          # the files beneath a part of the map, rolled up from its capabilities
```

With the dashboard opted into (`pjman configure --surfaces dashboard`), `pjman open` opens it, a local page that draws the same store: what needs you now, the product map, the milestones and the roadmap. You can accept a decision there too.

## Finish a change

`pjman review change:list-as-pdf` prints what a reviewer judges the branch by: the change's intent, what done means, the decisions accepted on it, and its commits. `pjman merge change:list-as-pdf` lands the branch and sets the change done. It refuses while any finding of the review is still open: each is fixed on the branch, dismissed with the reason, or deferred by a person first.

### With Entire (opt-in)

[Entire](https://entire.com) captures each agent session as a checkpoint on its commits, and runs review and merge through Trails. A project opts in with `pjman set project:pantry ext.entire.enabled=true`. `pjman doctor` names what the opt-in still needs.

Opted in, three things change:

- **Review.** `pjman review` files what it finds onto the change's Trail, and the Trail holds the merge until each finding is resolved.
- **Merge.** `pjman merge` goes through the Trail's gates. pjman never forces a merge past a gate and never approves one.
- **Why.** `pjman why <file>:<line>` reads a line back past its commit to the session that wrote it, its change and the decisions behind it.

Without the opt-in, none of Entire's commands run, and review, merge and `pjman why` work locally.

## Docs

- [Reference](docs/reference.md): the store, every command, the dashboard and its API, trackers.
- [SCHEMA.md](SCHEMA.md): the record contract.
- [Install](docs/install.md): Homebrew, upgrading, and what to do when an install is off.
- [The Claude Code adapter](adapters/claude-code/README.md): the hooks and the skills.
- [Hosts](adapters/hosts.md): the terminals a session can run in, and what each gives.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
