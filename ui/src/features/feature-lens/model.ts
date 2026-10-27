// The feature lens's pure derivations over a scope: the product map is features only; changes appear at the leaf.
import type { ChangeRow, Health, Scope, ScopeNode } from '@/data/contract';

export const MAP_ROOT = '__map__';

/** Features and products only, indexed for the tree. */
export function productMap(tree: ScopeNode[]) {
  const items = new Map<string, ScopeNode>();
  const children = new Map<string, string[]>();
  const walk = (list: ScopeNode[], parent: string) => {
    const ids: string[] = [];
    for (const n of list) {
      if (n.type !== 'feature' && n.type !== 'product') continue;
      items.set(n.key, n);
      ids.push(n.key);
      walk(n.children, n.key);
    }
    children.set(parent, ids);
  };
  walk(tree, MAP_ROOT);
  return { items, children };
}

/** Every feature key in the map, for expand-all. */
export const allFeatureKeys = (tree: ScopeNode[]): string[] => [...productMap(tree).items.keys()];

/** The chain of ancestors of a key in the map, so the path to a selection can be opened. */
export function pathTo(tree: ScopeNode[], key: string): string[] {
  const path: string[] = [];
  const walk = (list: ScopeNode[], trail: string[]): boolean => {
    for (const n of list) {
      if (n.key === key) {
        path.push(...trail);
        return true;
      }
      if (walk(n.children, [...trail, n.key])) return true;
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
}

export const isFiltering = (f: MapFilter): boolean => !!f.q?.trim() || !!f.states?.length || !!f.milestone;

export function matches(n: ScopeNode, f: MapFilter): boolean {
  if (n.type !== 'feature' && n.type !== 'product') return false;
  const q = f.q?.trim().toLowerCase();
  if (q && ![n.name, n.title, n.key].some((s) => s?.toLowerCase().includes(q))) return false;
  if (f.states?.length && !f.states.includes(n.derived ?? n.status ?? 'planned')) return false;
  return true;
}

/** The tree narrowed to the features that match, with the ancestors that lead to them. */
export function filterTree(tree: ScopeNode[], f: MapFilter): ScopeNode[] {
  if (!isFiltering(f)) return tree;
  const walk = (list: ScopeNode[]): ScopeNode[] =>
    list.flatMap((n) => {
      if (n.type !== 'feature' && n.type !== 'product') return [];
      const kids = walk(n.children);
      return matches(n, f) || kids.length ? [{ ...n, children: kids }] : [];
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

/** Every change at the node or beneath it, here first, then by feature in tree order. */
export function allWork(scope: Pick<Scope, 'tree'>): ChangeRow[] {
  return [...changesHere(scope.tree), ...changesBeneath(scope as Scope).flatMap((g) => g.rows)];
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
export const goals = (changes: ChangeRow[]): ChangeRow[] => {
  const share = (r: ChangeRow) => (r.progress?.total ? r.progress.done / r.progress.total : 0);
  return changes
    .filter((r) => r.progress && r.status !== 'done' && r.status !== 'dropped')
    .toSorted((a, b) => share(b) - share(a) || (a.title ?? '').localeCompare(b.title ?? ''));
};

/** What a change does to this node, when it names it. */
export const effectOn = (row: ChangeRow, key: string | undefined) =>
  key ? row.features.find((f) => f.key === key)?.effect : undefined;
