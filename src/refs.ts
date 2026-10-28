// One reference grammar per source kind: how a reference to it is written, linked and keyed. This table is the only
// place a shape lives; the getter, the text scanner and the syncs read it, and adapters hold no pattern of their own.
import { SLUG_RE } from './keys.js';
import type { Loaded } from './records.js';

/** What a project names for its tracker's short forms: a repository for `#12`, a team for a Linear id. */
export interface Scope {
  repo?: string;
  team?: string;
}

export interface Grammar {
  kind: string;
  /** The short form as people write it, as a global scanner with its own boundaries. Absent: the kind has no short form. */
  id?: RegExp;
  /** Words the scanner catches that are never references (`UTF-8`, `SHA-256`). */
  not?: RegExp;
  /** The canonical key rest for a match, given the project's scope; undefined when a scope the short form needs is missing. */
  rest?: (m: RegExpExecArray, scope: Scope) => string | undefined;
  /** Whether the match carries its own scope (`owner/repo#12`) and so resolves anywhere. Default: never. */
  qualified?: (m: RegExpExecArray) => boolean;
  /** Whether the project's scope admits the match (its team, its repository). Default: always. */
  inScope?: (m: RegExpExecArray, scope: Scope) => boolean;
  /** The key rest a URL of this kind names. */
  url?: (u: URL) => string | undefined;
  /** The change slug a ticket of this kind implies. */
  slug?: (rest: string) => string;
}

const REPO = '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+';
const githubRepo = (u: URL): string[] | null => (u.hostname.toLowerCase() === 'github.com' ? u.pathname.split('/').filter(Boolean) : null);
const repoName = (repo: string): string => repo.slice(repo.indexOf('/') + 1).toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const GRAMMARS: Grammar[] = [
  {
    kind: 'linear',
    id: /\b[A-Z][A-Z0-9]*-\d+\b/g,
    not: /^(UTF|SHA|ISO|RFC|CVE|MD|AES|RSA|HTTP|TLS|ES|HTML|CSS|PEP|ECMA|IPV|X)-/,
    rest: (m) => m[0],
    inScope: (m, scope) => !scope.team || m[0].slice(0, m[0].indexOf('-')) === scope.team.toUpperCase(),
    url: (u) => {
      const seg = u.pathname.split('/').filter(Boolean);
      return u.hostname.toLowerCase() === 'linear.app' && seg[1] === 'issue' && seg[2] && /^[A-Z][A-Z0-9]*-\d+$/.test(seg[2]) ? seg[2] : undefined;
    },
    slug: (rest) => rest.toLowerCase(),
  },
  {
    kind: 'github-issue',
    id: new RegExp(`(?<![\\w/.#-])(?:(${REPO}))?#(\\d+)\\b`, 'g'),
    rest: (m, scope) => (m[1] ?? scope.repo ? `${m[1] ?? scope.repo}#${m[2]}` : undefined),
    qualified: (m) => !!m[1],
    inScope: (m, scope) => !m[1] || !scope.repo || m[1].toLowerCase() === scope.repo.toLowerCase(),
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg[2] === 'issues' && /^\d+$/.test(seg[3] ?? '') ? `${seg[0]}/${seg[1]}#${seg[3]}` : undefined;
    },
    slug: (rest) => `${repoName(rest.slice(0, rest.indexOf('#')))}-${rest.slice(rest.indexOf('#') + 1)}`,
  },
  {
    kind: 'github-pr',
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg[2] === 'pull' && /^\d+$/.test(seg[3] ?? '') ? `${seg[0]}/${seg[1]}#${seg[3]}` : undefined;
    },
  },
  {
    kind: 'git-repo',
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg.length === 2 ? `${seg[0]}/${seg[1].replace(/\.git$/, '')}` : undefined;
    },
  },
];

export const grammarOf = (kind: string): Grammar | undefined => GRAMMARS.find((g) => g.kind === kind);

/** The change slug a ticket implies: the kind's rule, else the rest lower-cased and slugified. */
export function slugFor(kind: string, rest: string): string {
  const g = grammarOf(kind);
  if (g?.slug) return g.slug(rest);
  const s = rest.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return SLUG_RE.test(s) ? s : `t-${s}`;
}

