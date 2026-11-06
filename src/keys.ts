// Keys. A key is a namespace and a slug, nothing else. The namespace is the product for what is a product's
// vocabulary (features, changes, decisions) and the store for what is identity or external (products, projects,
// people, agents, sessions, sources). A record's place in any hierarchy is a field, never part of its key.
//
//   feature:<product>/<slug>            change:<product>/<slug>
//   decision:<product>/<change>/<slug>  decision:<product>/<slug> (product level)  decision:/<slug> (store level)
//   aspect:<product>/<slug>             aspect:<product>/<aspect>/<place> (a place the aspect applies)
//   release:<product>/<version>         a version the product shipped (decision releases-homebrew/release-is-a-record)
//
// Inside a product the slug alone names a record (`feature:<slug>`, `change:<slug>`, `decision:<change>/<slug>`,
// `aspect:<slug>`, `aspect:<aspect>/<place>`, `release:<version>`):
// the bare form resolves through the scope at hand (records.ts). The full form is what the store writes.
import { createHash } from 'node:crypto';

/** Kinds whose keys name records inside the store. Every other kind is a source kind. */
export const RECORD_KINDS = new Set(['person', 'agent', 'change', 'decision', 'session', 'project', 'product', 'feature', 'aspect', 'release']);
/** Kinds keyed beneath a product. */
export const SCOPED_KINDS = new Set(['feature', 'change', 'decision', 'aspect', 'release']);

export interface Key {
  kind: string;
  rest: string;
  raw: string;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** `kind:rest`, split at the first colon. Returns null when the string is not a key. */
export function parseKey(raw: unknown): Key | null {
  if (typeof raw !== 'string') return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const kind = raw.slice(0, i);
  const rest = raw.slice(i + 1);
  // interior spaces are allowed (file paths have them); leading/trailing whitespace and line breaks are not
  if (!/^[a-z][a-z0-9-]*$/.test(kind) || !/^\S(.*\S)?$/.test(rest) || /[\t\r\n]/.test(rest)) return null;
  return { kind, rest, raw };
}

export const isActorKey = (k: Key): boolean => k.kind === 'person' || k.kind === 'agent';
export const isChangeKey = (k: Key): boolean => k.kind === 'change';
export const isDecisionKey = (k: Key): boolean => k.kind === 'decision';
export const isSessionKey = (k: Key): boolean => k.kind === 'session';
export const isSourceKey = (k: Key): boolean => !RECORD_KINDS.has(k.kind);
export const isScopedKind = (kind: string): boolean => SCOPED_KINDS.has(kind);

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function canonicalUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = '';
    x.hostname = x.hostname.toLowerCase();
    let s = x.toString();
    if (x.pathname === '/' && s.endsWith('/') && !x.search) s = s.slice(0, -1);
    return s;
  } catch {
    return u.trim();
  }
}

/** The canonical form of a source key: kind lower-cased; URL keys normalised; other keys verbatim. */
export function canonicalSourceKey(kind: string, key: string): string {
  const k = kind.toLowerCase();
  return `${k}:${k === 'url' ? canonicalUrl(key) : key}`;
}

/** The file name (without extension) a source record takes under `sources/<kind>/`. */
export function sourceFileSlug(kind: string, key: string): string {
  if (kind.toLowerCase() === 'url') {
    return 'u-' + createHash('sha256').update(canonicalUrl(key)).digest('hex').slice(0, 12);
  }
  return slugify(key);
}

// --- scoped keys -----------------------------------------------------------------------------------------------

export const productKey = (product: string): string => `product:${product}`;
export const featureKey = (product: string, slug: string): string => `feature:${product}/${slug}`;
export const changeKey = (product: string, slug: string): string => `change:${product}/${slug}`;
export const sessionKey = (id: string): string => `session:${id}`;
/** A decision's full key: under a change, at product level (no change), or at store level (no product). */
export const decisionKey = (product: string | null, change: string | null, slug: string): string =>
  product ? `decision:${product}/${change ? `${change}/` : ''}${slug}` : `decision:/${slug}`;

/** An aspect's full key, or a place's under it. */
export const aspectKey = (product: string, slug: string, place?: string): string => `aspect:${product}/${slug}${place ? `/${place}` : ''}`;

