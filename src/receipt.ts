// The receipt: what the store received, one line per record, for a person. Deterministic: the same events always
// read the same way, so an adapter can show it after every turn and a person learns to trust it.
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import { loadStore, resolve, type Loaded } from './records.js';

export interface Receipt {
  /** The last sequence number seen in the whole stream, whether or not it was included; the caller's next `since`. */
  seq: number;
  lines: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Events after `since`, folded to one line per record. With a session named, only what that session and the
 *  sessions it spawned (by `parent`, at any depth) wrote, and not their own session records: the person reads what
 *  their conversation landed, and a child's creation and log are bookkeeping, not a write to report. */
export function receipt(store: Store, opts: { since?: number; session?: string; loaded?: Loaded } = {}): Receipt {
  const all = readEvents(store, opts.since ?? 0);
  const last = readEvents(store).at(-1)?.seq ?? 0;
  const loaded = opts.loaded ?? loadStore(store);
  if (!opts.session) return { seq: last, lines: receiptLines(all, loaded) };
  const family = sessionFamily(loaded, opts.session);
  const mine = all.filter((e) => !!e.session && family.has(e.session) && !(e.type === 'session' && family.has(e.key)));
  return { seq: last, lines: receiptLines(mine, loaded) };
}

/** A session and every session descended from it through `parent`. */
export function sessionFamily(loaded: Loaded, session: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const r of loaded.records) {
    const parent = r.type === 'session' ? str(r.data.parent) : undefined;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), r.key]);
  }
  const family = new Set([session]);
  for (const key of family) for (const c of children.get(key) ?? []) family.add(c);
  return family;
}

/** One line per record, in order of first appearance: the strongest verb wins (removed > created > moved > set),
 *  the fields a set touched are listed, a status change shows the value it reached, a title is added when known. */
export function receiptLines(events: StoreEvent[], loaded: Loaded, opts: { counts?: boolean } = {}): string[] {
  const order: string[] = [];
  const byKey = new Map<string, { ops: Set<string>; fields: Set<string>; type: string; log: number; n: number }>();
  for (const e of events) {
    if (e.op === 'init' || e.op === 'write' || e.op === 'formatted') continue;
    let r = byKey.get(e.key);
    if (!r) {
      r = { ops: new Set(), fields: new Set(), type: e.type, log: 0, n: 0 };
      byKey.set(e.key, r);
      order.push(e.key);
    }
    r.n++;
    if (e.op === 'log') r.log++;
    else r.ops.add(e.op);
    for (const f of e.fields ?? []) r.fields.add(f);
  }
  const lines: string[] = [];
  for (const key of order) {
    const r = byKey.get(key)!;
    const res = resolve(loaded, key);
    const rec = res.status === 'ok' || res.status === 'alias' || res.status === 'invalid' ? res.rec : undefined;
    const title = str(rec?.data.name) ?? str(rec?.data.title) ?? str(rec?.data.gist);
    const verb = r.ops.has('removed') ? 'removed' : r.ops.has('created') ? 'created' : r.ops.has('moved') ? 'renamed to' : r.ops.has('bind') ? 'bound' : r.ops.has('observe') ? 'observed on' : r.ops.has('set') ? 'set' : r.fields.has('notes') ? 'noted' : r.log ? 'logged' : null;
    if (r.ops.has('applied') || r.ops.has('reverted')) {
      // a batch is one line on the record it was for, before the records it touched
      const what = [r.ops.has('applied') ? `applied as one batch (${[...r.fields].filter((f) => /writes$/.test(f)).join(', ') || 'writes'})` : '', r.ops.has('reverted') ? 'a batch reverted' : ''].filter(Boolean).join('; ');
      lines.push(`${key}: ${what}`);
      if (!verb) continue;
    }
    if (!verb) continue;
    if (r.type === 'session' && verb !== 'created' && verb !== 'removed') {
      // a session's own bookkeeping is one quiet line
      const what = [r.ops.has('bind') ? 'bound a change' : '', r.ops.has('observe') ? 'observed sources' : '', r.log ? (r.fields.has('notes') ? `noted` : `${r.log} log line${r.log === 1 ? '' : 's'}`) : ''].filter(Boolean).join(', ');
      lines.push(`${key}: ${what}`);
      continue;
    }
    let detail = '';
    if (verb === 'set') {
      const fields = [...r.fields].filter((f) => f !== 'references');
      const parts = fields.map((f) => (f === 'status' && rec ? `status → ${String(rec.data.status)}` : f));
      if (r.fields.has('references')) parts.push('references rewritten');
      detail = parts.length ? ` (${parts.join(', ')})` : '';
    }
    const named = title && verb !== 'set' ? ` — ${title.length > 90 ? title.slice(0, 87) + '…' : title}` : '';
    // with counts, a record written more than once says how many times: churn stays visible though the line holds only the end
    const times = opts.counts && r.n > 1 ? ` (${r.n} writes)` : '';
    lines.push(`${verb} ${key}${detail}${times}${named}`);
  }
  return lines;
}

export function formatReceipt(r: Receipt): string {
  return r.lines.length ? `pjman recorded:\n${r.lines.map((l) => `- ${l}`).join('\n')}\n` : '';
}
