import { createHash } from 'node:crypto';

/** Kinds whose keys name records inside the store. Every other kind is a source kind. */
export const RECORD_KINDS = new Set(['person', 'agent', 'change', 'decision', 'session', 'project']);

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

export const changeKey = (slug: string): string => `change:${slug}`;
export const sessionKey = (id: string): string => `session:${id}`;
export const decisionKey = (changeSlug: string | null, dslug: string): string =>
  `decision:${changeSlug ?? ''}/${dslug}`;

/** `decision:<change>/<slug>` or `decision:/<slug>` (store level). */
export function parseDecisionRest(rest: string): { changeSlug: string | null; dslug: string } | null {
  const i = rest.indexOf('/');
  if (i < 0) return null;
  const changeSlug = rest.slice(0, i);
  const dslug = rest.slice(i + 1);
  if (!SLUG_RE.test(dslug)) return null;
  if (changeSlug !== '' && !SLUG_RE.test(changeSlug)) return null;
  return { changeSlug: changeSlug === '' ? null : changeSlug, dslug };
}
