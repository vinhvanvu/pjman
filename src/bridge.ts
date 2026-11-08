// The bridge's data (decision bridge-rework/cards-and-transport): the product's changes in motion, every change
// touched inside the window with the facts a card carries (status, steps done of total, the step the work stands on,
// the sessions on it), and the product's sessions, each with the state the person reads it by (working, waiting on a
// decision, stopped with a next, ended). Everything is derived from what the store already holds: the session's log
// lines (the hook writes one at every stop and at the end), the writes stamped with the session, the change it is
// bound to, the change's plan and the decisions proposed on it. Nothing is stored. No decision is listed: the bridge
// shows none.
import type { Store } from './config.js';
import { readEvents } from './events.js';
import { productOf } from './commands/order.js';
import type { Loaded, Rec } from './records.js';
import { LIVE_MINUTES, proposedDecisions, type WaitingDecision } from './scope.js';
import { effectsOf, live, rootProductOf, structuralParent } from './tree.js';
import { lineOf, nextStep, stepsOf, type StepState } from './foundation.js';
import { nextLine } from './commands/view.js';

export type SessionState = 'working' | 'waiting' | 'stopped' | 'ended';

export interface BridgeChange {
  key: string;
  /** The gist. */
  title?: string;
  name?: string;
  status?: string;
  /** The next step of the plan, as a line; derived. */
  next?: string;
  /** The feature path the change names, the product left out, top first: the nearest feature is last. */
  path: { key: string; name: string }[];
}

export interface BridgeSession {
  key: string;
  agent?: string;
  onBehalfOf?: string;
  started?: string;
  /** The last instant the session itself acted: a line it wrote or a write stamped with it. */
  last?: string;
  state: SessionState;
  /** The last line it wrote before any closing one, and when. */
  line?: { at: string; text: string };
  /** Ended: when it wrote its closing line, and the reason the line gives. */
  ended?: { at: string; reason: string };
  /** The session it was spawned by, when it is a subagent's: such a session is carried under its parent, never as a
   *  row of its own. */
  parent?: string;
  /** The sessions spawned by this one that acted inside the window. */
  children: BridgeSession[];
  /** What it is on: its last bound change that still resolves. */
  change?: BridgeChange;
  /** The decision that waits on the person, when one does: the oldest proposed on its change. */
  decision?: WaitingDecision;
  /** Its change is in review: an ended session whose work waits for a look. */
  inReview: boolean;
}

/** A change in motion: touched inside the window and not finished, with what a card says about it. */
export interface BridgeMotion {
  key: string;
  name?: string;
  /** The gist. */
  title?: string;
  status?: string;
  /** The feature path the change names, the product left out, top first. */
  path: { key: string; name: string }[];
  /** Steps done of the steps that count, and how many were dropped (not counted). */
  steps: { done: number; total: number; dropped: number };
  /** The step the work stands on: the active one, else the first open, with its note. Absent when the plan is empty
   *  or every step is done. */
  step?: { n: number; text: string; state: StepState; note?: string };
  /** What blocks it, as the record says, when it is blocked. */
  blockedOn?: string;
  /** The last instant anything touched it inside the window: a write to it or to a decision on it, or an act of a
   *  session on it. */
  last: string;
  /** The sessions on it that acted inside the window, most recent first, by key; a subagent's is its own key. */
  sessions: string[];
}

export interface Bridge {
  product: string | null;
  days: number;
  /** The changes in motion, the most recently touched first. */
  changes: BridgeMotion[];
  /** The sessions that acted inside the window, most recent first; a subagent's session sits under its parent. */
  sessions: BridgeSession[];
}

export interface BridgeOpts {
  /** The product whose sessions are listed; every product when absent. */
  product?: string;
  /** How far back a session's last act may be, in days. */
  days?: number;
  now?: number;
  /** Read as of this event: the stream is cut after it (the records are the caller's, loaded at the same moment). */
  until?: number;
}

const LOG_LINE = /^-\s*(\S+)\s+—\s+(.*)$/;
const CLOSING = /^session ended(?:\s*\((.*)\))?$/;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The facts a state is read from. */
export interface StateFacts {
  /** The session wrote its closing line. */
  ended: boolean;
  /** When its last line was written. */
  line?: string;
  /** The last write stamped with it that is not a line of its own. */
  act?: string;
  /** A decision on its change is proposed. */
  proposed: boolean;
}

