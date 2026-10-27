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

/** Events after `since`, by the given session when one is named, folded to one line per record. */
export function receipt(store: Store, opts: { since?: number; session?: string; loaded?: Loaded } = {}): Receipt {
  const all = readEvents(store, opts.since ?? 0);
  const last = readEvents(store).at(-1)?.seq ?? 0;
  const mine = opts.session ? all.filter((e) => e.session === opts.session) : all;
  return { seq: last, lines: receiptLines(mine, opts.loaded ?? loadStore(store)) };
}

/** One line per record, in order of first appearance: the strongest verb wins (removed > created > moved > set),
 *  the fields a set touched are listed, a status change shows the value it reached, a title is added when known. */
export function receiptLines(events: StoreEvent[], loaded: Loaded): string[] {
  const order: string[] = [];
  const byKey = new Map<string, { ops: Set<string>; fields: Set<string>; type: string; log: number }>();
  for (const e of events) {
    if (e.op === 'init' || e.op === 'write' || e.op === 'formatted') continue;
    let r = byKey.get(e.key);
    if (!r) {
      r = { ops: new Set(), fields: new Set(), type: e.type, log: 0 };
      byKey.set(e.key, r);
      order.push(e.key);
    }
    if (e.op === 'log') r.log++;
    else r.ops.add(e.op);
    for (const f of e.fields ?? []) r.fields.add(f);
  }
  const lines: string[] = [];
  for (const key of order) {
    const r = byKey.get(key)!;
    const res = resolve(loaded, key);
    const rec = res.status === 'ok' || res.status === 'alias' || res.status === 'invalid' ? res.rec : undefined;
    const title = str(rec?.data.title) ?? str(rec?.data.name);
    const verb = r.ops.has('removed') ? 'removed' : r.ops.has('created') ? 'created' : r.ops.has('moved') ? 'renamed to' : r.ops.has('bind') ? 'bound' : r.ops.has('observe') ? 'observed on' : r.ops.has('set') ? 'set' : r.log ? 'logged' : null;
    if (r.ops.has('applied') || r.ops.has('reverted')) {
      // a batch is one line on the record it was for, before the records it touched
      const what = [r.ops.has('applied') ? `applied as one batch (${[...r.fields].filter((f) => /writes$/.test(f)).join(', ') || 'writes'})` : '', r.ops.has('reverted') ? 'a batch reverted' : ''].filter(Boolean).join('; ');
      lines.push(`${key}: ${what}`);
      if (!verb) continue;
    }
    if (!verb) continue;
    if (r.type === 'session' && verb !== 'created' && verb !== 'removed') {
      // a session's own bookkeeping is one quiet line
      const what = [r.ops.has('bind') ? 'bound a change' : '', r.ops.has('observe') ? 'observed sources' : '', r.log ? `${r.log} log line${r.log === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
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
    lines.push(`${verb} ${key}${detail}${named}`);
  }
  return lines;
}

export function formatReceipt(r: Receipt): string {
  return r.lines.length ? `pjman recorded:\n${r.lines.map((l) => `- ${l}`).join('\n')}\n` : '';
}
