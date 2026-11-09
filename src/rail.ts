// The rail: one timeline model at any scope (decision activity-timeline/one-timeline-every-scope). The scope's axis
// decides the lanes and what a dot drills to. On a tree node (a change, a milestone, a feature, the product) the lanes
// are the units beneath it, a decision or a change, and each row carries the session that wrote it. On a session the
// lanes are the changes it touched, each row carries its change, the session's own lines are the trunk and a focus
// move is a switch. The model folds: lanes beyond a handful collapse into one. What is shown at once is a page
// (decision rail-pages/pages-not-windows): the last `limit` rows that pass the filter, or the page before a row, and
// every older row buckets by day with the health the scope already derives, so a rollup page opens short and the
// shape of the past stays in one strip. The rail and the flat list (activity.ts) are two renderings of the same
// events; this is the model both the server and the dashboard read.
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
  /** What the unit is called: its name, else its line. */
  label?: string;
  /** The unit's status as it stands now. */
  status?: string;
  /** When the lane was last touched, over the scope's life. */
  last?: string;
  /** Rows in the lane over the scope's life. */
  count: number;
  /** Of those, the writes: a record written, a decision moved, a file touched; a lane only read or bound has none. */
  writes: number;
  /** On the folded lane: how many lanes it holds. */
  folded?: number;
}

export type RowKind = 'write' | 'decision' | 'line' | 'file' | 'switch' | 'bind';
/** The kinds that are writes: what a lane's write count counts. */
const WRITE_KINDS: ReadonlySet<RowKind> = new Set(['write', 'decision', 'file']);

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
  label?: string;
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
  /** The rows' span: `from` the bound asked for, else the oldest row's moment; `to` exclusive. Buckets lie before it. */
  from: string;
  to: string;
  /** Every lane the scope has, over its life; the filter never hides one. */
  lanes: Lane[];
  /** The page: the rows that pass the filter, oldest first. */
  rows: Row[];
  /** The passing rows older than the page, a bucket a day. */
  buckets: Bucket[];
  /** Rows that pass the filter over the scope's whole life, up to `to`. */
  total: number;
  /** Passing rows older than the page: what the buckets hold. */
  earlier: number;
  /** The scope's last event, whenever it was. */
  last?: { seq: number; at: string };
  /** On a change: every session that touched it over its life, oldest first, so its page can name who worked it. */
  sessions?: RailSession[];
}

export interface RailSession {
  key: string;
  agent?: string;
  onBehalfOf?: string;
  started?: string;
  /** Its first and last event on the change, and how many. */
  first: string;
  last: string;
  count: number;
}

