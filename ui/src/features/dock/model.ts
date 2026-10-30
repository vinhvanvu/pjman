// The dock before a session binds a change is a pickup list (decision fresh-dock-readiness): the product's open changes
// by the feature each names, the groups in the roadmap's order, and within a group the change nearest to being fully
// decided first, so what is closest to executable sits at the top; a change stacked on unfinished work sits below the
// rest (decision dependency-edges-visible/stacked). Pure: the scope in, groups out.
import type { ChangeRow, Scope, ScopeNode, StoreEvent, WaitingDecision } from '@/data/contract';
import { changeOfDecision, short } from '@/lib/keys';

export interface Pickup {
  row: ChangeRow;
  /** The proposed decisions on it, as people name them (the slug). */
  proposed: string[];
  /** The unfinished changes it depends on, in its own order; empty when nothing stacks it. */
  stackedOn: ChangeRow[];
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
  const byKey = new Map(scope.changes.map((r) => [r.key, r]));
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
    // a dependency outside the scope can't be read, so it doesn't stack
    const stackedOn = row.dependsOn.map((k) => byKey.get(k)).filter((d): d is ChangeRow => !!d && OPEN(d));
    g.changes.push({ row, proposed: (proposedOn.get(row.key) ?? []).map((d) => slug(d.key)), stackedOn });
  }
  for (const g of groups.values()) {
    g.changes = g.changes.toSorted(
      (a, b) =>
        Number(a.stackedOn.length > 0) - Number(b.stackedOn.length > 0) ||
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
  /** 'stacked' while a dependency is unfinished; else 'ready' when nothing is proposed, 'n of m decided' while something
   *  is, 'no decisions' when none were opened. */
  text: string;
  state: 'stacked' | 'ready' | 'deciding' | 'undecided';
}

export function readiness(row: Pick<ChangeRow, 'waiting' | 'decided'>, stacked = false): Readiness {
  if (stacked) return { text: 'stacked', state: 'stacked' };
  const total = row.waiting + row.decided;
  if (total === 0) return { text: 'no decisions', state: 'undecided' };
  if (row.waiting === 0) return { text: 'ready', state: 'ready' };
  return { text: `${row.decided} of ${total} decided`, state: 'deciding' };
}

/** What the live stream just changed on the dock (change:motion-design), the newest arrival on each part it draws: a
 *  line the session wrote, the change's status, a decision opened on it; `any` is the newest of them all,
 *  which flashes the following pill. Each washes once, in that event's colour. */
export interface DockArrivals {
  line?: StoreEvent;
  status?: StoreEvent;
  opened: ReadonlyMap<string, StoreEvent>;
  any?: StoreEvent;
}

export function dockArrivals(events: readonly StoreEvent[], session: string, change?: string): DockArrivals {
  const opened = new Map<string, StoreEvent>();
  const out: DockArrivals = { opened };
  for (const e of events) {
    const onChange = !!change && (e.key === change || changeOfDecision(e.key) === change);
    if (e.session !== session && e.key !== session && !onChange) continue;
    out.any = e;
    if (e.key === session && e.op === 'log') out.line = e;
    if (change && e.key === change && e.fields?.includes('status')) out.status = e;
    if (onChange && e.type === 'decision' && e.op === 'created') opened.set(e.key, e);
  }
  return out;
}
