# pjman

pjman is a command-line tool and a Claude Code plugin. It keeps a record of your product work in a store: Markdown files in a git repository on your machine.

The agent reads the store at the start of each session and writes to it through the `pjman` command, so a new session starts from what earlier sessions recorded. A local dashboard shows the same files. pjman needs no account.

The store holds these records:

```text
product           pantry            what you are building
└─ feature        shopping-list     what it does for a person
   └─ capability  share-a-list      one behaviour of that feature
      └─ change   list-as-pdf       one unit of work: origin, intent, done when, plan
         ├─ decision  page-size     a choice: options, one recommended, accepted by you
         ├─ source    ABC-1234      a ticket, PR, doc or file the work points at
         └─ session   2026-11-21    one agent run that worked on it
```

Status is derived, not written by hand. A change's status follows its plan, and a capability is live once the change that adds it is done.

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

Init creates your store, registers the repository as a project, installs the Claude Code plugin when `claude` is on your PATH, and starts the dashboard. Your repository is not changed. The store is a git repository of its own, and every write to it is a commit:

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

Nothing is created until you accept it.

### If you say no

No map is proposed, and your requests are filed the same way. To turn the offer back on, run `pjman set project:pantry map=propose`.

## Ask for work

Say what you want done:

```text
you    let me save my shopping list as a PDF
agent  filed change:list-as-pdf · changes feature:share-a-list · one change · later · no date
```

Before it files anything, the agent does three things:

- **It checks for a duplicate.** If an open change already covers the request, it attaches yours to that change and files nothing new.
- **It finds the place on the map.** The change names the most specific feature it adds, changes or removes.
- **It files a change.** A change is one unit of work: where it came from in your words, what it is for, what done means, and a plan as steps.

This is the change in the store, trimmed to its main fields:

```markdown
---
name: List as PDF
gist: A shopping list can be saved as a PDF
status: open
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
- by-locale (recommended): US Letter in the US and Canada, A4 everywhere else
Why by-locale: A list printed at home should fit the paper in the printer.
Accepted by-locale by person:ada on 2026-11-21: by locale, and let me change it later
```

A session stops in one of three places: at a decision that waits on you, at a recorded blocker, or with every step done and the work committed for review. If the agent tries to stop anywhere else, the plugin sends it back once.

## Read the store

Every record is a file you can open. Three commands read the store for you:

```bash
pjman context                     # what is in flight
pjman context change:list-as-pdf  # one change in full
pjman tree                        # the product map, with the state of each node
```

`pjman open` opens the dashboard, a local page that draws the same store: what needs you now, the product map, the milestones and the roadmap. You can accept a decision there too.

## Finish a change

`pjman review change:list-as-pdf` prints what a reviewer judges the branch by: the change's intent, what done means, the decisions accepted on it, and its commits. `pjman merge change:list-as-pdf` lands the branch and sets the change done. It refuses while a finding stands that is of high severity or says the work is not done.

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