/** A session's state. Ended once it wrote its closing line. Working while something it did reached the stream inside
 *  the live window and its last act was not a stop line: the hook writes a line at every stop, so a session whose
 *  latest act is its own line is stopped, waiting on the person's next prompt. A stopped session with a decision
 *  proposed on its change is waiting; otherwise it is stopped. A session that went quiet mid-turn (nothing for the
 *  live window, no stop line) reads as stopped too. */
export function sessionState(f: StateFacts, now = Date.now(), liveMinutes = LIVE_MINUTES): SessionState {
  if (f.ended) return 'ended';
  const last = [f.line, f.act].filter((x): x is string => !!x).sort().at(-1);
  const liveSince = new Date(now - liveMinutes * 60_000).toISOString();
  const stopped = !!f.line && (!f.act || f.act <= f.line);
  if (!stopped && last && last >= liveSince) return 'working';
  return f.proposed ? 'waiting' : 'stopped';
}

/** The feature path above a change: the features from the top of the product down to the first one it names. */
export function featurePath(loaded: Loaded, change: Rec): BridgeChange['path'] {
  const first = effectsOf(change)[0];
  const feature = first && live(loaded, first.key);
  if (!feature || feature.type !== 'feature') return [];
  const out: BridgeChange['path'] = [];
  const seen = new Set<string>();
  let cur: Rec | undefined = feature;
  while (cur && cur.type === 'feature' && !seen.has(cur.key)) {
    seen.add(cur.key);
    out.unshift({ key: cur.key, name: str(cur.data.name) ?? str(cur.data.title) ?? cur.key.slice(cur.key.lastIndexOf('/') + 1) });
    cur = structuralParent(loaded, cur);
  }
  return out;
}

/** The change of a decision's key: `decision:<product>/<change>/<slug>` is on `change:<product>/<change>`; a decision
 *  at the product or store level (two segments or one) is on none. The same reading as ui/src/lib/keys.ts. */
export function changeOfDecision(key: string): string | undefined {
  if (!key.startsWith('decision:')) return undefined;
  const parts = key.slice('decision:'.length).split('/');
  return parts.length === 3 ? `change:${parts[0]}/${parts[1]}` : undefined;
}

/** One change as the bridge's card reads it. */
export function motionOf(loaded: Loaded, c: Rec, last: string, sessions: string[]): BridgeMotion {
  const steps = stepsOf(c.data);
  const counted = steps.filter((s) => s.state !== 'dropped');
  const next = nextStep(steps);
  const blockedOn = c.sections.get('Blocked on')?.trim();
  return {
    key: c.key,
    name: str(c.data.name),
    title: lineOf(c.data),
    status: str(c.data.status),
    path: featurePath(loaded, c),
    steps: { done: counted.filter((s) => s.state === 'done').length, total: counted.length, dropped: steps.length - counted.length },
    step: next ? { n: next.n, text: next.step.text, state: next.step.state, note: next.step.note } : undefined,
    blockedOn: blockedOn || undefined,
    last,
    sessions,
  };
}

const DAY = 24 * 60 * 60_000;

