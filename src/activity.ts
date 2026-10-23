// Activity: the event stream of a subtree. Every event names a key; keys roll up through the product tree, so any
// node's timeline is the events of everything beneath it. Health reads from here, as components, never as a score.
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import type { Loaded } from './records.js';
import { descendantsOf, live } from './tree.js';

export interface Activity {
  key: string;
  /** The window's start (ISO instant). */
  since: string;
  days: number;
  /** Keys in the subtree, the node included. */
  subtree: number;
  events: StoreEvent[];
  summary: {
    /** When the subtree last moved, and how many days ago; null when it never has. */
    last: string | null;
    staleDays: number | null;
    events: number;
    byOp: Record<string, number>;
    /** Changes in the subtree that reached done inside the window. */
    doneChanges: string[];
    /** Changes created inside the window. */
    newChanges: string[];
    /** Decisions in the subtree waiting on a person, and changes blocked, as they stand now. */
    proposedDecisions: string[];
    blocked: string[];
  };
}

const DAY = 86_400_000;

export function activity(store: Store, loaded: Loaded, key: string, opts: { days?: number; since?: string } = {}): Activity {
  const days = opts.days ?? 14;
  const now = Date.now();
  const since = opts.since ? new Date(opts.since).toISOString() : new Date(now - days * DAY).toISOString();
  const keys = new Set<string>([key, ...descendantsOf(loaded, key)]);
  // a change's aliases carry its older events
  for (const k of [...keys]) {
    const r = live(loaded, k);
    if (r?.type === 'change' && Array.isArray(r.data.aliases)) for (const a of r.data.aliases) if (typeof a === 'string') keys.add(`change:${a}`);
  }
  const all = readEvents(store).filter((e) => keys.has(e.key));
  const events = all.filter((e) => e.at >= since);
  const last = all.length ? all[all.length - 1].at : null;
  const byOp: Record<string, number> = {};
  for (const e of events) byOp[e.op] = (byOp[e.op] ?? 0) + 1;
  const isDone = (k: string) => live(loaded, k)?.data.status === 'done';
  const doneChanges = [...new Set(events.filter((e) => e.type === 'change' && e.op === 'set' && e.fields?.includes('status') && isDone(e.key)).map((e) => live(loaded, e.key)!.key))];
  const newChanges = [...new Set(events.filter((e) => e.type === 'change' && e.op === 'created').map((e) => e.key))];
  const proposedDecisions = loaded.records.filter((r) => r.type === 'decision' && r.valid && r.data.status === 'proposed' && keys.has(r.key)).map((r) => r.key);
  const blocked = loaded.records.filter((r) => r.type === 'change' && r.valid && r.data.status === 'blocked' && keys.has(r.key)).map((r) => r.key);
  return {
    key, since, days, subtree: keys.size, events,
    summary: { last, staleDays: last ? Math.floor((now - Date.parse(last)) / DAY) : null, events: events.length, byOp, doneChanges, newChanges, proposedDecisions, blocked },
  };
}

export function formatActivity(a: Activity, formatEvent: (e: StoreEvent) => string): string {
  const s = a.summary;
  const out = [`# activity of ${a.key} — last ${a.days} days, ${a.subtree - 1} records beneath it`];
  out.push(s.last ? `last moved ${s.last.replace('T', ' ').slice(0, 16)} (${s.staleDays} day${s.staleDays === 1 ? '' : 's'} ago)` : 'never moved');
  out.push(`${s.events} event${s.events === 1 ? '' : 's'} in the window${Object.keys(s.byOp).length ? `: ${Object.entries(s.byOp).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}`);
  if (s.doneChanges.length) out.push(`done: ${s.doneChanges.join(', ')}`);
  if (s.newChanges.length) out.push(`new: ${s.newChanges.join(', ')}`);
  if (s.blocked.length) out.push(`blocked now: ${s.blocked.join(', ')}`);
  if (s.proposedDecisions.length) out.push(`waiting on a person: ${s.proposedDecisions.join(', ')}`);
  if (a.events.length) {
    out.push('');
    for (const e of a.events.slice(-30)) out.push(formatEvent(e));
    if (a.events.length > 30) out.push(`… ${a.events.length - 30} earlier in the window`);
  }
  return out.join('\n') + '\n';
}
