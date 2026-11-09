// The roadmap's pure derivations: lanes (the features of the map, flattened by the expansion), where each change sits
// (its first feature's lane, or the nearest open ancestor's, or the foundations), the columns of the future (the
// sequence, then later), the past's span and ticks, and which rows draw as bars. Nothing here knows pixels except the
// scale it is handed.
import type { ChangeRow, Scope, ScopeAspect, ScopeNode, Violation } from '@/data/contract';
import { aspectOf, short } from '@/lib/keys';

/** The aspects an entry works on, by name, for its diamond (change:aspect-work-on-the-roadmap): each aspect it names,
 *  and the aspect of each place it names, once. */
export function aspectNames(row: ChangeRow, aspects: ScopeAspect[]): string[] {
  const keys = [...new Set(row.aspects.map((k) => aspectOf(k)).filter((k): k is string => !!k))];
  return keys.map((k) => {
    const a = aspects.find((x) => x.aspect === k);
    return a ? (a.name ?? a.title) : short(k);
  });
}

export const FOUNDATIONS = '__foundations__';
export const LATER = '__later__';
const DAY = 86_400_000;

export interface Lane {
  key: string;
  label: string;
  level?: string;
  depth: number;
  state?: string;
  parent?: string;
  /** Lanes beneath it, shown or not. */
  children: number;
  expanded: boolean;
  bugs?: ScopeNode['bugs'];
}

/** Every feature of the map as a lane, depth first; a collapsed feature's descendants are left out. The foundations
 *  lane closes the list when any change names nothing. */
export function lanes(tree: ScopeNode[], expanded: Set<string>, withFoundations: boolean): Lane[] {
  const out: Lane[] = [];
  const walk = (list: ScopeNode[], depth: number, parent?: string) => {
    for (const n of list) {
      if (n.type !== 'feature') continue;
      const kids = n.children.filter((c) => c.type === 'feature');
      const open = expanded.has(n.key);
      out.push({
        key: n.key,
        label: n.name ?? n.title ?? n.key,
        level: n.level,
        depth,
        state: n.derived ?? n.status,
        parent,
        children: kids.length,
        expanded: open,
        bugs: n.bugs,
      });
      if (open) walk(kids, depth + 1, n.key);
    }
  };
  // the product node at the root holds the features; a feature scope holds them directly
  const top = tree.length === 1 && tree[0]?.type === 'product' ? tree[0].children : tree;
  walk(top, 0);
  if (withFoundations) out.push({ key: FOUNDATIONS, label: 'Foundations', depth: 0, children: 0, expanded: false });
  return out;
}

/** feature key → its parent feature key, from the whole tree (expanded or not). */
export function featureParents(tree: ScopeNode[]): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  const walk = (list: ScopeNode[], parent?: string) => {
    for (const n of list) {
      if (n.type === 'feature') {
        m.set(n.key, parent);
        walk(n.children, n.key);
      } else if (n.type === 'product') walk(n.children, undefined);
    }
  };
  walk(tree);
  return m;
}

/** The lane a change sits in: its first feature's, else the nearest shown ancestor's, else the foundations. */
export function laneOf(row: ChangeRow, shown: Set<string>, parents: Map<string, string | undefined>): string {
  let cur = row.features[0]?.key;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (shown.has(cur)) return cur;
    seen.add(cur);
    cur = parents.get(cur);
  }
  return FOUNDATIONS;
}

/** One unit of Later (change:later-shows-milestones): a loose change with no loose parent, and the loose changes
 *  beneath it, however deep. A milestone is found and ordered as one; a loose leaf has no children. */
export interface LaterGroup {
  row: ChangeRow;
  children: ChangeRow[];
}

export interface Column {
  kind: 'milestone' | 'single' | 'later';
  key: string;
  row?: ChangeRow;
  title: string;
  progress?: { done: number; total: number };
  target?: string;
  /** The open entries drawn in this column, in creation order; later lists each group's row before its children. */
  entries: ChangeRow[];
  /** Later only: its units, each a loose change with the loose changes beneath it. */
  groups?: LaterGroup[];
  violations: Violation[];
}

const isOpen = (r: ChangeRow) => r.status !== 'done' && r.status !== 'dropped';
const isWork = (r: ChangeRow) => isOpen(r) && r.kind !== 'bug';

/** The future: one column per entry of the sequence in scope, a milestone holding its open descendants, a loose
 *  change holding itself; then later, everything open and unsequenced as units: a loose change with no loose parent,
 *  its loose descendants nested beneath it, so an unordered milestone is listed by name and ordered as one. */
