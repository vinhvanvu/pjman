// The feature lens's pure derivations over a scope: the product map is the features with the changes at their
// leaves (decision feature-detail/change-at-three-depths), the unassigned changes one group at the foot.
import type { ChangeRow, Health, Scope, ScopeAspect, ScopeNode } from '@/data/contract';

export const MAP_ROOT = '__map__';
/** The group of changes the lens could not place: a folder at the foot of the map. */
export const UNASSIGNED = 'unassigned';

export interface MapIndex {
  /** Every row by its id: a feature or a product by its key, a change by its path (a change naming two features
   *  sits under each), the unassigned group by its key. */
  items: Map<string, ScopeNode>;
  children: Map<string, string[]>;
  /** The ids a key is drawn at. */
  idsOf: Map<string, string[]>;
}

/** The change id under a parent: its path, since one change may be drawn under several nodes. */
export const changeId = (parent: string, key: string): string => `${parent}\n${key}`;

/** The map indexed for the tree: features and products as folders, the changes at each node as its leaves (a
 *  milestone's children each a leaf of their own, never nested), the unassigned group a folder at the foot. */
export function productMap(tree: ScopeNode[]): MapIndex {
  const items = new Map<string, ScopeNode>();
  const children = new Map<string, string[]>();
  const idsOf = new Map<string, string[]>();
  const at = (key: string, id: string) => idsOf.set(key, [...(idsOf.get(key) ?? []), id]);
  const leaves = (list: ScopeNode[], parent: string, ids: string[]) => {
    for (const n of list) {
      if (n.type !== 'change') continue;
      const id = changeId(parent, n.key);
      if (!items.has(id)) {
        items.set(id, n);
        ids.push(id);
        at(n.key, id);
      }
      leaves(n.children, parent, ids);
    }
  };
  const walk = (list: ScopeNode[], parent: string) => {
    const ids: string[] = [];
    for (const n of list) {
      if (n.type === 'feature' || n.type === 'product') {
        items.set(n.key, n);
        ids.push(n.key);
        at(n.key, n.key);
        walk(n.children, n.key);
      } else if (n.type === 'unassigned' && n.children.length) {
        items.set(UNASSIGNED, n);
        ids.push(UNASSIGNED);
        at(UNASSIGNED, UNASSIGNED);
        const kids: string[] = [];
        leaves(n.children, UNASSIGNED, kids);
        children.set(UNASSIGNED, kids);
      }
    }
    leaves(list, parent, ids);
    children.set(parent, ids);
  };
  walk(tree, MAP_ROOT);
  return { items, children, idsOf };
}

/** Every feature key in the map, for expand-all. */
export const allFeatureKeys = (tree: ScopeNode[]): string[] =>
  [...productMap(tree).items.entries()].filter(([, n]) => n.type === 'feature' || n.type === 'product').map(([k]) => k);

/** Every name in the tree by key, a feature's or a change's, and the scope's changes' too (a milestone above the
 *  node is among them and not in the tree): what a row or a card calls what it points at. */
export function namesIn(
  tree: readonly ScopeNode[],
  changes: readonly ChangeRow[] = [],
  /** The node stood on and the chain above it, which the tree does not hold. */
  above: readonly { key: string; name?: string; title?: string }[] = [],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of changes) if (c.name ?? c.title) out.set(c.key, c.name ?? c.title!);
  for (const a of above) if (a.name ?? a.title) out.set(a.key, a.name ?? a.title!);
  const walk = (nodes: readonly ScopeNode[]) => {
    for (const n of nodes) {
      const name = n.name ?? n.title ?? n.row?.name ?? n.row?.title;
      if (name) out.set(n.key, name);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The nodes a session is working beneath (decision feature-detail/alive-on-the-map): every ancestor of a live
 *  change, so a folded feature still shows that something is alive inside it. */
export function liveBeneath(tree: readonly ScopeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: readonly ScopeNode[], trail: string[]): void => {
    for (const n of nodes) {
      if (n.type === 'change') {
        if (n.row?.live) for (const k of trail) out.add(k);
        walk(n.children, trail);
      } else walk(n.children, [...trail, n.type === 'unassigned' ? UNASSIGNED : n.key]);
    }
  };
  walk(tree, []);
  return out;
}

/** What a hold or a hover lights (decision hold-lights-the-map): the changes themselves and the path down to each. */
export function litBy(tree: readonly ScopeNode[], changes: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const key of changes) {
    out.add(key);
    for (const k of pathTo(tree, key)) out.add(k);
  }
  return out;
}

/** The chain of ancestors of a key in the map, so the path to a selection can be opened. */
export function pathTo(tree: readonly ScopeNode[], key: string): string[] {
  const path: string[] = [];
  const walk = (list: readonly ScopeNode[], trail: string[]): boolean => {
    for (const n of list) {
      if (n.key === key) {
        path.push(...trail);
        return true;
      }
      // a change's children are drawn beside it, so the path to one stops at the node above both
      if (walk(n.children, n.type === 'change' ? trail : [...trail, n.type === 'unassigned' ? UNASSIGNED : n.key]))
        return true;
    }
    return false;
  };
  walk(tree, []);
  return path;
}

