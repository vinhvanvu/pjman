// Identity has one source. Which product a page is in, which node it stands on and what the crumb says come from the
// URL, or from the page's own scope once it has arrived. Never from a guess: not the store's list of products, not a
// previous page's scope kept as placeholder while the next loads. Content may keep a placeholder; identity may not.
// Every place that names the page's product or node goes through here, so the rule has one implementation.
import type { Scope } from '@/data/contract';

export interface Identified {
  key: string;
  title?: string;
  name?: string;
}

/** The scope only when it is this page's own: placeholder data from the previous page is not. */
export const freshScope = (scope: Scope | undefined, isPlaceholder: boolean): Scope | undefined =>
  isPlaceholder ? undefined : scope;

/** The product the page is in: the URL's node when it is a product; else what the fresh scope stands beneath; else
 *  unknown. `known` are the store's products, used only to name a product the URL already identified. */
export function pageProduct(
  node: string | undefined,
  fresh: Scope | undefined,
  known: Identified[] = [],
): Identified | undefined {
  if (node?.startsWith('product:')) return known.find((p) => p.key === node) ?? { key: node };
  const first = fresh?.crumbs[0];
  if (first?.key.startsWith('product:')) return first;
  if (fresh?.node?.key.startsWith('product:')) return fresh.node;
  return undefined;
}
