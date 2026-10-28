// The bridge's timeline: the product's events over a window, the ticks the transport draws and steps through
// (decision live-sessions/stage-strip-transport). It is always read as of now, since it is the axis a past moment is
// placed on. An event belongs to a product when the record it wrote does: a change by its project or the features it
// names, a decision through its change, a feature or project by the product at the top of its chain, a session by
// the change it is on. A record that no longer resolves is placed by its key's product segment.
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import { productOf } from './commands/order.js';
import type { Loaded, Rec } from './records.js';
import { live, rootProductOf } from './tree.js';

export interface TimelineEvent {
  seq: number;
  at: string;
  op: StoreEvent['op'];
  key: string;
  type: StoreEvent['type'];
  fields?: string[];
  writer?: string;
  session?: string;
  /** The written record's title (a session's: the title of the change it is on), as it reads now. */
  title?: string;
  /** A decision was opened or its status moved: the ticks the transport marks. */
  decision: boolean;
}

export interface Timeline {
  product: string | null;
  from: string;
  to: string;
  events: TimelineEvent[];
  /** The store's last event, whatever its product: what a paused page counts arrivals against. */
  last?: { seq: number; at: string };
}

export interface TimelineOpts {
  product?: string;
  /** The window, as instants; `from` inclusive, `to` exclusive. Absent, the last day up to now. */
  from?: string;
  to?: string;
  now?: number;
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
    const title = rec && (rec.type === 'session' ? str(sessionChange(loaded, rec)?.data.title) : str(rec.data.title) ?? str(rec.data.name));
    const inProduct = !productKey || (rec ? productOfRecord(loaded, rec)?.key === productKey : keySegment(key) === slug);
    p = { inProduct, title };
    placed.set(key, p);
    return p;
  };

  const all = readEvents(store);
  const events: TimelineEvent[] = [];
  for (const e of all) {
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
      title: p.title,
      decision: e.type === 'decision' && (e.op === 'created' || e.op === 'applied' || !!e.fields?.includes('status')),
    });
  }
  const last = all.at(-1);
  return { product: productKey, from, to, events, last: last && { seq: last.seq, at: last.at } };
}