export function columns(scope: Scope): Column[] {
  const rows = scope.changes;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const violationsOn = (key: string) => scope.roadmap.violations.filter((v) => v.change === key);
  const out: Column[] = scope.roadmap.sequence.map((key, i) => {
    const row = byKey.get(key);
    const beneath = rows.filter((r) => r.key !== key && r.position === i && isWork(r));
    const milestone = (row?.children ?? 0) > 0 || beneath.length > 0;
    return {
      kind: milestone ? 'milestone' : 'single',
      key,
      row,
      title: row?.gist ?? short(key),
      progress: row?.progress,
      target: row?.target,
      entries: milestone ? beneath : row && isWork(row) ? [row] : [],
      violations: violationsOn(key),
    };
  });
  const groups = laterGroups(rows);
  if (groups.length || out.length === 0) {
    out.push({
      kind: 'later',
      key: LATER,
      title: 'Later',
      entries: groups.flatMap((g) => [g.row, ...g.children]),
      groups,
      violations: [],
    });
  }
  return out;
}

/** Later's units: every open, unsequenced change that has no open unsequenced parent, each with the open unsequenced
 *  changes beneath it (its nearest loose ancestor is the unit), in creation order. */
export function laterGroups(rows: ChangeRow[]): LaterGroup[] {
  const loose = rows.filter((r) => r.position === undefined && isWork(r));
  const looseByKey = new Map(loose.map((r) => [r.key, r]));
  const unitOf = (r: ChangeRow): ChangeRow => {
    let cur = r;
    const seen = new Set<string>();
    while (cur.parent && looseByKey.has(cur.parent) && !seen.has(cur.key)) {
      seen.add(cur.key);
      cur = looseByKey.get(cur.parent)!;
    }
    return cur;
  };
  const groups = loose.filter((r) => unitOf(r) === r).map((row) => ({ row, children: [] as ChangeRow[] }));
  const byRow = new Map(groups.map((g) => [g.row.key, g]));
  for (const r of loose) {
    const unit = unitOf(r);
    if (unit !== r) byRow.get(unit.key)?.children.push(r);
  }
  return groups;
}

/** The past's span: from the earliest beginning or finish on show, no earlier than `maxDays` ago, no shorter than
 *  `minDays`; to now. */
export function pastSpan(rows: ChangeRow[], now: number, minDays = 14, maxDays = 120): { from: number; to: number } {
  let from = now - minDays * DAY;
  for (const r of rows) {
    for (const t of [r.began, r.finished]) {
      if (!t) continue;
      const ms = Date.parse(t);
      if (Number.isFinite(ms) && ms < from) from = ms;
    }
  }
  return { from: Math.max(from, now - maxDays * DAY), to: now };
}

