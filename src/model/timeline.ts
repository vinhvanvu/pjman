// The bridge's timeline: the product's events over a window, the ticks the transport draws and steps through
// (decision live-sessions/stage-strip-transport). It is always read as of now, since it is the axis a past moment is
// placed on. An event belongs to a product when the record it wrote does: a change by its project or the features it
// names, a decision through its change, a feature or project by the product at the top of its chain, a session by
// the change it is on. A record that no longer resolves is placed by its key's product segment.
import { execFileSync } from 'node:child_process';
import type { Store } from '../store/config.js';
import { readEvents, type StoreEvent } from '../store/events.js';
import { productOf } from '../ops/order.js';
import type { Loaded, Rec } from '../store/records.js';
import { live, rootProductOf } from './tree.js';
import { lineOf } from './foundation.js';

export interface TimelineEvent {
  seq: number;
  at: string;
  op: StoreEvent['op'];
  key: string;
  type: StoreEvent['type'];
  fields?: string[];
  writer?: string;
  session?: string;
  /** What the written record is called as it reads now: its name, else its line (a session's: its change's). */
  label?: string;
  /** A decision was opened or its status moved: the ticks the transport marks. */
  decision: boolean;
  /** On such a tick: the status the write left the decision in, read from its commit (proposed when opened,
   *  decided, superseded). Absent when the commit cannot be read. */
  status?: string;
  /** On any write to a decision: its status now, so a decision opened then can say whether it still waits. */
  statusNow?: string;
}

export interface Timeline {
  product: string | null;
  from: string;
  to: string;
  events: TimelineEvent[];
  /** The store's last event, whatever its product: where a pause holds. */
  last?: { seq: number; at: string };
  /** Asked with `after`: how many of the product's events came after that one, up to now, the window aside. */
  arrivedAfter?: number;
}

export interface TimelineOpts {
  product?: string;
  /** The window, as instants; `from` inclusive, `to` exclusive. Absent, the last day up to now. */
  from?: string;
  to?: string;
  now?: number;
  /** Count the product's events after this sequence number, up to now. */
  after?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const DAY = 24 * 60 * 60_000;

/** The product a record belongs to, when one does. */
export function productOfRecord(loaded: Loaded, rec: Rec): Rec | undefined {
  switch (rec.type) {
    case 'product':
      return rec;
    case 'feature':
    case 'project':
      return rootProductOf(loaded, rec);
    case 'aspect':
    case 'place':
    case 'release':
      return live(loaded, `product:${rec.productSlug}`);
    case 'change':
      return productOf(loaded, rec);
    case 'decision': {
      const c = live(loaded, rec.changeKey);
      return c ? productOf(loaded, c) : undefined;
    }
    case 'session': {
      const on = sessionChange(loaded, rec);
      if (on) return productOf(loaded, on);
      const project = live(loaded, rec.data.project);
      return project ? rootProductOf(loaded, project) : undefined;
    }
    default:
      return undefined;
  }
}

/** The change a session is on: its last bound change that still resolves. */
function sessionChange(loaded: Loaded, rec: Rec): Rec | undefined {
  const bound = Array.isArray(rec.data.changes) ? (rec.data.changes as unknown[]) : [];
  return bound
    .map((k) => live(loaded, k))
    .filter((r): r is Rec => !!r)
    .at(-1);
}

/** A record's status as a commit left it, by commit and path; a commit never changes, so what is read is kept. */
const statusAt = new Map<string, string | null>();

/** The statuses the writes left their decisions in, read from their commits in one batch for those not yet known. */
function readStatuses(root: string, wanted: { commit: string; path: string }[]): void {
  const fresh = [...new Set(wanted.map((w) => `${w.commit}:${w.path}`))].filter((k) => !statusAt.has(k));
  if (fresh.length === 0) return;
  let out: Buffer;
  try {
    out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: fresh.map((k) => `${k}\n`).join(''), maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    for (const k of fresh) statusAt.set(k, null);
    return;
  }
  // each answer is a header line, then that many bytes and a newline; one not found is the header alone
  let at = 0;
  for (const k of fresh) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const size = /^\S+ blob (\d+)$/.exec(header);
    if (!size) {
      statusAt.set(k, null);
      continue;
    }
    const body = out.subarray(at, at + Number(size[1])).toString('utf8');
    at += Number(size[1]) + 1;
    statusAt.set(k, /^status:\s*"?([a-z-]+)"?\s*$/m.exec(body)?.[1] ?? null);
  }
}

/** `change:shop/card-form` → `shop`; a flat key has no product segment. */
const keySegment = (key: string): string | undefined => {
  const rest = key.slice(key.indexOf(':') + 1);
  const i = rest.indexOf('/');
  return i > 0 ? rest.slice(0, i) : key.startsWith('product:') ? rest : undefined;
};

export function timeline(store: Store, loaded: Loaded, opts: TimelineOpts = {}): Timeline {
  const now = opts.now ?? Date.now();
  const to = opts.to ? new Date(Date.parse(opts.to)).toISOString() : new Date(now).toISOString();
  const from = opts.from ? new Date(Date.parse(opts.from)).toISOString() : new Date(Date.parse(to) - DAY).toISOString();
  const productKey = opts.product ? (opts.product.startsWith('product:') ? opts.product : `product:${opts.product}`) : null;
  const slug = productKey?.slice('product:'.length);

  const placed = new Map<string, { inProduct: boolean; title?: string }>();
  const place = (key: string) => {
    let p = placed.get(key);
    if (p) return p;
    const rec = live(loaded, key);
    const title = rec && (rec.type === 'session' ? lineOf(sessionChange(loaded, rec)?.data ?? {}) : str(rec.data.name) ?? lineOf(rec.data));
    const inProduct = !productKey || (rec ? productOfRecord(loaded, rec)?.key === productKey : keySegment(key) === slug);
    p = { inProduct, title };
    placed.set(key, p);
    return p;
  };

  const all = readEvents(store);
  const events: TimelineEvent[] = [];
  let arrivedAfter = opts.after === undefined ? undefined : 0;
  for (const e of all) {
    if (arrivedAfter !== undefined && e.seq > opts.after! && place(e.key).inProduct) arrivedAfter += 1;
    if (e.at < from || e.at >= to) continue;
    const p = place(e.key);
    if (!p.inProduct) continue;
    events.push({
      seq: e.seq,
      at: e.at,
      op: e.op,
      key: e.key,
      type: e.type,
      fields: e.fields,
      writer: e.writer,
      session: e.session,
      label: p.title,
      decision: e.type === 'decision' && (e.op === 'created' || e.op === 'applied' || !!e.fields?.includes('status')),
    });
  }
  // what each decision tick left its decision in, from the write's own commit
  const ticks = events.filter((e) => e.decision);
  const commitOf = new Map(all.filter((e) => e.commit).map((e) => [e.seq, { commit: e.commit!, path: e.path }]));
  readStatuses(store.root, ticks.flatMap((e) => (commitOf.has(e.seq) ? [commitOf.get(e.seq)!] : [])));
  for (const e of events) {
    if (e.type !== 'decision') continue;
    const c = commitOf.get(e.seq);
    const s = e.decision && c ? statusAt.get(`${c.commit}:${c.path}`) : undefined;
    if (s) e.status = s;
    const now = str(live(loaded, e.key)?.data.status);
    if (now) e.statusNow = now;
  }
  const last = all.at(-1);
  return { product: productKey, from, to, events, last: last && { seq: last.seq, at: last.at }, ...(arrivedAfter === undefined ? {} : { arrivedAfter }) };
}
