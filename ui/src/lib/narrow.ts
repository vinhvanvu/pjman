// Narrowing a scope to the work beneath one milestone: the changes under it (transitively), the tree pruned to the
// features those changes touch with their ancestors kept and their counts recomputed, the waiting decisions on those
// changes. Health is left as the node's: the filter changes what is shown, never the roll-up.
import type { ChangeRow, Scope, ScopeNode } from '@/data/contract';
import { IN_FLIGHT } from '@/data/contract';

/** Every change beneath the milestone, transitively, by the parent links among the scope's changes. */
export function beneathMilestone(changes: ChangeRow[], milestone: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const r of changes) if (r.parent) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r.key]);
  const out = new Set<string>();
  const walk = (key: string) => {
    for (const k of kids.get(key) ?? []) {
      if (out.has(k)) continue;
      out.add(k);
      walk(k);
    }
  };
  walk(milestone);
  return out;
}

const isOpen = (r: ChangeRow) => r.status !== 'done' && r.status !== 'dropped';

/** The tree with only the change nodes in `keep`, the structure nodes that lead to them, and counts over what is kept. */
export function pruneTree(tree: ScopeNode[], keep: Set<string>): ScopeNode[] {
  const walk = (list: ScopeNode[]): ScopeNode[] =>
    list.flatMap((n) => {
      const children = walk(n.children);
      if (n.type === 'change') return keep.has(n.key) ? [{ ...n, children }] : [];
      if (children.length === 0) return [];
      const rows = rowsIn(children);
      const open = rows.filter(isOpen);
      return [
        {
          ...n,
          children,
          open: open.length,
          inFlight: open.filter((r) => (IN_FLIGHT as readonly string[]).includes(r.status ?? '')).length,
          childCount: children.filter((c) => c.type === 'feature').length,
        },
      ];
    });
  return walk(tree);
}

const rowsIn = (list: ScopeNode[]): ChangeRow[] =>
  list.flatMap((n) => [...(n.row ? [n.row] : []), ...rowsIn(n.children)]);

export function narrowToMilestone(scope: Scope, milestone: string): Scope {
  const keep = beneathMilestone(scope.changes, milestone);
  return {
    ...scope,
    changes: scope.changes.filter((r) => keep.has(r.key)),
    tree: pruneTree(scope.tree, keep),
    waitingOn: scope.waitingOn.filter((d) => keep.has(d.change)),
  };
}