/** Weekly ticks across the span, each on a Monday, labelled by month and day; a month boundary shows the month. */
export function ticks(from: number, to: number): { t: number; label: string; month: boolean }[] {
  const out: { t: number; label: string; month: boolean }[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  // forward to the next Monday
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  let lastMonth = -1;
  while (d.getTime() < to) {
    const month = d.getMonth() !== lastMonth;
    lastMonth = d.getMonth();
    out.push({
      t: d.getTime(),
      label: month ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : String(d.getDate()),
      month,
    });
    d.setDate(d.getDate() + 7);
  }
  return out;
}

export interface Bar {
  row: ChangeRow;
  /** Instants; `to` is now for work still in flight. */
  from: number;
  to: number;
  done: boolean;
}

/** The rows that draw in the past: anything that began (in flight reaches now) or finished. A bug does too: a fix
 *  had a duration. */
export function bars(rows: ChangeRow[], now: number): Bar[] {
  const out: Bar[] = [];
  for (const r of rows) {
    if (r.status === 'dropped') continue;
    const began = r.began ? Date.parse(r.began) : undefined;
    const finished = r.finished ? Date.parse(r.finished) : undefined;
    if (r.status === 'done') {
      if (finished === undefined) continue;
      out.push({ row: r, from: Math.min(began ?? finished, finished), to: finished, done: true });
    } else if (began !== undefined) {
      out.push({ row: r, from: began, to: now, done: false });
    }
  }
  return out;
}

/** A mark as the chart drew it: its left and right ends and its middle, in the chart's own pixels. */
export interface Mark {
  x1: number;
  x2: number;
  y: number;
}

/** Where a change is drawn: its bar in the past, its entry after now, or both while in flight. */
export interface MarksOf {
  past?: Mark;
  next?: Mark;
}

export interface EdgeShape {
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** The direction the edge arrives in, in radians, for its head. */
  angle: number;
  /** The record contradicts itself in time: the dependent finished before what it needs. */
  late: boolean;
}

type Point = { x: number; y: number };

const line = (s: Point, e: Point, late = false): EdgeShape => ({
  d: `M ${s.x} ${s.y} L ${e.x} ${e.y}`,
  start: s,
  end: e,
  angle: Math.atan2(e.y - s.y, e.x - s.x),
  late,
});
const curve = (s: Point, e: Point, lead = ''): EdgeShape => {
  const forward = s.x <= e.x;
  const dx = Math.max(40, Math.abs(e.x - s.x) / 2) * (forward ? 1 : -1);
  return {
    d: `M ${s.x} ${s.y} ${lead}C ${s.x + dx} ${s.y}, ${e.x - dx} ${e.y}, ${e.x} ${e.y}`,
    start: s,
    end: e,
    angle: forward ? 0 : Math.PI,
    late: false,
  };
};

/** One dependency edge (decision dependency-edges-visible/edge-shapes). The past is time, so an edge between bars is a
 *  straight line leaving the end of the dependency's bar: to the dependent's start when it began after, onto its bar at
 *  the moment the dependency finished when they overlapped, back to its end only when it finished first (late). An edge
 *  into an entry after now runs straight to the now line, then curves; between entries it curves as the order runs.
 *  `seam` is the now line's x; `half` the bar's half-height, so a vertical edge lands on the bar's edge; `day` a day's width,
 *  within which a dependent finishing first is the same moment, not late. */
export function edgeShape(from: MarksOf, to: MarksOf, seam: number, half: number, day = 0): EdgeShape | undefined {
  const a = from.next ?? from.past;
  if (!a) return undefined;
  if (to.next) {
    if (from.next) {
      const forward = from.next.x2 <= to.next.x1;
      return curve(
        { x: forward ? from.next.x2 : from.next.x1, y: from.next.y },
        { x: forward ? to.next.x1 : to.next.x2, y: to.next.y },
      );
    }
    const s = { x: from.past!.x2, y: from.past!.y };
    const bend = { x: Math.max(seam, s.x), y: s.y };
    const shape = curve(bend, { x: to.next.x1, y: to.next.y });
    return { ...shape, d: `M ${s.x} ${s.y} L ${bend.x} ${bend.y} ${shape.d.slice(shape.d.indexOf('C'))}`, start: s };
  }
  const b = to.past;
  if (!b) return undefined;
  // a dependency not yet begun, needed by work already in the past: as late as it gets
  if (!from.past) return line({ x: a.x1, y: a.y }, { x: b.x2, y: b.y }, true);
  const s = { x: from.past.x2, y: from.past.y };
  if (b.x1 >= s.x) return line(s, { x: b.x1, y: b.y });
  if (b.x2 >= s.x - day) return line(s, { x: Math.min(s.x, b.x2), y: b.y + (s.y < b.y ? -half : half) });
  return line(s, { x: b.x2, y: b.y }, true);
}

/** Where a violation's warning reads from, one line. */
export function violationText(v: Violation, titles: Map<string, string | undefined>): string {
  const name = (k?: string) => (k ? (titles.get(k) ?? short(k)) : '');
  switch (v.kind) {
    case 'order':
      return `placed before ${name(v.against)}, which it depends on`;
    case 'target-order':
      return `targeted earlier than ${name(v.against)}, which comes before it`;
    case 'target-dependency':
      return `targeted earlier than ${name(v.against)}, which it depends on`;
    case 'overdue':
      return 'its target has passed';
    default:
      return '';
  }
}

/** Bugs by severity, worst first, each group labelled by what is lost. */
export const SEVERITY_LABEL: Record<string, string> = {
  product: 'Product out',
  feature: 'Feature out',
  capability: 'Capability out',
  nuisance: 'Nuisance',
  cosmetic: 'Cosmetic',
};
export const SEVERITIES = ['product', 'feature', 'capability', 'nuisance', 'cosmetic'] as const;

export function bySeverity(bugs: ChangeRow[]): { severity: string; label: string; rows: ChangeRow[] }[] {
  const groups = [...SEVERITIES, 'unset'].map((s) => ({
    severity: s,
    label: SEVERITY_LABEL[s] ?? 'No severity yet',
    rows: bugs.filter((b) => (b.severity ?? 'unset') === s),
  }));
  return groups.filter((g) => g.rows.length > 0);
}

/** The worst severity among bugs, or undefined. */
export const worstOf = (bugs: ChangeRow[]): string | undefined => bugs[0]?.severity;

/** Loud only when a product or a feature is out. */
export const loud = (bugs: ChangeRow[]): number =>
  bugs.filter((b) => b.severity === 'product' || b.severity === 'feature').length;
