// The roadmap's order as it reads (change:repo-hygiene split it from the write in ops/order): the product a change
// belongs to, and what is ahead in that product's sequence. The stored list is the order as the person wrote it;
// status is the one record of done. Every reader of the order reads ahead(), which combines the two; only this file
// and the write read the field as the order (validate and the graph read it as the record's links).
import { memo, ofType, resolve, unresolvedError, type Loaded, type Rec } from '../store/records.js';
import { CliError } from '../store/util.js';
import { effectsOf, live, rootProductOf } from './tree.js';

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
export function planned(loaded: Loaded, product: Rec): string[] {
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
export function isAhead(loaded: Loaded, key: string): boolean {
  const rec = loaded.byKey.get(key)?.[0];
  if (!rec || isOpen(rec)) return true;
  return openBeneath(loaded).has(key);
}

/** The keys above an open change on its chain of parents. */
const openBeneath = (loaded: Loaded): Set<string> =>
  memo(loaded, 'open-beneath', () => {
    const out = new Set<string>();
    for (const r of ofType(loaded, 'change')) {
      if (!r.valid || !isOpen(r)) continue;
      const seen = new Set<string>();
      for (let cur = live(loaded, r.data.parent); cur && !seen.has(cur.key); cur = live(loaded, cur.data.parent)) {
        out.add(cur.key);
        seen.add(cur.key);
      }
    }
    return out;
  });

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
    product =
      res.rec.type === 'product'
        ? res.rec
        : res.rec.type === 'change'
          ? productOf(loaded, res.rec)
          : rootProductOf(loaded, res.rec);
    if (!product) throw new CliError(`${res.rec.key} is under no product`);
  } else {
    // the current project's product, else the store's only one
    const products = loaded.records.filter((r) => r.type === 'product' && r.valid);
    product = loaded.scope
      ? loaded.byKey.get(`product:${loaded.scope}`)?.[0]
      : products.length === 1
        ? products[0]
        : undefined;
    if (!product)
      throw new CliError(`no product here: name one (pjman order <product>; ${products.map((p) => p.key).join(', ')})`);
  }
  const sequence = ahead(loaded, product);
  const later = loaded.records.filter(
    (r) =>
      r.valid &&
      r.type === 'change' &&
      isOpen(r) &&
      !sequence.includes(r.key) &&
      productOf(loaded, r)?.key === product.key,
  ).length;
  return { product: product.key, sequence, later };
}
