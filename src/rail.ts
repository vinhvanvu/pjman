// The rail: one timeline model at any scope (decision activity-timeline/one-timeline-every-scope). The scope's axis
// decides the lanes and what a dot drills to. On a tree node (a change, a milestone, a feature, the product) the lanes
// are the units beneath it, a decision or a change, and each row carries the session that wrote it. On a session the
// lanes are the changes it touched, each row carries its change, the session's own lines are the trunk and a focus
// move is a switch. As the scope grows the model folds: lanes beyond a handful collapse into one, and events older
// than the window bucket by day with the health the scope already derives. The rail and the flat list (activity.ts)
// are two renderings of the same events; this is the model both the server and the dashboard read.
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import { labelOf } from './foundation.js';
import { eventKeysOf, resolve, type Loaded, type Rec } from './records.js';
import { ancestorsOf, descendantsOf, live } from './tree.js';

export type RailAxis = 'tree' | 'session';

export interface Lane {
  /** The lane's key on its axis; `more` for the folded lane. */
  id: string;
  kind: 'decision' | 'change' | 'more';
  title?: string;
  /** The unit's status as it stands now. */
  status?: string;
  /** When the lane was last touched inside the window. */
  last?: string;
  /** Rows in the lane inside the window. */
  count: number;
  /** On the folded lane: how many lanes it holds. */
  folded?: number;
}

export type RowKind = 'write' | 'decision' | 'line' | 'file' | 'switch' | 'bind';

export interface Row {
  seq: number;
  at: string;
  /** The lane, or null on the trunk: the scope's own events, a session's own lines. */
  lane: string | null;
  kind: RowKind;
  op: StoreEvent['op'];
  key: string;
  type: StoreEvent['type'];
  /** The written record's label, as it reads now. */
  title?: string;
  fields?: string[];
  /** What a move was: the status a set left, the change a session went to. */
  value?: string;
  writer?: string;
  session?: string;
  /** The key on the other axis: the session that wrote a row on a tree scope, the change a row is on on a session scope. */
  drill?: string;
  /** On a file row: the paths the session touched. */
  files?: string[];
  /** On a session's line: its words, from the session's log. */
  text?: string;
}

export interface Bucket {
  /** The day, as a date. */
  day: string;
  count: number;
  /** Rows per lane that day. */
  lanes: Record<string, number>;
  health: { moved: number; done: number; created: number; blocked: number; waiting: number };
}

export interface Rail {
  key: string;
  axis: RailAxis;
  /** The window: `from` inclusive, `to` exclusive. Rows fall inside it, buckets before it. */
  from: string;
  to: string;
  lanes: Lane[];
  rows: Row[];
  buckets: Bucket[];
  /** Events in the scope over its whole life, up to `to`. */
  total: number;
  /** The scope's last event, whenever it was. */
  last?: { seq: number; at: string };
}

export interface RailOpts {
  /** The window's length when `from` is not given; 14 days. */
  days?: number;
  from?: string;
  to?: string;
  now?: number;
  /** Read as of this event: nothing after it. */
  until?: number;
  /** Lanes kept apart before the rest fold into one; 5. */
  lanes?: number;
}

