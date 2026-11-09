// pjman order: move a change in its product's sequence, the roadmap's order. The sequence is the person's; the tool
// moves what it is told to and never rearranges the rest. The dashboard's reorder calls this same function.
// The stored list is the order as the person wrote it; status is the one record of done. Every reader of the order
// reads ahead(), which combines the two; only this file reads the field as the order (validate and the graph read it
// as the record's links).
import fs from 'node:fs';
import type { Store } from '../config.js';
import { loadStore, resolve, unresolved, unresolvedError, type Loaded, type Rec } from '../records.js';
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

/** The product's sequence as written, live change keys only, done entries kept: what a write moves within. */
function planned(loaded: Loaded, product: Rec): string[] {
  const raw = Array.isArray(product.data.sequence) ? product.data.sequence : [];
  const out: string[] = [];
  for (const k of raw) {
    const rec = live(loaded, k);
    if (rec && !out.includes(rec.key)) out.push(rec.key);
  }
  return out;
}

const isOpen = (r: Rec) => r.data.status !== 'done' && r.data.status !== 'dropped';

/** An entry is ahead while it is open or anything beneath it is: a done milestone keeps its place for its open
 *  children, which take theirs from it. */
function isAhead(loaded: Loaded, key: string): boolean {
  const rec = loaded.byKey.get(key)?.[0];
  if (!rec || isOpen(rec)) return true;
  return loaded.records.some((r) => {
    if (!r.valid || r.type !== 'change' || !isOpen(r)) return false;
    const seen = new Set<string>();
    for (let cur = live(loaded, r.data.parent); cur && !seen.has(cur.key); cur = live(loaded, cur.data.parent)) {
      if (cur.key === key) return true;
      seen.add(cur.key);
    }
    return false;
  });
}

/** What is ahead in the product's order: the sequence without the entries done or dropped with nothing open beneath
 *  them. The stored list keeps those, so a change reopened is back in its place. */
export function ahead(loaded: Loaded, product: Rec): string[] {
  return planned(loaded, product).filter((k) => isAhead(loaded, k));
}

/** The order as it reads now: what is ahead in the product's sequence, and how many open changes come after it as
 *  later. `ref` names the product (or a change or feature under it); none, the current project's product. */
export function sequenceOf(loaded: Loaded, ref: string | null): { product: string; sequence: string[]; later: number } {
  let product: Rec | undefined;
  if (ref) {
    const res = resolve(loaded, ref);
    if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, ref);
    product = res.rec.type === 'product' ? res.rec : res.rec.type === 'change' ? productOf(loaded, res.rec) : rootProductOf(loaded, res.rec);
    if (!product) throw new CliError(`${res.rec.key} is under no product`);
  } else {
    // the current project's product, else the store's only one
    const products = loaded.records.filter((r) => r.type === 'product' && r.valid);
    product = loaded.scope ? loaded.byKey.get(`product:${loaded.scope}`)?.[0] : products.length === 1 ? products[0] : undefined;
    if (!product) throw new CliError(`no product here: name one (pjman order <product>; ${products.map((p) => p.key).join(', ')})`);
  }
  const sequence = ahead(loaded, product);
  const later = loaded.records.filter((r) => r.valid && r.type === 'change' && isOpen(r) && !sequence.includes(r.key) && productOf(loaded, r)?.key === product!.key).length;
  return { product: product.key, sequence, later };
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
    if (!isAhead(loaded, rec.key)) throw new CliError(`${rec.key} is ${String(rec.data.status)}, no longer ahead in the order; place it against an entry that is`);
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
  return { product: product.key, change: change.key, sequence: seq.filter((k) => isAhead(loaded, k)), commit };
}
