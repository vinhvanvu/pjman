// The feature lens's pure derivations over a scope: the product map is features only; changes appear at the leaf.
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';

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
}

export const isFiltering = (f: MapFilter): boolean => !!f.q?.trim() || !!f.states?.length;

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
