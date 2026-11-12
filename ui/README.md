# The dashboard app

The React app `pjman serve` ships. Built with Vite into `../dist/ui`; the server serves it with a history fallback.
The API under `/api/v1` is the only thing it talks to.

## Run

```
npm run build          # at the repository root first: the app's contract types come from dist/*.d.ts
cd ui && npm install
npm run dev            # Vite on :5173, API proxied to the running `pjman start` (PJMAN_SERVE overrides)
npm run check          # typecheck, lint, format check, tests
npm run build          # into ../dist/ui
```

## Three kinds of state, one owner each

| State  | What                                                               | Owner                                                                                |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| URL    | lens, node, view, grouping, filter, done and retired flags, window | TanStack Router; `lib/search.ts` is the schema                                   |
| Server | everything from the API                                            | TanStack Query (`data/queries.ts`); `data/live.ts` invalidates from the event stream |
| Client | theme, pane splits, pinned session, expanded tree nodes            | zustand stores in `state/`, preferences persisted (expanded nodes are not)           |

A value lives in exactly one of the three and is derived elsewhere, never copied.

**Identity has one source.** Which product a page is in, which node it stands on and what the crumb says come from the
URL, or from the page's own scope once it has arrived, through `lib/identity.ts` and nowhere else. Never from a guess:
not the store's list of products, not a previous page's scope kept as placeholder while the next loads. Content may
show a placeholder while it loads; identity may not, so the rail and the crumb show nothing rather than a likely
product. The rule came from the rail flashing the store's first product before the scope landed, and recording it as
the last opened (change:rail-product-flash).

History follows places. A place is what the two panes show: the scope, the selection and the view. Moving to another
place pushes an entry (focus, select, clear, a lens or view switch, a palette jump, a link out of the pane), so Back
undoes the last click. Refining how the same place is shown replaces (the record tab, the lanes' grouping, the filter,
the done and retired flags, the window, the milestone filter). The acts live in `routes/-LensPage.tsx` and `components/links/NodeLink.tsx`;
no component chooses push or replace on its own. Each pane carries a `data-scroll-restoration-id`, so Back and Forward
restore its scroll.

The app writes in two ways, each through the same library function the command runs, as the person signed in; the
event stream then invalidates everything. Reordering the roadmap: dragging a column, or a loose entry onto one, calls
`POST /order` through `useOrder` (`data/queries.ts`). Deciding in place (change:decide-in-place): Accept on a proposed
decision, wherever one shows its text, turns into Confirm on the first click and calls `POST /decide` on the second;
Reopen on a decided one in the change's Decisions tab calls `POST /reopen`. The control is
`components/decisions/DecideControl`, handed its write by the feature through `useDecideAction`, which gives none on a
page held at a past moment. Nothing else writes, and no component calls the client directly.

## Folders and boundaries

```
src/
  app/         entry point, generated route tree, test setup
  routes/      one file per route; `-LensPage.tsx` composes a page from features
  features/    one slice per lens or capability (feature-lens, roadmap-lens: the chart, the home and the bugs view; milestone-lens: the milestone page; work: lanes and the inbox; …): components, hooks, a pure model.ts, index.ts
  components/  shell (rail, top bar, panes), tree, cards, chips, presence, stats, ui/ (shadcn, generated)
  data/        client, query hooks, event subscription, contract types (type-only, from the tool)
  state/       preferences, follow
  lib/         keys and the link rule, formatting
  hooks/       width
  themes/      one CSS file per theme setting the token contract; the registry
  styles/      the Tailwind entry and the token map
```

Rules, enforced by `.oxlintrc.json` (a violation fails `npm run lint`):

- Features never import each other, nor routes or the app. Shared things live in components, data, state or lib.
- Components are presentational: data in, callbacks out. They never fetch and never import features, state or routes.
  Types from `data/contract` are fine.
- Data never imports components, features or routes. State, lib and themes are leaves.
- Contract types are imported type-only from the tool's own declarations (`@contract/*` → `../dist/*`), so the API
  has one definition.

## Themes

A theme is one file in `src/themes/` that sets the token contract (`--background`, `--primary`, `--status-*`, …)
under `[data-theme="<id>"]`, plus one line in `src/themes/index.ts`. Components never name a colour; `styles/app.css`
maps the tokens onto Tailwind utilities (`bg-surface`, `text-status-review`, `border-line`). Graphite is the default.

## Conventions

- shadcn components are copied into `src/components/ui` by the CLI and left as generated (excluded from lint and
  format). Everything else is ours.
- Key links go through `NodeLink`, which applies the link rule: a change or product keeps the current lens, a feature
  opens the feature lens, a session its page, anything else (a project, a decision, a source) the getter.
- Pure derivations live in a feature's `model.ts` and have tests beside them (`*.test.ts`, vitest).
