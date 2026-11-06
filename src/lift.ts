// The status lift (decision status-from-the-plan/derive-or-write): a rule on the store's events moves a change forward
// through pjman set, never back. A step added makes it planning; a step started (or done) makes it active, and so does a
// session writing a file of the project for it (the observed edge names the change). Blocked, review, done and dropped
// are a person's; the rule leaves them, and a status already past the lift stays. Each lift is its own write, so
// `pjman undo <commit>` reverses it.
import type { Store } from './config.js';
import type { EventInput } from './events.js';
import { stepsOf } from './foundation.js';
import { loadStore, type Loaded, type Rec } from './records.js';
import { set } from './commands/set.js';
import { live } from './tree.js';

/** The statuses the rule moves from, lowest first; any other status is a person's and stays. */
const RANK: Record<string, number> = { open: 0, planning: 1, active: 2 };

export interface Lift {
  key: string;
  from: string;
  to: 'planning' | 'active';
  because: string;
}

const statusOf = (rec: Rec): string => (typeof rec.data.status === 'string' ? rec.data.status : 'open');

/** What the plan alone says: planning once it has a step, active once a step has started. */
function fromPlan(rec: Rec): Lift['to'] | undefined {
  const steps = stepsOf(rec.data);
  if (steps.some((s) => s.state === 'active' || s.state === 'done')) return 'active';
  return steps.length ? 'planning' : undefined;
}

/** The lift for one change, when the target is above where it stands and where it stands is the rule's to move. */
function liftOf(rec: Rec | undefined, to: Lift['to'] | undefined, because: string): Lift | undefined {
  if (!rec || rec.type !== 'change' || !rec.valid || !to) return undefined;
  const from = statusOf(rec);
  if (!(from in RANK) || RANK[to] <= RANK[from]) return undefined;
  return { key: rec.key, from, to, because };
}

/** The lifts a set of events calls for: a change's plan written, a session observing a file written for its change. */
export function liftsFor(loaded: Loaded, events: EventInput[]): Lift[] {
  const out = new Map<string, Lift>();
  const add = (l: Lift | undefined) => {
    if (l && RANK[l.to] > RANK[out.get(l.key)?.to ?? 'open']) out.set(l.key, l);
  };
  for (const e of events) {
    if (e.type === 'change' && e.fields?.includes('plan')) {
      const rec = live(loaded, e.key);
      add(liftOf(rec, rec && fromPlan(rec), e.fields.find((f) => f.startsWith('step ')) ?? 'plan'));
    } else if (e.type === 'session' && e.op === 'observe') {
      // the edge just observed names the change the file was written for
      const s = live(loaded, e.key);
      const observed = Array.isArray(s?.data.observed) ? (s!.data.observed as { from?: string; to?: string }[]) : [];
      const last = observed.at(-1);
      if (!s || !last?.to?.startsWith('file:')) continue;
      add(liftOf(live(loaded, last.from), 'active', `${s.key} wrote ${last.to}`));
    }
  }
  return [...out.values()];
}

/** Every lift the store's changes call for from their plans as they stand: the backfill for a store written before the rule. */
export function liftsOfStore(loaded: Loaded): Lift[] {
  return loaded.records.filter((r) => r.type === 'change').map((r) => liftOf(r, fromPlan(r), 'plan')).filter((l): l is Lift => !!l);
}

/** Run the rule after a write: each lift goes through pjman set, carrying the session the write came from. */
export function liftAfter(store: Store, events: EventInput[], session: string | undefined): Lift[] {
  // only a plan written or a file observed can call for a lift; anything else skips the load
  if (!events.some((e) => (e.type === 'change' && e.fields?.includes('plan')) || (e.type === 'session' && e.op === 'observe'))) return [];
  const lifts = liftsFor(loadStore(store), events);
  const done: Lift[] = [];
  for (const l of lifts) {
    // the write that called for the lift has landed: a lift refused says so and leaves that write standing
    try {
      set(store, l.key, [`status=${l.to}`], { session: events.find((e) => e.session)?.session ?? session, because: `lifted from ${l.from}: ${l.because}` });
      done.push(l);
    } catch (err) {
      process.stderr.write(`pjman: ${l.key} not lifted to ${l.to}: ${(err as Error).message.split('\n')[0]}\n`);
    }
  }
  return done;
}
