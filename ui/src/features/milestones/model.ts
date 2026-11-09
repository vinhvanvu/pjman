// The milestone's model (change:milestone-detail; decisions children-in-order, milestone-leads-the-dock,
// milestones-on-the-rail): what the milestone page, the dock framed by a milestone and the Milestones index read, as
// pure derivations. A milestone's children are its plan: in the milestone's order, the done folded under one line at
// the top, the child in work opened, the next one marked. The milestone bar is the change bar read over everything
// beneath: children done, who is on it beneath now, what waits and what is blocked beneath, last touched, target. The
// index is the milestones in flight nearest to done first, each with the same figures, the done folded.
import type { ChangeContext, ChangeRow, LiveSession, WaitingDecision } from '@/data/contract';
import type { Segment } from '@/features/change/model';
import { waitsLine } from '@/features/change/model';
import { agoWords, plural } from '@/lib/format';
import { short } from '@/lib/keys';

type Child = ChangeContext['children'][number];

/** A child as the children list draws it: the record's row and what the product's rows know of it. */
export interface ChildView {
  key: string;
  name: string;
  status: string;
  /** Done or dropped: behind the work, folded. */
  behind: boolean;
  /** A session is on it now. */
  live: boolean;
  /** Decisions waiting on the person on it. */
  waits: number;
  blockedOn?: string;
  /** The child is itself a milestone: its children done over its children. */
  milestone?: { done: number; total: number };
  /** The plan's progress and the step the work stands on, as the product's rows carry them. */
  plan?: { done: number; total: number };
  step?: ChangeRow['step'];
  moved?: string;
  position?: number;
  created?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const BEHIND = new Set(['done', 'dropped']);

/** The children in the milestone's order: the roadmap's position first, then creation; each read with the product's
 *  row for it when there is one, the sessions on it and the decisions waiting on it. */
export function childrenInOrder(
  children: readonly Child[],
  rows: ReadonlyMap<string, ChangeRow>,
  sessions: readonly Pick<LiveSession, 'on'>[] = [],
  waiting: readonly Pick<WaitingDecision, 'change'>[] = [],
): ChildView[] {
  const on = new Set(sessions.map((s) => s.on).filter(Boolean));
  return children
    .map((c): ChildView => {
      const r = rows.get(c.key);
      const status = c.status ?? r?.status ?? 'open';
      return {
        key: c.key,
        name: c.name ?? r?.name ?? c.gist ?? r?.gist ?? short(c.key),
        status,
        behind: BEHIND.has(status),
        live: on.has(c.key) || !!r?.live,
        waits: waiting.filter((d) => d.change === c.key).length || (r?.waiting ?? 0),
        blockedOn: r?.blockedOn ?? str(c.data?.['blocked-on']),
        milestone: r?.kind === 'milestone' ? r.progress : undefined,
        plan: r?.plan,
        step: r?.step,
        moved: r?.moved,
        position: r?.position,
        created: c.created ?? r?.created,
      };
    })
    .toSorted(
      (a, b) =>
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        (a.created ?? '').localeCompare(b.created ?? '') ||
        a.key.localeCompare(b.key),
    );
}

/** The fold (decision children-in-order): what is behind the work, the done and the dropped, folds under one line at
 *  the top; the rest are shown in order. The next child is the first not behind after the open one, wrapping to the
 *  first when nothing follows; with no open child, the first not behind. */
export function childrenFold(
  list: readonly ChildView[],
  open?: string,
  now = Date.now(),
): { behind: ChildView[]; shown: ChildView[]; sum?: string; next?: string } {
  const behind = list.filter((c) => c.behind);
  const shown = list.filter((c) => !c.behind);
  const done = behind.filter((c) => c.status === 'done');
  const dropped = behind.length - done.length;
  const last = done.toSorted((a, b) => (b.moved ?? '').localeCompare(a.moved ?? ''))[0];
  const sum = behind.length
    ? [
        done.length ? `${done.length} done` : '',
        dropped ? `${dropped} dropped` : '',
        last ? `last ${last.name}${last.moved ? `, ${agoWords(last.moved, now)}` : ''}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;
  const at = open ? shown.findIndex((c) => c.key === open) : -1;
  const after = at >= 0 ? [...shown.slice(at + 1), ...shown.slice(0, at)] : shown;
  const next = after.find((c) => c.key !== open)?.key;
  return { behind, shown, sum, next };
}

/** The head's line: "6 of 12 done · the one in work open · next: Public". */
export function childrenHead(list: readonly ChildView[], open?: string, next?: string): string {
  const counted = list.filter((c) => c.status !== 'dropped');
  const done = counted.filter((c) => c.status === 'done').length;
  const nextName = next ? list.find((c) => c.key === next)?.name : undefined;
  return [
    `${done} of ${counted.length} done`,
    open ? 'the one in work open' : '',
    nextName ? `next: ${nextName}` : counted.length === done && counted.length ? 'every child done' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A segment a child, in order: done, the one in work in the lane's colour, blocked, review, open. */
export const childSegments = (list: readonly ChildView[], open?: string): string[] =>
  list.map((c) => (c.key === open && !c.behind ? 'on' : c.status));

/** The open child's steps bar, from the row's progress and the step the work stands on: the done segments, then the one
 *  on when the step is active, then the rest open (change:step-bar-in-order: by count alone, since the step's number
 *  counts dropped steps while the bar does not); nothing without a plan. */
export function stepSegments(c: Pick<ChildView, 'plan' | 'step'>): Segment[] {
  if (!c.plan?.total) return [];
  const { done, total } = c.plan;
  const on = c.step?.state === 'active' && done < total ? 1 : 0;
  return [
    ...Array<Segment>(Math.min(done, total)).fill('done'),
    ...Array<Segment>(on).fill('on'),
    ...Array<Segment>(Math.max(0, total - done - on)).fill('open'),
  ];
}

/** The keys beneath a change among the product's rows: its children, their children, all the way down. */
export function beneathOf(key: string, rows: Iterable<Pick<ChangeRow, 'key' | 'parent'>>): Set<string> {
  const kids = new Map<string, string[]>();
  for (const r of rows) if (r.parent) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r.key]);
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const c of kids.get(k) ?? [])
      if (!out.has(c)) {
        out.add(c);
        walk(c);
      }
  };
  walk(key);
  return out;
}

/** The figures a milestone is read by, over everything beneath it: children done, sessions on it beneath now,
 *  decisions waiting beneath, children blocked, last touched beneath, the target. */
export interface MilestoneFigures {
  progress: { done: number; total: number };
  live: number;
  waits: number;
  blocked: number;
  moved?: string;
  target?: string;
}

export function figuresOf(
  key: string,
  rows: ReadonlyMap<string, ChangeRow>,
  sessions: readonly Pick<LiveSession, 'on'>[],
  waiting: readonly Pick<WaitingDecision, 'change'>[],
): MilestoneFigures {
  const beneath = beneathOf(key, rows.values());
  const own = rows.get(key);
  const children = [...beneath].map((k) => rows.get(k)).filter((r): r is ChangeRow => !!r && r.parent === key);
  const counted = children.filter((r) => r.status !== 'dropped');
  const under = (k: string | undefined) => !!k && (k === key || beneath.has(k));
  const moved = [own?.moved, ...[...beneath].map((k) => rows.get(k)?.moved)]
    .filter((t): t is string => !!t)
    .toSorted()
    .at(-1);
  return {
    progress: own?.progress ?? { done: counted.filter((r) => r.status === 'done').length, total: counted.length },
    live: sessions.filter((s) => under(s.on)).length,
    waits: waiting.filter((d) => under(d.change)).length,
    blocked: children.filter((r) => r.status === 'blocked').length,
    moved,
    target: own?.target,
  };
}

/** The milestone bar's parts, in order (decision milestone-body): who is on it beneath now; what is blocked beneath;
 *  when it was last touched; the target; then what waits, the last part, in the waits colour when something does. */
export function milestoneBar(
  f: MilestoneFigures,
  now = Date.now(),
): { parts: string[]; live: boolean; waits: string; alarm: boolean } {
  const parts: string[] = [];
  parts.push(
    f.live === 0
      ? 'nobody on it now'
      : f.live === 1
        ? '1 session on it beneath now'
        : `${f.live} sessions on it beneath now`,
  );
  if (f.blocked) parts.push(`${f.blocked} blocked beneath`);
  if (f.moved) parts.push(`last touched ${agoWords(f.moved, now)}`);
  if (f.target) parts.push(`target ${f.target}`);
  return { parts, live: f.live > 0, waits: waitsLine(f.waits), alarm: f.waits > 0 };
}

/** The frame a session works inside (decision milestone-leads-the-dock): the last change it bound that is a milestone
 *  and is the shown change or stands above it. */
export function frameOf(
  binds: readonly string[],
  shown: string | undefined,
  rows: ReadonlyMap<string, Pick<ChangeRow, 'key' | 'parent' | 'kind'>>,
): string | undefined {
  if (!shown) return undefined;
  for (const b of binds.toReversed()) {
    const r = rows.get(b);
    if (r?.kind !== 'milestone') continue;
    if (b === shown) return b;
    for (let k: string | undefined = rows.get(shown)?.parent; k; k = rows.get(k)?.parent) if (k === b) return b;
  }
  return undefined;
}

/** One milestone as the index lists it. */
export interface MilestoneIndexRow extends MilestoneFigures {
  key: string;
  name: string;
  gist?: string;
  status: string;
  /** Under another milestone. */
  parent?: string;
  /** The child in work (a session on it), else the first child not done. */
  next?: { key: string; name: string; live: boolean };
}

const share = (p: { done: number; total: number }) => (p.total ? p.done / p.total : 0);

/** The index (decision milestones-on-the-rail): every milestone in the product, the ones in flight nearest to done
 *  first, then by last touch; the done ones apart, latest first. Read from the roadmap's scope with the done shown. */
export function milestonesIndex(scope: {
  changes: readonly ChangeRow[];
  sessions: readonly Pick<LiveSession, 'on'>[];
  waitingOn: readonly Pick<WaitingDecision, 'change'>[];
}): {
  inFlight: MilestoneIndexRow[];
  done: MilestoneIndexRow[];
} {
  const rows = new Map(scope.changes.map((r) => [r.key, r]));
  const on = new Set(scope.sessions.map((s) => s.on));
  const list = scope.changes
    .filter((r) => r.kind === 'milestone' && r.status !== 'dropped')
    .map((r): MilestoneIndexRow => {
      const kids = scope.changes
        .filter((c) => c.parent === r.key && c.status !== 'dropped')
        .toSorted(
          (a, b) =>
            (a.position ?? Infinity) - (b.position ?? Infinity) || (a.created ?? '').localeCompare(b.created ?? ''),
        );
      const inWork = kids.find((c) => c.status !== 'done' && (on.has(c.key) || c.live));
      const first = inWork ?? kids.find((c) => c.status !== 'done');
      return {
        key: r.key,
        name: r.name ?? r.gist ?? short(r.key),
        gist: r.gist,
        status: r.status ?? 'open',
        parent: r.parent,
        ...figuresOf(r.key, rows, scope.sessions, scope.waitingOn),
        next: first
          ? { key: first.key, name: first.name ?? first.gist ?? short(first.key), live: first === inWork }
          : undefined,
      };
    });
  const byMoved = (a: MilestoneIndexRow, b: MilestoneIndexRow) => (b.moved ?? '').localeCompare(a.moved ?? '');
  return {
    inFlight: list
      .filter((m) => m.status !== 'done')
      .toSorted((a, b) => share(b.progress) - share(a.progress) || byMoved(a, b) || a.name.localeCompare(b.name)),
    done: list.filter((m) => m.status === 'done').toSorted(byMoved),
  };
}

/** The index's one figures line: "6 of 12 done · 2 sessions on it now · target …", then what waits and what is
 *  blocked, each in its own colour. */
export function indexLine(m: MilestoneIndexRow): { parts: string[]; waits?: string; blocked?: string } {
  const parts = [`${m.progress.done} of ${m.progress.total} done`];
  if (m.live) parts.push(`${plural(m.live, 'session')} on it now`);
  if (m.target) parts.push(`target ${m.target}`);
  return {
    parts,
    waits: m.waits ? waitsLine(m.waits) : undefined,
    blocked: m.blocked ? `${m.blocked} blocked` : undefined,
  };
}
