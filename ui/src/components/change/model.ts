// One change at three depths (decision feature-detail/change-at-three-depths): the row, the card and the tree are one
// component read from one set of facts, so a change is recognisable on the bridge, the roadmap, the map and in a work
// list alike. The facts are the same whatever answered them: the bridge's motion payload, or a scope's change row
// with the live sessions beside it. Pure derivations; nothing here keeps state.
import type { BridgeMotion, BridgeSession, ChangeRow, LiveSession, SessionState } from '@/data/contract';
import { agoWords } from '@/lib/format';
import { short } from '@/lib/keys';

/** A session as a pill says it: who, what it is doing, since when. The bridge's sessions are this already. */
export interface PillSession {
  key: string;
  agent?: string;
  state: SessionState;
  last?: string;
}

/** What every depth of the change reads. */
export interface ChangeFacts {
  key: string;
  name?: string;
  /** The gist. */
  title?: string;
  status?: string;
  /** The last instant anything touched it. */
  last?: string;
  /** Steps done of the steps that count, and how many were dropped. */
  steps: { done: number; total: number; dropped: number };
  /** The step the work stands on, with its note. */
  step?: { n: number; text: string; state: string; note?: string };
  blockedOn?: string;
  /** The sessions on it, the live one first. */
  sessions: PillSession[];
  /** The feature path it names, top first, as names. */
  path: string[];
  /** Decisions waiting on a person. */
  waiting: number;
  /** The milestone it belongs to, when it has one. */
  parent?: { key: string; name: string };
}

/** A session is on the change and working. */
export const isWorking = (f: Pick<ChangeFacts, 'sessions'>): boolean => f.sessions.some((s) => s.state === 'working');

/** The bridge's card, read as facts: its sessions resolved by key. */
export function factsOfMotion(c: BridgeMotion, byKey: ReadonlyMap<string, BridgeSession>): ChangeFacts {
  return {
    key: c.key,
    name: c.name,
    title: c.gist,
    status: c.status,
    last: c.last,
    steps: c.steps,
    step: c.step,
    blockedOn: c.blockedOn,
    sessions: c.sessions.map((k) => byKey.get(k)).filter((s): s is BridgeSession => !!s),
    path: c.path.map((f) => f.name),
    waiting: 0,
    parent: undefined,
  };
}

/** A scope's change row, read as facts: the live sessions on it carry their state by the bridge's rule, so one that
 *  stopped at a line is not working (change:alive-step-bars); `names` resolves a feature's or a change's key to what it
 *  is called. */
export function factsOfRow(
  r: ChangeRow,
  live: readonly LiveSession[],
  names: ReadonlyMap<string, string> = new Map(),
): ChangeFacts {
  const feature = r.features.find((f) => !f.viaPlace) ?? r.features[0];
  return {
    key: r.key,
    name: r.name,
    title: r.gist,
    status: r.status,
    last: r.moved ?? r.created,
    // a milestone's children are its plan (decision milestone-detail/children-in-order), as the bridge reads it too
    steps:
      r.children > 0 && r.progress
        ? { done: r.progress.done, total: r.progress.total, dropped: 0 }
        : { done: r.plan?.done ?? 0, total: r.plan?.total ?? 0, dropped: 0 },
    step: r.step,
    blockedOn: r.blockedOn,
    sessions: live
      .filter((s) => s.on === r.key)
      .map((s) => ({ key: s.key, agent: s.agent, state: s.state, last: s.last })),
    path: feature ? [names.get(feature.key) ?? feature.title ?? short(feature.key)] : [],
    waiting: r.waiting,
    parent: r.parent ? { key: r.parent, name: names.get(r.parent) ?? short(r.parent) } : undefined,
  };
}

/** What a change is called in a row or a card: its name, else its gist, else its key. */
export const nameOf = (f: Pick<ChangeFacts, 'key' | 'name' | 'title'>): string => f.name ?? f.title ?? short(f.key);

/** The words a card says about where the work stands: the lead (a label) and the text after it. Blocked says what
 *  blocks it; in review says the plan is done or what is left; otherwise the step the work stands on, `step n of m`
 *  while it is active, `next` while it waits to start. */
export function stepWords(c: Pick<ChangeFacts, 'status' | 'blockedOn' | 'step' | 'steps'>): {
  lead: string;
  text: string;
} {
  if (c.status === 'blocked' && c.blockedOn) return { lead: 'on', text: c.blockedOn };
  if (c.status === 'review' && (!c.step || c.steps.total === 0))
    return {
      lead: 'done',
      text: c.steps.total ? `${c.steps.done} of ${c.steps.total}; waits for a look` : 'waits for a look',
    };
  if (!c.step)
    return {
      lead: 'plan',
      text: c.steps.total ? 'every step done' : c.steps.dropped ? 'every step dropped' : 'no steps yet',
    };
  if (c.step.state === 'active') return { lead: `step ${c.step.n} of ${c.steps.total}`, text: c.step.text };
  return { lead: 'next', text: c.step.text };
}

/** The words on a session's pill: who, what it is doing, since when. */
export function pillWords(s: Pick<PillSession, 'agent' | 'state' | 'last'>, now = Date.now()): string {
  const who = s.agent ? short(s.agent) : 'session';
  const since = s.last ? agoWords(s.last, now) : '';
  const when = since ? ` · ${since}` : '';
  switch (s.state) {
    case 'working':
      return `${who} · working${when}`;
    case 'waiting':
      return `${who} · waiting${when}`;
    case 'ended':
      return `${who} · ended${when}`;
    default:
      return `${who} · stopped${when}`;
  }
}
