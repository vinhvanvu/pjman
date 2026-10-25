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

| State  | What                                                                                  | Owner                                                   |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| URL    | lens, node, view, grouping, done and retired flags, window                            | TanStack Router; `routes/-search.ts` is the schema      |
| Server | everything from the API                                                                | TanStack Query (`data/queries.ts`); `data/live.ts` invalidates from the event stream |
| Client | theme, expanded tree nodes, pane splits, pinned session                               | zustand stores in `state/`, preferences persisted       |

A value lives in exactly one of the three and is derived elsewhere, never copied.

## Folders and boundaries

```
src/
  app/         entry point, generated route tree, test setup
  routes/      one file per route; `-LensPage.tsx` composes a page from features
  features/    one slice per lens or capability: components, hooks, a pure model.ts, index.ts
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
  or project opens its home lens, a session its page, anything else the getter.
- Pure derivations live in a feature's `model.ts` and have tests beside them (`*.test.ts`, vitest).
