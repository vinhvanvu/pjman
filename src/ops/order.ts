// pjman order: move a change in its product's sequence, the roadmap's order. The sequence is the person's; the tool
// moves what it is told to and never rearranges the rest. The dashboard's reorder calls this same function. What the
// order reads as (the product of a change, what is ahead) is model/order.
import fs from 'node:fs';
import type { Store } from '../store/config.js';
import { loadStore, resolve, unresolvedError } from '../store/records.js';
import { CliError } from '../store/util.js';
import { isAhead, planned, productOf } from '../model/order.js';
import { envelope, finishWrite, render, validateOrUndo } from './write.js';

export interface OrderOpts {
  before?: string;
  after?: string;
  first?: boolean;
  last?: boolean;
  /** Take the change off the sequence: it comes after it, as later. */
  later?: boolean;
  session?: string;
  writer?: string;
}

export interface OrderResult {
  product: string;
  change: string;
  sequence: string[];
  commit: string | null;
}

export function order(store: Store, changeRaw: string, opts: OrderOpts = {}): OrderResult {
  const loaded = loadStore(store);
  const changeRef = changeRaw.startsWith('change:') ? changeRaw : `change:${changeRaw}`;
  const changeRes = resolve(loaded, changeRef);
  if (changeRes.status !== 'ok' && changeRes.status !== 'alias') throw unresolvedError(changeRes, changeRef);
  const change = changeRes.rec;
  const product = productOf(loaded, change);
  if (!product) throw new CliError(`${change.key} belongs to no product: its project has none and it names no feature`);
  const wants = [opts.before, opts.after, opts.first, opts.last, opts.later].filter((x) => x).length;
  if (wants !== 1) throw new CliError('say where: --before <change>, --after <change>, --first, --last or --later');

  const seq = planned(loaded, product).filter((k) => k !== change.key);
  const anchor = (raw: string): number => {
    const ref = raw.startsWith('change:') ? raw : `change:${raw}`;
    const res = resolve(loaded, ref, product.productSlug);
    if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, ref);
    const rec = res.rec;
    const i = seq.indexOf(rec.key);
    if (i < 0) throw new CliError(`${rec.key} is not on ${product.key}'s sequence; place it first`);
    if (!isAhead(loaded, rec.key))
      throw new CliError(
        `${rec.key} is ${String(rec.data.status)}, no longer ahead in the order; place it against an entry that is`,
      );
    return i;
  };
  if (opts.before) seq.splice(anchor(opts.before), 0, change.key);
  else if (opts.after) seq.splice(anchor(opts.after) + 1, 0, change.key);
  else if (opts.first) seq.unshift(change.key);
  else if (opts.last) seq.push(change.key);
  // --later: the change is simply left off

  const before = fs.readFileSync(product.abs, 'utf8');
  const data: Record<string, unknown> = { ...product.data };
  if (seq.length) data.sequence = seq;
  else delete data.sequence;
  fs.writeFileSync(product.abs, render('product', data, product.body));
  try {
    validateOrUndo(store, [product.path], []);
  } catch (e) {
    fs.writeFileSync(product.abs, before);
    throw e;
  }
  const env = envelope(opts);
  const commit = finishWrite(store, `pjman: order ${change.key} in ${product.key}`, env.session, [
    { op: 'set', key: product.key, type: 'product', path: product.path, fields: ['sequence'], writer: env.writer },
  ]);
  return { product: product.key, change: change.key, sequence: seq.filter((k) => isAhead(loaded, k)), commit };
}