/** A version as a release names it: plain semver, `0.2.0`, with no `v`. */
export const VERSION_RE = /^\d+\.\d+\.\d+$/;
/** A release's full key. */
export const releaseKey = (product: string, version: string): string => `release:${product}/${version}`;
/** A release rest taken apart: `<product>/<version>` is full; `<version>` is bare (resolved through a scope). */
export function parseReleaseRest(rest: string): { product: string | null; version: string } | null {
  const parts = rest.split('/');
  if (parts.length === 1) return VERSION_RE.test(parts[0]) ? { product: null, version: parts[0] } : null;
  if (parts.length === 2 && SLUG_RE.test(parts[0]) && VERSION_RE.test(parts[1])) return { product: parts[0], version: parts[1] };
  return null;
}

/** A feature or change rest taken apart: `<product>/<slug>` is full; `<slug>` is bare (resolved through a scope). */
export interface ScopedRest {
  product: string | null;
  slug: string;
}

export function parseScopedRest(rest: string): ScopedRest | null {
  const parts = rest.split('/');
  if (parts.length === 1) return SLUG_RE.test(parts[0]) ? { product: null, slug: parts[0] } : null;
  if (parts.length === 2 && SLUG_RE.test(parts[0]) && SLUG_RE.test(parts[1])) return { product: parts[0], slug: parts[1] };
  return null;
}

/** A decision rest taken apart. `full` says every namespace segment is present:
 *  `/<slug>` store level · `<product>/<change>/<slug>` under a change · `<a>/<slug>` either product level (full) or
 *  a bare change-level key, which the resolver tells apart · `<slug>` alone is not a decision key. */
export interface DecisionRest {
  /** The first segment: a product (full, product level or under a change) or a change (bare). Null at store level. */
  head: string | null;
  /** The change slug, when the key has three segments. */
  change: string | null;
  slug: string;
  segments: number;
}

export function parseDecisionRest(rest: string): DecisionRest | null {
  const parts = rest.split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  const slug = parts[parts.length - 1];
  if (!SLUG_RE.test(slug)) return null;
  if (parts.length === 2) {
    if (parts[0] === '') return { head: null, change: null, slug, segments: 2 };
    return SLUG_RE.test(parts[0]) ? { head: parts[0], change: null, slug, segments: 2 } : null;
  }
  return SLUG_RE.test(parts[0]) && SLUG_RE.test(parts[1]) ? { head: parts[0], change: parts[1], slug, segments: 3 } : null;
}

/** An aspect rest taken apart: `<slug>` a bare aspect · `<a>/<b>` a full aspect (`<product>/<slug>`) or a bare place
 *  (`<aspect>/<place>`), which the resolver tells apart · `<product>/<aspect>/<place>` a full place. */
export interface AspectRest {
  segments: string[];
}

export function parseAspectRest(rest: string): AspectRest | null {
  const parts = rest.split('/');
  if (parts.length < 1 || parts.length > 3 || !parts.every((p) => SLUG_RE.test(p))) return null;
  return { segments: parts };
}

/** The product segment of a full scoped key, or null when the key is bare or not scoped. */
export function productOfKey(key: string): string | null {
  const k = parseKey(key);
  if (!k || !SCOPED_KINDS.has(k.kind)) return null;
  if (k.kind === 'aspect') {
    const a = parseAspectRest(k.rest);
    return a && a.segments.length === 3 ? a.segments[0] : null; // two segments are told apart by the resolver
  }
  if (k.kind === 'decision') {
    const d = parseDecisionRest(k.rest);
    return d && d.segments === 3 ? d.head : null; // a two-segment decision key is told apart by the resolver
  }
  return parseScopedRest(k.rest)?.product ?? null;
}

/** The slug of a scoped key (the last segment); the rest for anything else. */
export function slugOfKey(key: string): string {
  const k = parseKey(key);
  if (!k) return key;
  const i = k.rest.lastIndexOf('/');
  return i >= 0 ? k.rest.slice(i + 1) : k.rest;
}

/** The key as it reads inside `product`: the product segment dropped from a feature, change or decision beneath it.
 *  Anything of another product, or of no product, is returned whole. */
export function shortKey(key: string, product: string | null | undefined): string {
  if (!product) return key;
  const k = parseKey(key);
  if (!k || !SCOPED_KINDS.has(k.kind)) return key;
  const p = product.startsWith('product:') ? product.slice('product:'.length) : product;
  return k.rest.startsWith(`${p}/`) ? `${k.kind}:${k.rest.slice(p.length + 1)}` : key;
}

/** Every `<kind>:<product>/…` in a text shortened to its slug form, for output read inside that product. */
export function shortenText(text: string, product: string | null | undefined): string {
  if (!product) return text;
  const p = product.startsWith('product:') ? product.slice('product:'.length) : product;
  return text.replace(new RegExp(`\\b(feature|change|decision|aspect|release):${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g'), '$1:');
}