export interface RailOpts {
  /** The page: the last `limit` passing rows (every one when unset), before the row `before` when paging back. */
  limit?: number;
  before?: number;
  /** Bounds: rows at or after `from` (loading the pages down to a day), before `to`. */
  from?: string;
  to?: string;
  now?: number;
  /** Read as of this event: nothing after it. */
  until?: number;
  /** Lanes kept apart before the rest fold into one; 5. */
  fold?: number;
  /** The filter: only rows in these lanes (`trunk` the scope's own, `more` the folded), only rows of these kinds. */
  lanes?: string[];
  kinds?: RowKind[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function rail(store: Store, loaded: Loaded, keyRaw: string, opts: RailOpts = {}): Rail {
  const res = resolve(loaded, keyRaw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new Error(`${keyRaw} has no record`);
  const scope = res.rec;
  const axis: RailAxis = scope.type === 'session' ? 'session' : 'tree';
  const now = opts.now ?? Date.now();
  const to = opts.to ? new Date(Date.parse(opts.to)).toISOString() : new Date(now).toISOString();
  const from = opts.from ? new Date(Date.parse(opts.from)).toISOString() : undefined;
  const lanesMax = opts.fold ?? 5;

  const all = readEvents(store).filter((e) => (opts.until === undefined || e.seq <= opts.until) && e.at < to);
  const events = axis === 'tree' ? treeEvents(loaded, scope, all) : all.filter((e) => e.session === scope.key || e.key === scope.key);
  // on a change, the files its sessions touched while on it: an observe is the session's, so it is found by its edges
  if (scope.type === 'change') events.push(...fileEvents(loaded, scope, all));
  events.sort((a, b) => a.seq - b.seq);

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

  // the lanes over the scope's life, so the filter and the page never hide one
  const touched = new Map<string, { last: string; count: number; writes: number }>();
  for (const e of events) {
    const lane = laneOfEvent(e);
    if (!lane) continue;
    const t = touched.get(lane) ?? { last: e.at, count: 0, writes: 0 };
    t.count += 1;
    if (WRITE_KINDS.has(kindOf(axis, scope, e))) t.writes += 1;
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
    return { id, kind: rec?.type === 'decision' ? 'decision' : 'change', label: rec ? labelOf(rec.data, rec.key) : undefined, status: rec ? str(rec.data.status) : undefined, last: t.last, count: t.count, writes: t.writes };
  });
  if (folded.length) lanes.push({ id: 'more', kind: 'more', last: folded[0][1].last, count: folded.reduce((n, [, t]) => n + t.count, 0), writes: folded.reduce((n, [, t]) => n + t.writes, 0), folded: folded.length });
  const placed = (lane: string | null): string | null => (lane && foldedIds.has(lane) ? 'more' : lane);

  const observed = axis === 'session' ? observedOf(scope) : [];
  const lines = axis === 'session' ? logLines(scope.body) : [];
  const claimed = new Set<{ at: string; text: string }>();
  const toRow = (e: StoreEvent): Row => {
    const lane = laneOfEvent(e);
    const rec = live(loaded, e.key);
    const kind = kindOf(axis, scope, e);
    const row: Row = { seq: e.seq, at: e.at, lane: placed(lane), kind, op: e.op, key: e.key, type: e.type, label: rec ? labelOf(rec.data, rec.key) : undefined, fields: e.fields, value: e.value, writer: e.writer, session: e.session };
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
      // on a change, the session's own edges, and of those only the ones from this change
      const edges = axis === 'session' ? observed : observedOf(live(loaded, e.key)).filter((o) => fromKey(loaded, o) === scope.key);
      const near = edges.filter((o) => o.at && Math.abs(Date.parse(o.at) - Date.parse(e.at)) < NEAR_MS);
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
  };

  // the filter, by the row's lane as placed and its kind
  const onlyLanes = opts.lanes && new Set(opts.lanes);
  const onlyKinds = opts.kinds && new Set(opts.kinds);
  const passing = events.map(toRow).filter((r) => (!onlyLanes || onlyLanes.has(r.lane ?? 'trunk')) && (!onlyKinds || onlyKinds.has(r.kind)));

  // the page: the last `limit` passing rows inside the bounds; every passing row before the page buckets by day
  const bounded = passing.filter((r) => (from === undefined || r.at >= from) && (opts.before === undefined || r.seq < opts.before));
  const rows = opts.limit ? bounded.slice(-opts.limit) : bounded;
  const edge = rows[0]?.seq ?? opts.before;
  const older = edge === undefined ? (rows.length ? [] : passing) : passing.filter((r) => r.seq < edge);
  const byDay = new Map<string, Bucket>();
  for (const r of older) {
    const day = r.at.slice(0, 10);
    const b = byDay.get(day) ?? { day, count: 0, lanes: {}, health: { moved: 0, done: 0, created: 0, blocked: 0, waiting: 0 } };
    b.count += 1;
    const lane = r.lane ?? 'trunk';
    b.lanes[lane] = (b.lanes[lane] ?? 0) + 1;
    if (r.op === 'created' && r.type === 'change') b.health.created += 1;
    if (r.type === 'decision' && (r.op === 'created' || r.value === 'proposed')) b.health.waiting += 1;
    if (r.op === 'set' && r.value && r.fields?.includes('status')) {
      b.health.moved += 1;
      if (r.value === 'done') b.health.done += 1;
      if (r.value === 'blocked') b.health.blocked += 1;
    }
    byDay.set(day, b);
  }

  const last = events.at(-1);
  const out: Rail = { key: scope.key, axis, from: from ?? rows[0]?.at ?? to, to, lanes, rows, buckets: [...byDay.values()], total: passing.length, earlier: older.length, last: last && { seq: last.seq, at: last.at } };
  if (scope.type === 'change') out.sessions = sessionsOn(loaded, events);
  return out;
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

/** The sessions that wrote the events, each once, in the order they first did. */
function sessionsOn(loaded: Loaded, events: StoreEvent[]): RailSession[] {
  const by = new Map<string, RailSession>();
  for (const e of events) {
    if (!e.session) continue;
    const s = by.get(e.session);
    if (s) {
      s.last = e.at;
      s.count += 1;
      continue;
    }
    const rec = live(loaded, e.session);
    by.set(e.session, { key: rec?.key ?? e.session, agent: str(rec?.data.agent), onBehalfOf: str(rec?.data.on_behalf_of), started: str(rec?.data.started), first: e.at, last: e.at, count: 1 });
  }
  return [...by.values()];
}

type Observed = { from?: string; to?: string; at?: string };
/** How far apart an observe event and the edge it wrote can be. */
const NEAR_MS = 2000;

/** A session's observed edges, as its record holds them. */
function observedOf(rec: Rec | undefined): Observed[] {
  return rec && Array.isArray(rec.data.observed) ? (rec.data.observed as Observed[]).filter((o) => !!o && typeof o === 'object') : [];
}

/** The change an edge is from, under the key it has now. */
function fromKey(loaded: Loaded, o: Observed): string | undefined {
  return o.from ? live(loaded, o.from)?.key : undefined;
}

/** The observe events that touched a file from this change: each session's observe whose edges at that moment run from
 *  the change to a file. */
function fileEvents(loaded: Loaded, scope: Rec, all: StoreEvent[]): StoreEvent[] {
  const edges = new Map<string, Observed[]>();
  const edgesOf = (key: string): Observed[] => {
    if (!edges.has(key)) edges.set(key, observedOf(live(loaded, key)).filter((o) => o.to?.startsWith('file:') && fromKey(loaded, o) === scope.key));
    return edges.get(key)!;
  };
  return all.filter((e) => e.op === 'observe' && e.type === 'session' && edgesOf(e.key).some((o) => o.at && Math.abs(Date.parse(o.at) - Date.parse(e.at)) < NEAR_MS));
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
