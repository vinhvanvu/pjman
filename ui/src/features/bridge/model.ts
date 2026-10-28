// The bridge's need strip, as pure derivations: what waits on the person first, at the grain of the decision (every
// proposed decision in the product, by change, the newest proposal first, with the session bound to that change when
// one is in the window), then the sessions by state (decision stage-strip-transport; decision
// rail-destinations/three-destinations makes the first group the inbox). Need is the stable frame; inside a group
// the most recent write comes first. A session shown on a waiting change is not repeated in the groups below.
import type { BridgeSession, SessionState, WaitingChange } from '@/data/contract';
import { ago } from '@/lib/format';

/** A change with decisions proposed on it, and the session on it when one is in the window. */
export interface WaitItem extends WaitingChange {
  session?: BridgeSession;
}

export interface NeedGroup {
  state: Exclude<SessionState, 'waiting'>;
  /** What the group is called. */
  label: string;
  sessions: BridgeSession[];
}

export interface StripData {
  /** What waits on the person: one item per change with a proposed decision, the newest proposal first. */
  waits: WaitItem[];
  /** The sessions by state, in the order of need, those already shown on a waiting change left out. */
  groups: NeedGroup[];
}

/** The session groups in the order of need after what waits on the person: what stopped with a next set, what is
 *  working now, what ended with its work in review. Every group is listed, empty or not. An ended session whose
 *  change is not in review is not in the strip: nothing about it needs the person. */
export const NEED_ORDER: readonly { state: NeedGroup['state']; label: string }[] = [
  { state: 'stopped', label: 'Stopped · next set' },
  { state: 'working', label: 'Working' },
  { state: 'ended', label: 'Ended · in review' },
];

const newestFirst = (a: BridgeSession, b: BridgeSession) =>
  (b.last ?? '').localeCompare(a.last ?? '') || a.key.localeCompare(b.key);

export function strip(data: { waitingOn: readonly WaitingChange[]; sessions: readonly BridgeSession[] }): StripData {
  const sessions = data.sessions.toSorted(newestFirst);
  const shown = new Set<string>();
  const waits = data.waitingOn.map((w) => {
    const session = sessions.find((s) => s.change?.key === w.change.key);
    if (session) shown.add(session.key);
    return { ...w, session };
  });
  const rest = sessions.filter((s) => !shown.has(s.key));
  const groups = NEED_ORDER.map(({ state, label }) => ({
    state,
    label,
    // a session that stopped waiting on a decision not shown above (none in this product's list) reads as stopped
    sessions: rest.filter(
      (s) => (s.state === state || (state === 'stopped' && s.state === 'waiting')) && (state !== 'ended' || s.inReview),
    ),
  }));
  return { waits, groups };
}

/** The words after a card's feature path: what the session last did and when. */
export function cardWhen(s: Pick<BridgeSession, 'state' | 'last' | 'line'>, now = Date.now()): string {
  const since = s.last ? ago(s.last, now) : '';
  const back = since && since !== 'just now' ? `${since} ago` : since;
  switch (s.state) {
    case 'working':
      return back ? `wrote ${back}` : 'working';
    case 'ended':
      return back ? `ended ${back}` : 'ended';
    default:
      return back ? `stopped ${back}` : 'stopped';
  }
}

/** The faint words for a session's subagents, when it has any: how many, and whether one is still working. */
export function subagentWords(children: readonly Pick<BridgeSession, 'state'>[]): string | undefined {
  if (children.length === 0) return undefined;
  const working = children.filter((c) => c.state === 'working').length;
  const word = (n: number) => `${n} subagent${n === 1 ? '' : 's'}`;
  return working ? `${word(working)} working` : `+${word(children.length)}`;
}

/** "proposed 2h ago": when a decision was opened, from its day; the day alone when that is all that is known. */
export function proposedWhen(created: string | undefined, now = Date.now()): string {
  if (!created) return 'proposed';
  const since = ago(created, now);
  return since === 'just now' || /^\d/.test(since)
    ? `proposed ${since === 'just now' ? since : `${since} ago`}`
    : `proposed ${since}`;
}