const DAY = 86_400_000;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function rail(store: Store, loaded: Loaded, keyRaw: string, opts: RailOpts = {}): Rail {
  const res = resolve(loaded, keyRaw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new Error(`${keyRaw} has no record`);
  const scope = res.rec;
  const axis: RailAxis = scope.type === 'session' ? 'session' : 'tree';
  const now = opts.now ?? Date.now();
  const to = opts.to ? new Date(Date.parse(opts.to)).toISOString() : new Date(now).toISOString();
  const from = opts.from ? new Date(Date.parse(opts.from)).toISOString() : new Date(Date.parse(to) - (opts.days ?? 14) * DAY).toISOString();
  const lanesMax = opts.lanes ?? 5;

  const all = readEvents(store).filter((e) => (opts.until === undefined || e.seq <= opts.until) && e.at < to);
  const events = axis === 'tree' ? treeEvents(loaded, scope, all) : all.filter((e) => e.session === scope.key || e.key === scope.key);

  // the lane a record's events fall in: the unit itself when it is a lane, else the nearest lane above it
  const candidates = axis === 'tree' ? treeLanes(loaded, scope) : new Map<string, Rec>();
  const laneOf = new Map<string, string | null>();
  const laneFor = (e: StoreEvent): string | null => {
    if (laneOf.has(e.key)) return laneOf.get(e.key)!;
    let lane: string | null = null;
    if (axis === 'session') {
      const change = changeOf(loaded, e);
      lane = change && change.key !== scope.key ? change.key : null;
    } else {
      const rec = live(loaded, e.key);
      const k = rec?.key ?? e.key;
      if (k !== scope.key) {
        if (candidates.has(k)) lane = k;
        else if (rec) lane = ancestorsOf(loaded, k).find((a) => candidates.has(a)) ?? null;
      }
    }
    laneOf.set(e.key, lane);
    return lane;
  };
  // on a session, a bind or a focus names its change outright
  const laneOfEvent = (e: StoreEvent): string | null => (axis === 'session' && e.key === scope.key && e.value?.startsWith('change:') ? (live(loaded, e.value)?.key ?? e.value) : laneFor(e));

  const inWindow = events.filter((e) => e.at >= from);
  const touched = new Map<string, { last: string; count: number }>();
  for (const e of inWindow) {
    const lane = laneOfEvent(e);
    if (!lane) continue;
    const t = touched.get(lane) ?? { last: e.at, count: 0 };
    t.count += 1;
    if (e.at > t.last) t.last = e.at;
    touched.set(lane, t);
  }
  // lanes in order of last touch; beyond the handful, the rest fold into one
  const ordered = [...touched.entries()].sort((a, b) => (a[1].last < b[1].last ? 1 : a[1].last > b[1].last ? -1 : 0));
  const kept = ordered.slice(0, lanesMax);
  const folded = ordered.slice(lanesMax);
  const foldedIds = new Set(folded.map(([id]) => id));
  const lanes: Lane[] = kept.map(([id, t]) => {
    const rec = live(loaded, id);
    return { id, kind: rec?.type === 'decision' ? 'decision' : 'change', title: rec ? labelOf(rec.data, rec.key) : undefined, status: rec ? str(rec.data.status) : undefined, last: t.last, count: t.count };
  });
  if (folded.length) lanes.push({ id: 'more', kind: 'more', last: folded[0][1].last, count: folded.reduce((n, [, t]) => n + t.count, 0), folded: folded.length });
  const placed = (lane: string | null): string | null => (lane && foldedIds.has(lane) ? 'more' : lane);

  const observed = axis === 'session' && Array.isArray(scope.data.observed) ? (scope.data.observed as { from?: string; to?: string; at?: string }[]) : [];
  const lines = axis === 'session' ? logLines(scope.body) : [];
  const claimed = new Set<{ at: string; text: string }>();
  const rows: Row[] = inWindow.map((e) => {
    const lane = laneOfEvent(e);
    const rec = live(loaded, e.key);
    const kind = kindOf(axis, scope, e);
    const row: Row = { seq: e.seq, at: e.at, lane: placed(lane), kind, op: e.op, key: e.key, type: e.type, title: rec ? labelOf(rec.data, rec.key) : undefined, fields: e.fields, value: e.value, writer: e.writer, session: e.session };
    const drill = axis === 'tree' ? e.session : lane;
    if (drill) row.drill = drill;
    if (kind === 'line' && e.key === scope.key) {
      // the line's words, from the session's log: the entry nearest the event's moment, each entry read once
      const t = Date.parse(e.at);
      let near: { at: string; text: string } | undefined;
      let gap = 2000;
      for (const l of lines) {
        const d = Math.abs(Date.parse(l.at) - t);
        if (!claimed.has(l) && d < gap) [near, gap] = [l, d];
      }
      if (near) {
        claimed.add(near);
        row.text = near.text;
      }
    }
    if (kind === 'file') {
      // the edge the write observed, from the record: the files it names, and the change it was on as the row's lane
      const near = observed.filter((o) => o.at && Math.abs(Date.parse(o.at) - Date.parse(e.at)) < 2000);
      const files = near.flatMap((o) => [o.from, o.to]).filter((k): k is string => !!k && k.startsWith('file:')).map((k) => k.slice('file:'.length));
      if (files.length) row.files = [...new Set(files)];
      const on = near.map((o) => o.from).find((k) => k?.startsWith('change:'));
      if (on && axis === 'session') {
        const change = live(loaded, on)?.key ?? on;
        row.lane = placed(change);
        row.drill = change;
      }
    }
    return row;
  });

  // older than the window: one bucket a day, carrying what the day moved
  const byDay = new Map<string, Bucket>();
  for (const e of events) {
    if (e.at >= from) break;
    const day = e.at.slice(0, 10);
    const b = byDay.get(day) ?? { day, count: 0, lanes: {}, health: { moved: 0, done: 0, created: 0, blocked: 0, waiting: 0 } };
    b.count += 1;
    const lane = placed(laneOfEvent(e)) ?? 'trunk';
    b.lanes[lane] = (b.lanes[lane] ?? 0) + 1;
    if (e.op === 'created' && e.type === 'change') b.health.created += 1;
    if (e.type === 'decision' && (e.op === 'created' || e.value === 'proposed')) b.health.waiting += 1;
    if (e.op === 'set' && e.value && e.fields?.includes('status')) {
      b.health.moved += 1;
      if (e.value === 'done') b.health.done += 1;
      if (e.value === 'blocked') b.health.blocked += 1;
    }
    byDay.set(day, b);
  }

  const last = events.at(-1);
  return { key: scope.key, axis, from, to, lanes, rows, buckets: [...byDay.values()], total: events.length, last: last && { seq: last.seq, at: last.at } };
}

/** The events of a tree node: everything beneath it, under every key each record ever had. */
function treeEvents(loaded: Loaded, scope: Rec, all: StoreEvent[]): StoreEvent[] {
  const keys = new Set<string>([scope.key, ...descendantsOf(loaded, scope.key)]);
  for (const k of [...keys]) {
    const r = live(loaded, k);
    if (r) for (const e of eventKeysOf(r)) keys.add(e);
  }
  return all.filter((e) => keys.has(e.key));
}

/** The units that can be lanes beneath a tree node: on a change its decisions; on a milestone its decisions and its
 *  children; on a feature or the product every change beneath it. */
function treeLanes(loaded: Loaded, scope: Rec): Map<string, Rec> {
  const out = new Map<string, Rec>();
  for (const k of descendantsOf(loaded, scope.key)) {
    const r = live(loaded, k);
    if (!r) continue;
    if (r.type === 'decision' && r.changeKey && live(loaded, r.changeKey)?.key === scope.key) out.set(r.key, r);
    else if (r.type === 'change' && (scope.type !== 'change' || live(loaded, r.data.parent)?.key === scope.key)) out.set(r.key, r);
  }
  return out;
}

/** A session's log as it is written: one line an entry, `- <when> — <text>`. */
function logLines(body: string): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  for (const m of body.matchAll(/^- (\d{4}-\d\d-\d\dT[^ ]+) — (.*)$/gm)) out.push({ at: m[1]!, text: m[2]!.trim() });
  return out;
}

/** The change an event is on: the change itself, or the one its decision sits on. */
function changeOf(loaded: Loaded, e: StoreEvent): Rec | undefined {
  if (e.type === 'change') return live(loaded, e.key);
  if (e.type === 'decision') {
    const d = live(loaded, e.key);
    return d?.changeKey ? live(loaded, d.changeKey) : undefined;
  }
  return undefined;
}

function kindOf(axis: RailAxis, scope: Rec, e: StoreEvent): RowKind {
  if (e.op === 'log') return 'line';
  if (e.op === 'observe') return 'file';
  if (axis === 'session' && e.key === scope.key) {
    if (e.op === 'bind') return 'bind';
    if (e.op === 'set' && e.fields?.includes('focus')) return 'switch';
  }
  if (e.type === 'decision' && (e.op === 'created' || !!e.value)) return 'decision';
  return 'write';
}
