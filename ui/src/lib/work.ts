// The work as a person approaches it: changes grouped by intent (what waits on a person first), each carrying its asks.
// Pure over the scope's rows and waiting decisions; every lens and the inbox read the same grouping.
import type { ChangeRow, WaitingDecision } from '@/data/contract';

export type Intent = 'waiting' | 'progress' | 'upcoming' | 'done';

export const INTENTS: readonly { id: Intent; label: string; statuses: readonly string[] }[] = [
  { id: 'waiting', label: 'Waiting on you', statuses: ['review', 'blocked'] },
  { id: 'progress', label: 'In progress', statuses: ['active', 'planning'] },
  { id: 'upcoming', label: 'Coming up', statuses: ['open'] },
  { id: 'done', label: 'Done', statuses: ['done', 'dropped'] },
];

/** Does the change need a person: a decision proposed on it, or a status only a person moves. */
export const needsPerson = (r: ChangeRow): boolean => r.waiting > 0 || r.status === 'review' || r.status === 'blocked';

/** The intent a change belongs to; waiting wins whatever the status, since the group means "needs you". */
export function intentOf(r: ChangeRow): Intent {
  if (needsPerson(r) && r.status !== 'done' && r.status !== 'dropped') return 'waiting';
  return INTENTS.find((i) => i.statuses.includes(r.status ?? 'open'))?.id ?? 'upcoming';
}

/** Most recently moved first; never moved last, then by creation. */
export const byMoved = (rows: ChangeRow[]): ChangeRow[] =>
  rows.toSorted(
    (a, b) =>
      (b.moved ?? '').localeCompare(a.moved ?? '') ||
      (b.created ?? '').localeCompare(a.created ?? '') ||
      a.key.localeCompare(b.key),
  );

export interface IntentGroup {
  intent: Intent;
  label: string;
  rows: ChangeRow[];
}

/** The rows grouped by intent in order, each group most recently moved first; empty groups left out. */
export function byIntent(rows: ChangeRow[]): IntentGroup[] {
  return INTENTS.map((i) => ({
    intent: i.id,
    label: i.label,
    rows: byMoved(rows.filter((r) => intentOf(r) === i.id)),
  })).filter((g) => g.rows.length > 0);
}

/** Proposed decisions by the change they sit on. */
export function decisionsByChange(waiting: WaitingDecision[]): Map<string, WaitingDecision[]> {
  const m = new Map<string, WaitingDecision[]>();
  for (const d of waiting) m.set(d.change, [...(m.get(d.change) ?? []), d]);
  return m;
}

/** Decisions whose change is not among the rows: shown on their own so nothing waiting is hidden. */
export const strayDecisions = (waiting: WaitingDecision[], rows: ChangeRow[]): WaitingDecision[] => {
  const keys = new Set(rows.map((r) => r.key));
  return waiting.filter((d) => !keys.has(d.change));
};

/** The asks a change carries for a person, as short words: decide, review, unblock. */
export function asksOf(r: ChangeRow, decisions: number): string[] {
  const out: string[] = [];
  if (decisions > 0) out.push(decisions === 1 ? 'decide 1' : `decide ${decisions}`);
  if (r.status === 'review') out.push('review');
  if (r.status === 'blocked') out.push('unblock');
  return out;
}

// --- by motion (decision feature-detail/one-node-record) ----------------------------------------------------------

export type Motion = 'waiting' | 'working' | 'stopped' | 'review' | 'blocked' | 'open';

/** The groups in the order the bridge reads them, what waits on the person first and what has no plan last. */
export const MOTIONS: readonly { id: Motion; label: string }[] = [
  { id: 'waiting', label: 'Waits on you' },
  { id: 'working', label: 'Working now' },
  { id: 'stopped', label: 'Stopped · next set' },
  { id: 'review', label: 'In review' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'open', label: 'Open · no plan yet' },
];

/** A change's motion: a decision waiting on the person first, whatever else; then a live session on it; blocked and
 *  in review as its status; stopped with a step to pick up; else open, with no plan yet. */
export function motionOf(r: ChangeRow): Motion {
  if (r.waiting > 0) return 'waiting';
  if (r.live) return 'working';
  if (r.status === 'blocked') return 'blocked';
  if (r.status === 'review') return 'review';
  if (r.step || r.next) return 'stopped';
  return 'open';
}

export interface MotionGroup {
  motion: Motion;
  label: string;
  rows: ChangeRow[];
}

/** The rows grouped by motion in order, each group most recently moved first; empty groups left out; done and
 *  dropped changes never listed. */
export function byMotion(rows: ChangeRow[]): MotionGroup[] {
  const open = rows.filter((r) => r.status !== 'done' && r.status !== 'dropped');
  return MOTIONS.map((m) => ({
    motion: m.id,
    label: m.label,
    rows: byMoved(open.filter((r) => motionOf(r) === m.id)),
  })).filter((g) => g.rows.length > 0);
}