export function bridge(store: Store, loaded: Loaded, opts: BridgeOpts = {}): Bridge {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 1;
  const since = new Date(now - days * DAY).toISOString();
  const productKey = opts.product ? (opts.product.startsWith('product:') ? opts.product : `product:${opts.product}`) : null;

  // the last act of each session from the stream: a write stamped with it, its own line excluded (the line's own
  // instant is read from the log, so a stop reads as a stop and not as an act after it); and the last touch of each
  // change inside the window: a write to it, or to a decision on it
  const acts = new Map<string, string>();
  const touched = new Map<string, string>();
  for (const e of readEvents(store)) {
    if (opts.until !== undefined && e.seq > opts.until) break;
    const c = e.type === 'change' ? e.key : e.type === 'decision' ? changeOfDecision(e.key) : undefined;
    if (c && e.at >= since && (!touched.has(c) || e.at > touched.get(c)!)) touched.set(c, e.at);
    const s = e.session ?? (e.type === 'session' ? e.key : undefined);
    if (!s) continue;
    if (e.op === 'log' && e.key === s) continue;
    if (!acts.has(s) || e.at > acts.get(s)!) acts.set(s, e.at);
  }
  // the proposed decisions in the product, by change, oldest first within a change: a session stopped on one waits
  const inProduct = (c: Rec | undefined) => !!c && (!productKey || productOf(loaded, c)?.key === productKey);
  const proposedOn = new Map<string, WaitingDecision[]>();
  for (const d of proposedDecisions(loaded, (d) => inProduct(live(loaded, d.changeKey)))) {
    const c = live(loaded, d.change)!;
    proposedOn.set(c.key, [...(proposedOn.get(c.key) ?? []), d]);
  }
  const asChange = (c: Rec): BridgeChange => ({ key: c.key, title: lineOf(c.data), name: str(c.data.name), status: str(c.data.status), next: nextLine(nextStep(stepsOf(c.data))), path: featurePath(loaded, c) });

  const rows: BridgeSession[] = [];
  for (const rec of loaded.records) {
    if (rec.type !== 'session' || !rec.valid) continue;
    const log = (rec.sections.get('Log') ?? '')
      .split('\n')
      .map((l) => LOG_LINE.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ at: m[1], text: m[2] }));
    const closing = log.at(-1) && CLOSING.exec(log.at(-1)!.text) ? log.at(-1) : undefined;
    const ended = closing ? { at: closing.at, reason: CLOSING.exec(closing.text)![1] ?? 'other' } : undefined;
    const line = closing ? log.at(-2) : log.at(-1);
    const act = acts.get(rec.key);
    const last = [closing?.at, line?.at, act].filter((x): x is string => !!x).sort().at(-1);
    if (!last || last < since) continue;
    const bound = (Array.isArray(rec.data.changes) ? (rec.data.changes as unknown[]) : []).map((k) => live(loaded, k)).filter((r): r is Rec => !!r);
    const on = bound.at(-1);
    const project = live(loaded, rec.data.project);
    const product = on ? productOf(loaded, on) : project ? rootProductOf(loaded, project) : undefined;
    if (productKey && product?.key !== productKey) continue;
    const proposed = on ? (proposedOn.get(on.key) ?? []) : [];
    const state = sessionState({ ended: !!ended, line: line?.at, act, proposed: proposed.length > 0 }, now);
    rows.push({
      key: rec.key,
      agent: str(rec.data.agent),
      onBehalfOf: str(rec.data.on_behalf_of),
      started: str(rec.data.started),
      last,
      state,
      line,
      ended,
      parent: str(rec.data.parent),
      children: [],
      change: on ? asChange(on) : undefined,
      decision: state === 'waiting' ? proposed[0] : undefined,
      inReview: on?.data.status === 'review',
    });
  }
  // a subagent's session is carried under its parent; one spawned by a session outside the window or the product is
  // left out, since it has no row to sit under
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const newestFirst = (a: BridgeSession, b: BridgeSession) => (b.last ?? '').localeCompare(a.last ?? '') || a.key.localeCompare(b.key);
  const sessions: BridgeSession[] = [];
  for (const r of rows) {
    if (!r.parent) sessions.push(r);
    else byKey.get(r.parent)?.children.push(r);
  }
  for (const r of sessions) r.children.sort(newestFirst);
  sessions.sort(newestFirst);

  // the changes in motion: touched by a write or by a session inside the window, in the product, not finished. A
  // subagent on no change of its own is on its parent's, as the dashboard reads it. A key is read through the store,
  // so a change renamed inside the window is one change, touched under both names.
  const changeOfRow = (r: BridgeSession): BridgeChange | undefined =>
    r.change ?? (r.parent ? byKey.get(r.parent)?.change : undefined);
  const onChange = new Map<string, BridgeSession[]>();
  for (const r of rows) {
    const on = changeOfRow(r);
    if (!on) continue;
    onChange.set(on.key, [...(onChange.get(on.key) ?? []), r]);
    if (r.last && (!touched.has(on.key) || r.last > touched.get(on.key)!)) touched.set(on.key, r.last);
  }
  const resolved = new Map<string, { rec: Rec; last: string }>();
  for (const [key, last] of touched) {
    const c = live(loaded, key);
    if (!c || c.type !== 'change' || !c.valid) continue;
    const seen = resolved.get(c.key);
    if (!seen || last > seen.last) resolved.set(c.key, { rec: c, last });
  }
  const changes: BridgeMotion[] = [];
  for (const [key, { rec: c, last }] of resolved) {
    if (c.data.status === 'done' || c.data.status === 'dropped') continue;
    if (!inProduct(c)) continue;
    changes.push(motionOf(loaded, c, last, [...(onChange.get(key) ?? [])].sort(newestFirst).map((r) => r.key)));
  }
  changes.sort((a, b) => b.last.localeCompare(a.last) || a.key.localeCompare(b.key));
  return { product: productKey, days, changes, sessions };
}
