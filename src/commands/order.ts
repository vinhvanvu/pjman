// pjman order: move a change in its product's sequence, the roadmap's order. The sequence is the person's; the tool
// moves what it is told to and never rearranges the rest. The dashboard's reorder calls this same function.
import fs from 'node:fs';
import type { Store } from '../config.js';
import { loadStore, type Loaded, type Rec } from '../records.js';
import { effectsOf, live, rootProductOf } from '../tree.js';
import { CliError } from '../util.js';
import { envelope, finishWrite, render, validateOrUndo } from '../write.js';

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

/** The product a change belongs to: its project's, else the product above the first feature it names. */
export function productOf(loaded: Loaded, change: Rec): Rec | undefined {
  const project = live(loaded, change.data.project);
  const viaProject = project && rootProductOf(loaded, project);
  if (viaProject) return viaProject;
  for (const e of effectsOf(change)) {
    const f = live(loaded, e.key);
    const p = f && rootProductOf(loaded, f);
    if (p) return p;
  }
  return undefined;
}

/** The product's sequence as live change keys, dropping what no longer resolves. */
export function sequenceOf(loaded: Loaded, product: Rec): string[] {
  const raw = Array.isArray(product.data.sequence) ? product.data.sequence : [];
  const out: string[] = [];
  for (const k of raw) {
    const rec = live(loaded, k);
    if (rec && !out.includes(rec.key)) out.push(rec.key);
  }
  return out;
}

export function order(store: Store, changeRaw: string, opts: OrderOpts = {}): OrderResult {
  const loaded = loadStore(store);
  const change = live(loaded, changeRaw.startsWith('change:') ? changeRaw : `change:${changeRaw}`);
  if (!change || change.type !== 'change') throw new CliError(`${changeRaw} does not resolve to a change`);
  const product = productOf(loaded, change);
  if (!product) throw new CliError(`${change.key} belongs to no product: its project has none and it names no feature`);
  const wants = [opts.before, opts.after, opts.first, opts.last, opts.later].filter((x) => x).length;
  if (wants !== 1) throw new CliError('say where: --before <change>, --after <change>, --first, --last or --later');

  const seq = sequenceOf(loaded, product).filter((k) => k !== change.key);
  const anchor = (raw: string): number => {
    const rec = live(loaded, raw.startsWith('change:') ? raw : `change:${raw}`);
    if (!rec || rec.type !== 'change') throw new CliError(`${raw} does not resolve to a change`);
    const i = seq.indexOf(rec.key);
    if (i < 0) throw new CliError(`${rec.key} is not on ${product.key}'s sequence; place it first`);
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
  const commit = finishWrite(store, `pjman: order ${change.key} in ${product.key}`, env.session, [{ op: 'set', key: product.key, type: 'product', path: product.path, fields: ['sequence'], writer: env.writer }]);
  return { product: product.key, change: change.key, sequence: seq, commit };
}