/** What a lens could not place: the closing node. */
export const unassigned = (tree: ScopeNode[]): ScopeNode | undefined => tree.find((n) => n.type === 'unassigned');

/** Change rows that sit directly at the node (the lens placed them here), flattened in order. */
export function changesHere(tree: ScopeNode[]): ChangeRow[] {
  const out: ChangeRow[] = [];
  const walk = (list: ScopeNode[]) => {
    for (const n of list) {
      if (n.type === 'change' && n.row) out.push(n.row);
      if (n.type === 'change') walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Changes beneath the node but filed under a feature below it, grouped by that feature's key. */
export function changesBeneath(scope: Scope): { feature: ScopeNode; rows: ChangeRow[] }[] {
  const here = new Set(changesHere(scope.tree).map((r) => r.key));
  const groups: { feature: ScopeNode; rows: ChangeRow[] }[] = [];
  const walk = (list: ScopeNode[]) => {
    for (const n of list) {
      if (n.type === 'feature') {
        const rows = changesHere(n.children).filter((r) => !here.has(r.key));
        if (rows.length) groups.push({ feature: n, rows });
        walk(n.children);
      }
    }
  };
  walk(scope.tree);
  return groups;
}

// --- the filter ---------------------------------------------------------------------------------------------

export interface MapFilter {
  /** Matched against the name, the title and the key, case-insensitive. */
  q?: string;
  /** Derived states to keep: live, building, planned, retired. Empty keeps all. */
  states?: string[];
  /** A milestone (change key): the lens is narrowed to the work beneath it before the map is drawn. */
  milestone?: string;
  /** Bugs only: the nodes a bug is listed at (its home), with the path to each; the bugs themselves are in the record
   *  pane of the node. The list the rail once had is this filter (decision rail-destinations/three-destinations). */
  bugs?: boolean;
  /** An aspect (its key): the map narrows to the features it has a place at, each a leaf, since a place covers
   *  everything beneath it; the ancestors that lead to them stay, faint (decision aspects-dashboard/aspect-is-a-map-lens). */
  aspect?: string;
}

export const isFiltering = (f: MapFilter): boolean =>
  !!f.q?.trim() || !!f.states?.length || !!f.milestone || !!f.bugs || !!f.aspect;

/** The features an aspect has a place at, each to its place: what the aspect filter keeps. */
export type Places = ReadonlyMap<string, ScopeAspect['places'][number]>;

export function placesAt(aspects: ScopeAspect[], key: string | undefined): Places {
  const a = key ? aspects.find((x) => x.aspect === key) : undefined;
  return new Map((a?.places ?? []).map((p) => [p.feature, p]));
}

/** The aspects as an outline: each under its parent, depth-first, siblings by name. A parent missing from the list
 *  (another product's) leaves its children at the top. */
export function aspectOutline(aspects: ScopeAspect[]): { aspect: ScopeAspect; depth: number }[] {
  const keys = new Set(aspects.map((a) => a.aspect));
  const byParent = new Map<string | undefined, ScopeAspect[]>();
  for (const a of aspects) {
    const p = a.parent && keys.has(a.parent) ? a.parent : undefined;
    byParent.set(p, [...(byParent.get(p) ?? []), a]);
  }
  const out: { aspect: ScopeAspect; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of (byParent.get(parent) ?? []).toSorted((x, y) => nameOf(x).localeCompare(nameOf(y)))) {
      if (seen.has(a.aspect)) continue;
      seen.add(a.aspect);
      out.push({ aspect: a, depth });
      walk(a.aspect, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** What an aspect is called in a chip or a list: its name, else its slug. */
export const nameOf = (a: Pick<ScopeAspect, 'aspect' | 'name'>): string => a.name ?? a.aspect.split('/').pop()!;

export function matches(n: ScopeNode, f: MapFilter, places?: Places): boolean {
  if (n.type === 'change') {
    // a change is kept with its node; the text alone narrows it
    const q = f.q?.trim().toLowerCase();
    return !q || [n.name, n.title, n.key].some((s) => s?.toLowerCase().includes(q));
  }
  if (n.type !== 'feature' && n.type !== 'product') return false;
  if (f.aspect && !places?.has(n.key)) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && ![n.name, n.title, n.key].some((s) => s?.toLowerCase().includes(q))) return false;
  if (f.states?.length && !f.states.includes(n.derived ?? n.status ?? 'planned')) return false;
  if (f.bugs && !(n.bugs?.here ?? 0)) return false;
  return true;
}

// --- bugs on the map ------------------------------------------------------------------------------------------

/** What a row says about the bugs beneath a node: the count, and the tone of the worst (loud when a product or a
 *  feature is broken, a warning for a capability, quiet below). Nothing when there are none. */
export function bugMark(
  n: Pick<ScopeNode, 'bugs'>,
): { count: number; tone: 'loud' | 'warn' | 'quiet'; title: string } | undefined {
  const count = n.bugs?.beneath ?? 0;
  if (!count) return undefined;
  const worst = n.bugs?.worst;
  const tone = worst === 'product' || worst === 'feature' ? 'loud' : worst === 'capability' ? 'warn' : 'quiet';
  return {
    count,
    tone,
    title: `${count} open ${count === 1 ? 'bug' : 'bugs'} beneath${worst ? `, worst ${worst}` : ''}`,
  };
}

/** The tree narrowed to the features that match, with the ancestors that lead to them. Under an aspect only places
 *  match, so what is beneath a place is covered by it and not drawn, except a place beneath it (a fork further down). */
export function filterTree(tree: ScopeNode[], f: MapFilter, places?: Places): ScopeNode[] {
  if (!isFiltering(f)) return tree;
  const q = !!f.q?.trim();
  const walk = (list: ScopeNode[]): ScopeNode[] =>
    list.flatMap((n) => {
      if (n.type !== 'feature' && n.type !== 'product') return [];
      const kids = walk(n.children);
      const here = matches(n, f, places);
      // the changes at a kept node stay with it; a text keeps a change that says it even where the node does not
      const changes = n.children.filter((c) => c.type === 'change' && (here || (q && matches(c, f, places))));
      return here || kids.length || changes.length ? [{ ...n, children: [...kids, ...changes] }] : [];
    });
  return walk(tree);
}

/** Every feature key in a tree: what to expand so the matches are visible. */
export const keysIn = (tree: ScopeNode[]): string[] => allFeatureKeys(tree);

// --- the overview -------------------------------------------------------------------------------------------

/** One word for a node's health: moved inside the window, moved before it, or never. */
export type HealthWord = 'active' | 'stale' | 'not started';

export function healthWord(h: Pick<Health, 'staleDays' | 'days'>): HealthWord {
  if (h.staleDays === null) return 'not started';
  return h.staleDays <= h.days ? 'active' : 'stale';
}

/** Which overview body a node gets: by its level in the template, so siblings always share one experience. The
 *  product (or the store root) is the portfolio; the first level beneath it is the feature; every level under that is
 *  the capability. */
export type Body = 'product' | 'feature' | 'capability';

export function bodyOf(scope: Pick<Scope, 'node' | 'crumbs'>): Body {
  if (!scope.node || scope.node.type !== 'feature') return 'product';
  const above = scope.crumbs.filter((c) => c.key.startsWith('feature:')).length;
  return above === 0 ? 'feature' : 'capability';
}

/** Every change at the node or beneath it, here first, then by feature in tree order; a change naming two features
 *  beneath is listed once. */
export function allWork(scope: Pick<Scope, 'tree'>): ChangeRow[] {
  const seen = new Set<string>();
  return [...changesHere(scope.tree), ...changesBeneath(scope as Scope).flatMap((g) => g.rows)].filter((r) =>
    seen.has(r.key) ? false : (seen.add(r.key), true),
  );
}

/** The features directly beneath the node: a feature's capabilities, a product's features. */
export const featuresBelow = (tree: ScopeNode[]): ScopeNode[] => {
  const direct = tree.filter((n) => n.type === 'feature');
  if (direct.length) return direct;
  // at the store root the tree is products; their children are the top features
  return tree.filter((n) => n.type === 'product').flatMap((p) => p.children.filter((n) => n.type === 'feature'));
};

/** Every feature beneath the node, counted by derived state. */
export function featuresByState(tree: ScopeNode[]): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (list: ScopeNode[]) => {
    for (const n of list) {
      if (n.type === 'feature') {
        const s = n.derived ?? n.status ?? 'planned';
        out[s] = (out[s] ?? 0) + 1;
      }
      if (n.type === 'feature' || n.type === 'product') walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** Features ordered by when they last moved, the most recent first; never moved last. */
export const byMotion = (features: ScopeNode[]): ScopeNode[] =>
  features.toSorted((a, b) => {
    const la = a.health?.last ?? '';
    const lb = b.health?.last ?? '';
    return lb.localeCompare(la) || (a.name ?? a.key).localeCompare(b.name ?? b.key);
  });

/** Milestones in the scope that are not finished, nearest to done first. */
export const inFlight = (changes: ChangeRow[]): ChangeRow[] => {
  const share = (r: ChangeRow) => (r.progress?.total ? r.progress.done / r.progress.total : 0);
  return changes
    .filter((r) => r.progress && r.status !== 'done' && r.status !== 'dropped')
    .toSorted((a, b) => share(b) - share(a) || (a.title ?? '').localeCompare(b.title ?? ''));
};

/** What a change does to this node, when it names it. */
export const effectOn = (row: ChangeRow, key: string | undefined) =>
  key ? row.features.find((f) => f.key === key)?.effect : undefined;
