// The bridge's need strip, as pure derivations: what waits on the person first, at the grain of the decision (every
// proposed decision in the product, by change, the newest proposal first, with the session bound to that change when
// one is in the window), then the sessions by state (decision stage-strip-transport; decision
// rail-destinations/three-destinations makes the first group the inbox). Need is the stable frame; inside a group
// the most recent write comes first. A session shown on a waiting change is not repeated in the groups below.
import type { BridgeSession, SessionState, TimelineEvent, WaitingChange } from '@/data/contract';
import { ago, plural } from '@/lib/format';
import { changeOfDecision } from '@/lib/keys';

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

// The bridge's lanes, pure (decision live-sessions/stage-strip-transport): one row per session over the transport's
// window, each line it wrote a beat, a flag where it opened a decision, a bar from its first act to its last. Rows
// are read from the same events the transport draws, so the two stand on one axis; a subagent's events are its
// parent's row, as the strip carries a subagent under its parent.

export interface Lane {
  session: BridgeSession;
  /** The lines it wrote, in order. */
  beats: TimelineEvent[];
  /** The decisions it opened. */
  flags: TimelineEvent[];
  /** Its first and last act inside the window, lines and writes alike. */
  first: string;
  last: string;
}

/** The session an event belongs to: the one stamped on it, or the session record it wrote. */
export const sessionOf = (e: TimelineEvent): string | undefined =>
  e.session ?? (e.type === 'session' ? e.key : undefined);

/** The rows: the bridge's sessions in its order (most recent act first), those with something in the window. A
 *  session that ended without ever naming a change is left out, as the strip leaves it out: it has nothing to show
 *  and nowhere to open. */
export function lanesOf(sessions: readonly BridgeSession[], events: readonly TimelineEvent[]): Lane[] {
  const row = new Map<string, string>();
  for (const s of sessions) {
    row.set(s.key, s.key);
    for (const c of s.children) row.set(c.key, s.key);
  }
  const by = new Map<string, Omit<Lane, 'session'>>();
  for (const e of events) {
    const s = sessionOf(e);
    const key = s && row.get(s);
    if (!key) continue;
    let lane = by.get(key);
    if (!lane) by.set(key, (lane = { beats: [], flags: [], first: e.at, last: e.at }));
    lane.last = e.at;
    if (e.op === 'log' && e.type === 'session') lane.beats.push(e);
    if (e.type === 'decision' && e.op === 'created') lane.flags.push(e);
  }
  return sessions.flatMap((s) => {
    const lane = s.state === 'ended' && !s.change ? undefined : by.get(s.key);
    return lane ? [{ session: s, ...lane }] : [];
  });
}

// The strip as one list (change:motion-design): every group's heading and its cards in a row, so a card that moves
// between groups slides there as one motion, and a held strip freezes one order.

export type StripRow =
  | { key: string; kind: 'head'; state: SessionState; label: string; count: number; words: string }
  | { key: string; kind: 'wait'; item: WaitItem }
  | { key: string; kind: 'session'; session: BridgeSession };

export const sessionRow = (s: BridgeSession): StripRow => ({ key: `s:${s.key}`, kind: 'session', session: s });

/** The headings and cards in the order of need. */
export function stripRows({ waits, groups }: StripData): StripRow[] {
  const decisions = waits.reduce((n, w) => n + w.proposed.length, 0);
  const rows: StripRow[] = [
    {
      key: 'h:waiting',
      kind: 'head',
      state: 'waiting',
      label: 'Waits on you',
      count: waits.length,
      words: waits.length
        ? `${plural(decisions, 'decision')} on ${plural(waits.length, 'change')} · newest first`
        : 'none',
    },
    ...waits.map((item): StripRow => ({ key: `w:${item.change.key}`, kind: 'wait', item })),
  ];
  for (const g of groups) {
    const n = g.sessions.length;
    rows.push({
      key: `h:${g.state}`,
      kind: 'head',
      state: g.state,
      label: g.label,
      count: n,
      words: n ? `${plural(n, 'session')}${n > 1 ? ' · by last write' : ''}` : 'none',
    });
    rows.push(...g.sessions.map(sessionRow));
  }
  return rows;
}

/** The last of the live arrivals that touched a card: written by its session, or to its change or a decision on it. */
export function lastArrival(
  arrivals: readonly TimelineEvent[],
  session?: Pick<BridgeSession, 'key'>,
  change?: { key: string },
): TimelineEvent | undefined {
  return arrivals.findLast(
    (e) =>
      (!!session && (e.session === session.key || e.key === session.key)) ||
      (!!change && (e.key === change.key || changeOfDecision(e.key) === change.key)),
  );
}
