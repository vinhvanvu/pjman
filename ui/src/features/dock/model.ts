// The dock before a session binds a change is a pickup list (decision fresh-dock-readiness): the product's open changes
// by the feature each names, the groups in the roadmap's order, and within a group the change nearest to being fully
// decided first, so what is closest to executable sits at the top. Pure: the scope in, groups out.
import type { ChangeRow, Scope, ScopeNode, WaitingDecision } from '@/data/contract';
import { short } from '@/lib/keys';

export interface Pickup {
  row: ChangeRow;
  /** The proposed decisions on it, as people name them (the slug). */
  proposed: string[];
}

export interface PickupGroup {
  /** The feature the changes name; null for the group of changes naming none. */
  key: string | null;
  name: string;
  changes: Pickup[];
}

export type PickupScope = Pick<Scope, 'changes' | 'tree' | 'waitingOn'>;

const OPEN = (r: ChangeRow) => r.status !== 'done' && r.status !== 'dropped';
const at = (r: ChangeRow) => r.position ?? Infinity;
const slug = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** The features as the map lists them, in its order, with the short name the tree shows. */
function mapOrder(tree: ScopeNode[]): Map<string, { index: number; name: string }> {
  const out = new Map<string, { index: number; name: string }>();
  const walk = (nodes: ScopeNode[]) => {
    for (const n of nodes) {
      if (n.type === 'feature' && !out.has(n.key))
        out.set(n.key, { index: out.size, name: n.name ?? n.title ?? short(n.key) });
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function pickups(scope: PickupScope): PickupGroup[] {
  const features = mapOrder(scope.tree);
  const proposedOn = new Map<string, WaitingDecision[]>();
  for (const d of scope.waitingOn) proposedOn.set(d.change, [...(proposedOn.get(d.change) ?? []), d]);
  const groups = new Map<string | null, PickupGroup>();
  for (const row of scope.changes.filter(OPEN)) {
    const f = row.features[0];
    const key = f?.key ?? null;
    let g = groups.get(key);
    if (!g) {
      const named = key ? features.get(key) : undefined;
      g = { key, name: key ? (named?.name ?? f?.title ?? short(key)) : 'no feature', changes: [] };
      groups.set(key, g);
    }
    g.changes.push({ row, proposed: (proposedOn.get(row.key) ?? []).map((d) => slug(d.key)) });
  }
  for (const g of groups.values()) {
    g.changes = g.changes.toSorted(
      (a, b) =>
        a.row.waiting - b.row.waiting ||
        at(a.row) - at(b.row) ||
        (a.row.title ?? a.row.key).localeCompare(b.row.title ?? b.row.key),
    );
  }
  const first = (g: PickupGroup) => Math.min(...g.changes.map((p) => at(p.row)));
  const onMap = (g: PickupGroup) => (g.key ? (features.get(g.key)?.index ?? Infinity) : Infinity);
  return [...groups.values()].toSorted(
    (a, b) =>
      Number(a.key === null) - Number(b.key === null) ||
      first(a) - first(b) ||
      onMap(a) - onMap(b) ||
      a.name.localeCompare(b.name),
  );
}

export interface Readiness {
  /** 'ready' when nothing is proposed, 'n of m decided' while something is, 'no decisions' when none were opened. */
  text: string;
  state: 'ready' | 'deciding' | 'undecided';
}

export function readiness(row: Pick<ChangeRow, 'waiting' | 'decided'>): Readiness {
  const total = row.waiting + row.decided;
  if (total === 0) return { text: 'no decisions', state: 'undecided' };
  if (row.waiting === 0) return { text: 'ready', state: 'ready' };
  return { text: `${row.decided} of ${total} decided`, state: 'deciding' };
}
