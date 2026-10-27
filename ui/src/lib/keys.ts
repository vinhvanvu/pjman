// Keys and the link rule. A key is `kind:rest`. A link opens the node in the current lens when it lives there, else
// in the node's home lens; everything that is not a node of the tree goes through the getter.
import type { Lens } from '@/data/contract';

export const kindOf = (key: string): string => key.slice(0, key.indexOf(':'));
export const restOf = (key: string): string => key.slice(key.indexOf(':') + 1);

/** The short form people say: the slug, or `#7` for a ticket. */
export function short(key: string): string {
  const rest = restOf(key);
  const gh = /^(.+)#(\d+)$/.exec(rest);
  return kindOf(key) === 'github-issue' && gh ? `#${gh[2]}` : rest;
}

/** Where a key lives. A change has no home lens of its own: it keeps the lens it is seen in. A project has no lens:
 *  it is a record the getter page shows. */
export function homeLens(key: string): Lens | undefined {
  return kindOf(key) === 'feature' ? 'feature' : undefined;
}

export type Target =
  | { kind: 'node'; lens: Lens; node: string }
  | { kind: 'session'; id: string }
  | { kind: 'get'; key: string }
  | { kind: 'external'; url: string };

/** The link rule. */
export function targetOf(key: string, lens: Lens): Target {
  const kind = kindOf(key);
  if (kind === 'session') return { kind: 'session', id: restOf(key) };
  if (kind === 'url') return { kind: 'external', url: restOf(key) };
  if (kind === 'product' || kind === 'change') return { kind: 'node', lens, node: key };
  const home = homeLens(key);
  if (home) return { kind: 'node', lens: home, node: key };
  return { kind: 'get', key };
}

/** Is this key a node of the tree a lens can stand on. */
export const isNodeKey = (key: string): boolean => ['product', 'feature', 'change'].includes(kindOf(key));
