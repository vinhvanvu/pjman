// The bridge's cards, as pure derivations (decision bridge-rework/cards-and-transport): the changes in motion grouped
// by motion (working now, stopped with a next set, in review, blocked), each the most recently touched first; what a
// card says about its step and its sessions; and the tie to the transport, which ticks are a change's writes, so a
// card under the pointer lights them and a held card filters to them. Nothing here keeps state.
import type { BridgeMotion, BridgeSession, TimelineEvent } from '@/data/contract';
import { plural } from '@/lib/format';
import { changeOfDecision } from '@/lib/keys';

export type MotionState = 'working' | 'stopped' | 'review' | 'blocked';

export interface MotionGroup {
  state: MotionState;
  label: string;
  changes: BridgeMotion[];
}

/** The groups in the order of motion. Every group is listed, empty or not, so the frame holds still. */
export const MOTION_ORDER: readonly { state: MotionState; label: string }[] = [
  { state: 'working', label: 'Working now' },
  { state: 'stopped', label: 'Stopped · next set' },
  { state: 'review', label: 'In review' },
  { state: 'blocked', label: 'Blocked' },
];

/** Every session the bridge carries, by key: the rows and the subagents under them. */
export function allSessions(sessions: readonly BridgeSession[]): Map<string, BridgeSession> {
  const out = new Map<string, BridgeSession>();
  for (const s of sessions) {
    out.set(s.key, s);
    for (const c of s.children) out.set(c.key, c);
  }
  return out;
}

/** A change's motion: blocked and in review are its status; working while a session on it works; else stopped. */
export function motionOf(c: BridgeMotion, sessions: ReadonlyMap<string, BridgeSession>): MotionState {
  if (c.status === 'blocked') return 'blocked';
  if (c.status === 'review') return 'review';
  if (c.sessions.some((k) => sessions.get(k)?.state === 'working')) return 'working';
  return 'stopped';
}

const newestFirst = (a: BridgeMotion, b: BridgeMotion) => b.last.localeCompare(a.last) || a.key.localeCompare(b.key);

/** The changes in motion by group, each group the most recently touched first. */
export function groupsOf(data: {
  changes: readonly BridgeMotion[];
  sessions: readonly BridgeSession[];
}): MotionGroup[] {
  const sessions = allSessions(data.sessions);
  return MOTION_ORDER.map(({ state, label }) => ({
    state,
    label,
    changes: data.changes.filter((c) => motionOf(c, sessions) === state).toSorted(newestFirst),
  }));
}

/** The grid as one list (change:motion-design): every group's heading and its cards in a row, so a card that moves
 *  between groups slides there as one motion, and a held grid freezes one order. */
export type CardRow =
  | {
      key: string;
      kind: 'head';
      state: MotionState;
      label: string;
      count: number;
      words: string;
    }
  | { key: string; kind: 'card'; change: BridgeMotion };

export function cardRows(groups: readonly MotionGroup[]): CardRow[] {
  const rows: CardRow[] = [];
  for (const g of groups) {
    const n = g.changes.length;
    rows.push({
      key: `h:${g.state}`,
      kind: 'head',
      state: g.state,
      label: g.label,
      count: n,
      words: n ? `${plural(n, 'change')}${n > 1 ? ' · by last touch' : ''}` : 'none',
    });
    rows.push(
      ...g.changes.map((change): CardRow => ({
        key: `c:${change.key}`,
        kind: 'card',
        change,
      })),
    );
  }
  return rows;
}

// the words a card and a pill say live with the change component (components/change/model), the one drawing of a
// change at every depth; re-exported so the bridge's tests and callers read them from here
export { pillWords, stepWords } from '@/components/change/model';

/** The change each session is on, by key, a subagent's its own change else its parent's. */
export function sessionChanges(sessions: readonly BridgeSession[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sessions) {
    if (s.change) out.set(s.key, s.change.key);
    for (const c of s.children) {
      const on = c.change?.key ?? s.change?.key;
      if (on) out.set(c.key, on);
    }
  }
  return out;
}

/** The change an event is a write to: the change itself, the change of a decision, or the change the session that
 *  wrote it is on. */
export function changeOfEvent(e: TimelineEvent, onChange: ReadonlyMap<string, string>): string | undefined {
  if (e.type === 'change') return e.key;
  if (e.type === 'decision') return changeOfDecision(e.key);
  const s = e.session ?? (e.type === 'session' ? e.key : undefined);
  return s ? onChange.get(s) : undefined;
}

/** The ticks that are a change's writes: what a card under the pointer lights on the transport, and what a held card
 *  filters it to. */
export function ticksOf(
  change: string,
  events: readonly TimelineEvent[],
  onChange: ReadonlyMap<string, string>,
): ReadonlySet<number> {
  const out = new Set<number>();
  for (const e of events) if (changeOfEvent(e, onChange) === change) out.add(e.seq);
  return out;
}

/** The sessions on no change that are not over and have no name: counted in one folded line, since nothing on the
 *  grid carries them and a fresh session binds soon. */
export const unbound = (sessions: readonly BridgeSession[]): BridgeSession[] =>
  sessions.filter((s) => !s.change && s.state !== 'ended' && !s.name);

/** The sessions on no change that were named (a review, a backlog pass, a chat; change:unbound-sessions): each has a
 *  row of its own, titled with its name, the ended ones too, since the work was real. */
export const namedUnbound = (sessions: readonly BridgeSession[]): BridgeSession[] =>
  sessions.filter((s) => !s.change && !!s.name);

/** The last of the live arrivals that touched a change: a write to it, to a decision on it, or by a session on it. */
export function lastArrival(
  arrivals: readonly TimelineEvent[],
  change: string,
  onChange: ReadonlyMap<string, string>,
): TimelineEvent | undefined {
  return arrivals.findLast((e) => changeOfEvent(e, onChange) === change);
}