/** The source key a vendor URL names, when a grammar knows the shape. */
export function keyFromUrl(u: string): string | null {
  let x: URL;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  for (const g of GRAMMARS) {
    const rest = g.url?.(x);
    if (rest) return `${g.kind}:${rest}`;
  }
  return null;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** The project's GitHub repository: `ext.github.repo`, else its `git-repo:` link. */
export function repoOf(loaded: Loaded, project?: string): string | undefined {
  if (!project) return undefined;
  const rec = loaded.byKey.get(project)?.[0];
  if (!rec) return undefined;
  const repo = obj(obj(rec.data.ext)?.github)?.repo;
  if (typeof repo === 'string') return repo;
  const links = Array.isArray(rec.data.links) ? (rec.data.links as unknown[]) : [];
  const link = links.find((k): k is string => typeof k === 'string' && k.startsWith('git-repo:'));
  return link?.slice('git-repo:'.length);
}

/** The project's tracker (the source kind of its tickets), or undefined. */
export function trackerOf(loaded: Loaded, project?: string): string | undefined {
  if (!project) return undefined;
  const rec = loaded.byKey.get(project)?.[0];
  return rec && typeof rec.data.tracker === 'string' ? rec.data.tracker : undefined;
}

/** What the project names for short forms. */
export function scopeOf(loaded: Loaded, project?: string): Scope {
  if (!project) return {};
  const rec = loaded.byKey.get(project)?.[0];
  const team = obj(obj(rec?.data.ext)?.linear)?.team;
  return { repo: repoOf(loaded, project), team: typeof team === 'string' ? team : undefined };
}

export interface ShortForm {
  kind: string;
  /** The canonical source key, when the scope allows one. */
  key?: string;
  /** The match carries its own scope and resolves anywhere. */
  qualified: boolean;
  /** The project's scope admits it (a ticket of this project's tracker could be it). */
  inScope: boolean;
  /** Why no key: the scope the short form needs. */
  needs?: string;
}

const anchored = (g: Grammar): RegExp => new RegExp(`^(?:${g.id!.source})$`);

/** The short forms one word could be, one per grammar whose pattern matches it. */
export function shortForms(word: string, scope: Scope): ShortForm[] {
  const out: ShortForm[] = [];
  for (const g of GRAMMARS) {
    if (!g.id || g.not?.test(word)) continue;
    const m = anchored(g).exec(word);
    if (!m) continue;
    const rest = g.rest?.(m, scope);
    out.push({
      kind: g.kind, key: rest ? `${g.kind}:${rest}` : undefined, qualified: g.qualified?.(m) ?? false, inScope: g.inScope?.(m, scope) ?? true,
      needs: rest ? undefined : g.kind === 'github-issue' ? 'a repository (ext.github.repo or a git-repo: link on the project)' : 'a scope',
    });
  }
  return out;
}

export interface Mention {
  /** The text as written. */
  text: string;
  /** Its offset in the input. */
  at: number;
  /** `change`, `url`, or the grammar's kind for a short form. */
  shape: 'change' | 'url' | 'slug' | string;
}

/** Every reference-shaped span in a text, in order: `change:<slug>`, a URL, each grammar's short form, and (when
 *  `slugs` is given) a bare existing change slug containing a hyphen, as a whole word. */
export function mentions(text: string, slugs: string[] = []): Mention[] {
  const found: Mention[] = [];
  for (const m of text.matchAll(/\bchange:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?)/g)) found.push({ text: `change:${m[1]}`, at: m.index!, shape: 'change' });
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/g)) found.push({ text: m[0].replace(/[.,;:!?]+$/, ''), at: m.index!, shape: 'url' });
  for (const g of GRAMMARS) {
    if (!g.id) continue;
    for (const m of text.matchAll(g.id)) if (!g.not?.test(m[0])) found.push({ text: m[0], at: m.index!, shape: g.kind });
  }
  for (const slug of slugs) {
    if (!slug.includes('-')) continue;
    const re = new RegExp(`(^|[^a-z0-9:/#-])(${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![a-z0-9-])`, 'gi');
    for (const m of text.matchAll(re)) found.push({ text: m[2], at: m.index! + m[1].length, shape: 'slug' });
  }
  // longest first at a position; the caller drops a span inside one it already accepted (the id inside a URL)
  return found.sort((a, b) => a.at - b.at || b.text.length - a.text.length);
}

// --- identity: the accounts a person holds ----------------------------------------------------------------------
// An account is a source of an identity kind, keyed as the outside world keys it (`github-user:<login>`,
// `linear-user:<id>`, `email:<address>`, `git-author:<name <email>>`), linked from the person who holds it. Anything
// observed with an account on it resolves to its person here; an account no person claims resolves to nothing, and is
// never matched by name.

/** The person who claims an account, or undefined when no one does. */
export function personOf(loaded: Loaded, account: string): string | undefined {
  const key = account.toLowerCase().startsWith('email:') ? `email:${account.slice('email:'.length).toLowerCase()}` : account;
  const people = loaded.records.filter((r) => r.type === 'actor' && r.valid && r.data.kind === 'person');
  const holder = people.find((r) => Array.isArray(r.data.links) && (r.data.links as unknown[]).some((l) => typeof l === 'string' && (l === key || l.toLowerCase() === key.toLowerCase())));
  return holder?.key;
}

/** The identity grammars: where an account's key comes from in a URL or a commit line. */
export const IDENTITY_GRAMMARS: Grammar[] = [
  {
    kind: 'github-user',
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg.length === 1 && !['orgs', 'settings', 'marketplace', 'explore', 'topics', 'features', 'pulls', 'issues', 'notifications', 'login'].includes(seg[0]) ? seg[0] : undefined;
    },
  },
  { kind: 'email', url: (u) => (u.protocol === 'mailto:' ? u.pathname.toLowerCase() : undefined) },
];
GRAMMARS.push(...IDENTITY_GRAMMARS);
