// The roadmap's checks: pure, over rows the scope already carries. The order is the person's; these say where it
// contradicts what else the store knows (a dependency, a date) and never move anything.
import { SEVERITIES } from '../store/config.js';

export interface RoadmapRow {
  key: string;
  status?: string;
  parent?: string;
  dependsOn: string[];
  target?: string;
  /** The entry's place in the sequence: its own index, else its nearest sequenced ancestor's; undefined is later. */
  position?: number;
}

export type ViolationKind = 'order' | 'target-order' | 'target-dependency' | 'overdue';

export interface Violation {
  kind: ViolationKind;
  /** The entry the warning sits on. */
  change: string;
  /** The entry it contradicts, when there is one. */
  against?: string;
}

const isOpen = (r: RoadmapRow) => r.status !== 'done' && r.status !== 'dropped';

/** A row's target: its own, else the nearest ancestor's. */
export function effectiveTarget(rows: Map<string, RoadmapRow>, key: string): string | undefined {
  const seen = new Set<string>();
  for (let cur = rows.get(key); cur && !seen.has(cur.key); cur = cur.parent ? rows.get(cur.parent) : undefined) {
    seen.add(cur.key);
    if (cur.target) return cur.target;
  }
  return undefined;
}

/** The four checks over the open rows. `today` is yyyy-mm-dd. */
export function violations(list: RoadmapRow[], today: string): Violation[] {
  const rows = new Map(list.map((r) => [r.key, r]));
  const out: Violation[] = [];
  const pos = (k: string) => rows.get(k)?.position ?? Infinity;
  for (const r of list) {
    if (!isOpen(r)) continue;
    for (const d of r.dependsOn) {
      const dep = rows.get(d);
      if (!dep || !isOpen(dep)) continue;
      // a dependant placed before what it depends on; a later dependant is fine, so is one in the same column
      if (pos(r.key) < pos(d)) out.push({ kind: 'order', change: r.key, against: d });
      const mine = effectiveTarget(rows, r.key);
      const theirs = effectiveTarget(rows, d);
      if (mine && theirs && mine < theirs) out.push({ kind: 'target-dependency', change: r.key, against: d });
    }
    if (r.target && r.target < today) out.push({ kind: 'overdue', change: r.key });
  }
  // a milestone later in the sequence with an earlier target than one before it
  const dated = list.filter((r) => isOpen(r) && r.target && r.position !== undefined).sort((a, b) => a.position! - b.position!);
  for (let i = 1; i < dated.length; i++) {
    for (let j = 0; j < i; j++) {
      // same column is not an order; a child of a milestone shares its place
      if (dated[j].position! < dated[i].position! && dated[i].target! < dated[j].target!) {
        out.push({ kind: 'target-order', change: dated[i].key, against: dated[j].key });
        break;
      }
    }
  }
  return out;
}

/** The worse of two severities; undefined counts as mildest. */
export function worstSeverity(a?: string, b?: string): string | undefined {
  const rank = (s?: string) => { const i = (SEVERITIES as readonly string[]).indexOf(s ?? ''); return i < 0 ? SEVERITIES.length : i; };
  return rank(a) <= rank(b) ? a ?? b : b;
}
