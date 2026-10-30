// Keys and the link rule. A key is `kind:rest`. A link opens the node in the current lens when it lives there, else
// in the node's home lens; everything that is not a node of the tree goes through the getter.
import type { Lens } from '@/data/contract';

export const kindOf = (key: string): string => key.slice(0, key.indexOf(':'));
export const restOf = (key: string): string => key.slice(key.indexOf(':') + 1);

/** Kinds keyed beneath a product: `feature:<product>/<slug>`, `change:<product>/<slug>`, `decision:<product>/<change>/<slug>`,
 *  `aspect:<product>/<slug>` and its places `aspect:<product>/<aspect>/<place>`. */
const SCOPED = new Set(['feature', 'change', 'decision', 'aspect']);

/** The product segment of a scoped key, or undefined. */
export function productOf(key: string): string | undefined {
  if (!SCOPED.has(kindOf(key))) return undefined;
  const rest = restOf(key);
  const parts = rest.split('/');
  if (kindOf(key) === 'decision') return parts.length === 3 ? parts[0] : undefined; // `p/c/s`; a store-level `/s` or product-level `p/s` has no change
  if (kindOf(key) === 'aspect') return parts.length >= 2 ? parts[0] : undefined; // an aspect `p/a`, a place `p/a/x`
  return parts.length === 2 ? parts[0] : undefined;
}

/** The short form people say: the slug (the product segment dropped, since the page is inside a product; pass
 *  `product` to keep the segment of another product), or `#7` for a ticket. */
export function short(key: string, product?: string): string {
  const rest = restOf(key);
  const gh = /^(.+)#(\d+)$/.exec(rest);
  if (kindOf(key) === 'github-issue' && gh) return `#${gh[2]}`;
  const p = productOf(key);
  if (p && (!product || product === p || product === `product:${p}`)) return rest.slice(p.length + 1);
  return rest;
}

/** The change a decision sits on, from its key: `decision:<product>/<change>/<slug>`; undefined at product or store level. */
export function changeOfDecision(key: string): string | undefined {
  if (kindOf(key) !== 'decision') return undefined;
  const parts = restOf(key).split('/');
  return parts.length === 3 ? `change:${parts[0]}/${parts[1]}` : undefined;
}

/** Where a key lives. A change has no home lens of its own: it keeps the lens it is seen in. A project has no lens:
 *  it is a record the getter page shows. */
export function homeLens(key: string): Lens | undefined {
  return kindOf(key) === 'feature' ? 'feature' : undefined;
}

/** The aspect a key names: the aspect itself, or the aspect a place sits under. Undefined for any other key. */
export function aspectOf(key: string): string | undefined {
  if (kindOf(key) !== 'aspect') return undefined;
  const parts = restOf(key).split('/');
  return parts.length >= 2 ? `aspect:${parts[0]}/${parts[1]}` : undefined;
}

export type Target =
  | { kind: 'node'; lens: Lens; node: string; aspect?: string }
  | { kind: 'session'; id: string }
  | { kind: 'get'; key: string }
  | { kind: 'external'; url: string };

/** The link rule. */
export function targetOf(key: string, lens: Lens): Target {
  const kind = kindOf(key);
  if (kind === 'session') return { kind: 'session', id: restOf(key) };
  if (kind === 'url') return { kind: 'external', url: restOf(key) };
  if (kind === 'product' || kind === 'change') return { kind: 'node', lens, node: key };
  // an aspect is read on its product's map, selected there (decision aspects-dashboard/aspect-is-a-map-lens)
  const aspect = aspectOf(key);
  const p = productOf(key);
  if (aspect && p) return { kind: 'node', lens: 'feature', node: `product:${p}`, aspect };
  const home = homeLens(key);
  if (home) return { kind: 'node', lens: home, node: key };
  return { kind: 'get', key };
}

/** Is this key a node of the tree a lens can stand on. */
export const isNodeKey = (key: string): boolean => ['product', 'feature', 'change'].includes(kindOf(key));
