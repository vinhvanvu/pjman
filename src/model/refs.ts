// One reference grammar per source kind: how a reference to it is written, linked and keyed. This table is the only
// place a shape lives; the getter, the text scanner and the syncs read it, and adapters hold no pattern of their own.
import { slugOfBranch } from './branch.js';
import { SLUG_RE } from '../store/keys.js';
import { memo, type Loaded } from '../store/records.js';

/** What a project names for its trackers' short forms: a repository for `#12`; for a bare ticket id (`ABC-12`), the
 *  trackers that claim its prefix (decision pjman-22/bare-ticket-ids). */
export interface Scope {
  repo?: string;
  /** Prefix → the source kinds of the project that claim it. */
  claims?: Map<string, Set<string>>;
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
  /** Whether the match is too ambiguous to act on (`#1` is as often a list item as an issue): listed and resolved,
   *  never binding a session or creating a change. Default: never. */
  weak?: (m: RegExpExecArray) => boolean;
  /** Whether the project's scope admits the match (its repository). Default: always. */
  inScope?: (m: RegExpExecArray, scope: Scope) => boolean;
  /** For a bare id a tracker claims by its prefix (`ABC` of `ABC-12`): the prefix. A match with one resolves only where
   *  exactly one tracker of the project claims it (decision pjman-22/bare-ticket-ids). */
  prefix?: (m: RegExpExecArray) => string;
  /** The key rest a URL of this kind names. */
  url?: (u: URL) => string | undefined;
  /** The URL a key rest of this kind opens, the reverse of `url`: for a source whose record carries none. */
  href?: (rest: string) => string | undefined;
  /** The change slug a ticket of this kind implies. */
  slug?: (rest: string) => string;
  /** A tracker's ticket: it leads only to the change that binds it, never to one that merely links it. */
  ticket?: boolean;
}

const REPO = '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+';
const githubRepo = (u: URL): string[] | null =>
  u.hostname.toLowerCase() === 'github.com' ? u.pathname.split('/').filter(Boolean) : null;
const githubHref = (rest: string, path: string): string | undefined => {
  const m = new RegExp(`^(${REPO})#(\\d+)$`).exec(rest);
  return m ? `https://github.com/${m[1]}/${path}/${m[2]}` : undefined;
};
const repoName = (repo: string): string =>
  repo
    .slice(repo.indexOf('/') + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

export const GRAMMARS: Grammar[] = [
  {
    kind: 'linear',
    id: /\b[A-Z][A-Z0-9]*-\d+\b/g,
    not: /^(UTF|SHA|ISO|RFC|CVE|MD|AES|RSA|HTTP|TLS|ES|HTML|CSS|PEP|ECMA|IPV|X)-/,
    rest: (m) => m[0],
    prefix: (m) => m[0].slice(0, m[0].indexOf('-')),
    url: (u) => {
      const seg = u.pathname.split('/').filter(Boolean);
      return u.hostname.toLowerCase() === 'linear.app' &&
        seg[1] === 'issue' &&
        seg[2] &&
        /^[A-Z][A-Z0-9]*-\d+$/.test(seg[2])
        ? seg[2]
        : undefined;
    },
    slug: (rest) => rest.toLowerCase(),
    ticket: true,
  },
  {
    kind: 'github-issue',
    id: new RegExp(`(?<![\\w/.#-])(?:(${REPO}))?#(\\d+)\\b`, 'g'),
    rest: (m, scope) => ((m[1] ?? scope.repo) ? `${m[1] ?? scope.repo}#${m[2]}` : undefined),
    qualified: (m) => !!m[1],
    weak: (m) => !m[1],
    inScope: (m, scope) => !m[1] || !scope.repo || m[1].toLowerCase() === scope.repo.toLowerCase(),
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg[2] === 'issues' && /^\d+$/.test(seg[3] ?? '') ? `${seg[0]}/${seg[1]}#${seg[3]}` : undefined;
    },
    href: (rest) => githubHref(rest, 'issues'),
    slug: (rest) => `${repoName(rest.slice(0, rest.indexOf('#')))}-${rest.slice(rest.indexOf('#') + 1)}`,
    ticket: true,
  },
  {
    kind: 'github-pr',
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg[2] === 'pull' && /^\d+$/.test(seg[3] ?? '') ? `${seg[0]}/${seg[1]}#${seg[3]}` : undefined;
    },
    href: (rest) => githubHref(rest, 'pull'),
  },
  {
    // a branch, written as its key: `branch:<name>`. Its last segment, less the harness's `worktree-` prefix, is the
    // change slug it was named for (branch.ts), so a session on that branch binds the change
    kind: 'branch',
    id: /\bbranch:[^\s'"`<>()]+/g,
    rest: (m) => m[0].slice('branch:'.length),
    slug: (rest) => slugOfBranch(rest),
  },
  {
    kind: 'git-repo',
    url: (u) => {
      const seg = githubRepo(u);
      return seg && seg.length === 2 ? `${seg[0]}/${seg[1].replace(/\.git$/, '')}` : undefined;
    },
    href: (rest) => (new RegExp(`^${REPO}$`).test(rest) ? `https://github.com/${rest}` : undefined),
  },
];

export const grammarOf = (kind: string): Grammar | undefined => GRAMMARS.find((g) => g.kind === kind);

/** The change slug a ticket implies: the kind's rule, else the rest lower-cased and slugified. */
export function slugFor(kind: string, rest: string): string {
  const g = grammarOf(kind);
  if (g?.slug) return g.slug(rest);
  const s = rest
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SLUG_RE.test(s) ? s : `t-${s}`;
}

/** The URL a source opens: the one its record carries, else one its kind builds from the key, else the key's own
 *  (`url:`); undefined for a kind with no place outside the store (a file, a branch). */
export function urlOf(key: string, recordUrl?: unknown): string | undefined {
  if (typeof recordUrl === 'string' && /^https?:\/\//.test(recordUrl)) return recordUrl;
  const i = key.indexOf(':');
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (kind === 'url') return /^https?:\/\//.test(rest) ? rest : undefined;
  return grammarOf(kind)?.href?.(rest);
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

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

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

/** The prefixes the project's trackers claim (decision pjman-22/bare-ticket-ids), prefix → the kinds claiming it. A
 *  tracker claims what the project binds it to (`ext.linear.team: ABC`, the team the sync pulls) and the prefix of every
 *  ticket of its kind a change of the project binds (what a sync, or a person, already bound). Nothing else claims. */
export function claimsOf(loaded: Loaded, project?: string): Map<string, Set<string>> {
  if (!project) return new Map();
  return memo(loaded, `claims\u0000${project}`, () => claimsOnce(loaded, project));
}

function claimsOnce(loaded: Loaded, project: string): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  const claim = (prefix: string, kind: string) => {
    const at = claims.get(prefix.toUpperCase());
    if (at) at.add(kind);
    else claims.set(prefix.toUpperCase(), new Set([kind]));
  };
  const prefixed = GRAMMARS.filter((g) => g.id && g.prefix);
  const ext = obj(loaded.byKey.get(project)?.[0]?.data.ext);
  for (const g of prefixed) {
    const team = obj(ext?.[g.kind])?.team;
    if (typeof team === 'string' && team.trim()) claim(team.trim(), g.kind);
  }
  for (const r of loaded.records) {
    if (r.type !== 'change' || !r.valid || r.data.project !== project || !Array.isArray(r.data.binds)) continue;
    for (const k of r.data.binds as unknown[]) {
      if (typeof k !== 'string') continue;
      const i = k.indexOf(':');
      const g = prefixed.find((x) => x.kind === k.slice(0, i));
      const m = g && anchored(g).exec(k.slice(i + 1));
      if (g && m) claim(g.prefix!(m), g.kind);
    }
  }
  return claims;
}

/** What the project names for short forms. */
export function scopeOf(loaded: Loaded, project?: string): Scope {
  if (!project) return {};
  return { repo: repoOf(loaded, project), claims: claimsOf(loaded, project) };
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
  /** A prefixed id (`ABC-12`) one tracker of the project claims: it resolves, record or not. */
  claimed?: boolean;
}

function anchored(g: Grammar): RegExp {
  return new RegExp(`^(?:${g.id!.source})$`);
}

/** Whether a word is a kind's short form as a whole (`ABC-12` for linear). */
export function isShortForm(kind: string, word: string): boolean {
  const g = grammarOf(kind);
  return !!g?.id && !g.not?.test(word) && anchored(g).test(word);
}

/** The short forms one word could be, one per grammar whose pattern matches it. A prefixed id (`ABC-12`) has a key only
 *  where exactly one tracker of the project claims its prefix, and that tracker is the grammar's kind. */
export function shortForms(word: string, scope: Scope): ShortForm[] {
  const out: ShortForm[] = [];
  for (const g of GRAMMARS) {
    if (!g.id || g.not?.test(word)) continue;
    const m = anchored(g).exec(word);
    if (!m) continue;
    if (g.prefix) {
      const prefix = g.prefix(m).toUpperCase();
      const kinds = [...(scope.claims?.get(prefix) ?? [])].toSorted();
      const claimed = kinds.length === 1 && kinds[0] === g.kind;
      const rest = claimed ? g.rest?.(m, scope) : undefined;
      out.push({
        kind: g.kind,
        key: rest ? `${g.kind}:${rest}` : undefined,
        qualified: false,
        inScope: claimed,
        claimed,
        needs: rest
          ? undefined
          : kinds.length > 1
            ? `one tracker to claim ${prefix}; ${kinds.join(' and ')} do: write the prefixed key (${kinds.map((k) => `${k}:${word}`).join(', ')}) or the URL`
            : `a tracker of the project to claim ${prefix} (ext.${g.kind}.team=${prefix}, or a change binding a ${prefix} ticket): else write ${g.kind}:${word} or the URL`,
      });
      continue;
    }
    const rest = g.rest?.(m, scope);
    out.push({
      kind: g.kind,
      key: rest ? `${g.kind}:${rest}` : undefined,
      qualified: g.qualified?.(m) ?? false,
      inScope: g.inScope?.(m, scope) ?? true,
      needs: rest
        ? undefined
        : g.kind === 'github-issue'
          ? 'a repository (ext.github.repo or a git-repo: link on the project)'
          : 'a scope',
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
  shape: string;
  /** A short form too ambiguous to act on (the grammar's `weak`). */
  weak?: boolean;
}

/** What an agent's interface writes into a prompt for a pasted image or text (`[Image #2]`, `[Pasted text #1 +12 lines]`):
 *  never a reference, whatever it contains. */
const PLACEHOLDER = /\[(?:Image|Pasted text)\b[^\]\n]*\]/g;

/** Every reference-shaped span in a text, in order: `change:<slug>`, a URL, each grammar's short form, and (when
 *  `slugs` is given) a bare existing change slug containing a hyphen, as a whole word. */
export function mentions(text: string, slugs: string[] = []): Mention[] {
  text = text.replace(PLACEHOLDER, (p) => ' '.repeat(p.length)); // blanked, so every offset still points into the input
  const found: Mention[] = [];
  for (const m of text.matchAll(/\bchange:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?)/g))
    found.push({ text: `change:${m[1]}`, at: m.index, shape: 'change' });
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/g))
    found.push({ text: m[0].replace(/[.,;:!?]+$/, ''), at: m.index, shape: 'url' });
  for (const g of GRAMMARS) {
    if (!g.id) continue;
    for (const m of text.matchAll(g.id))
      if (!g.not?.test(m[0]))
        found.push({ text: m[0], at: m.index, shape: g.kind, ...(g.weak?.(m) ? { weak: true } : {}) });
  }
  for (const slug of slugs) {
    if (!slug.includes('-')) continue;
    const re = new RegExp(`(^|[^a-z0-9:/#-])(${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![a-z0-9-])`, 'gi');
    for (const m of text.matchAll(re)) found.push({ text: m[2], at: m.index + m[1].length, shape: 'slug' });
  }
  // longest first at a position; the caller drops a span inside one it already accepted (the id inside a URL)
  return found.toSorted((a, b) => a.at - b.at || b.text.length - a.text.length);
}

// --- identity: the accounts a person holds ----------------------------------------------------------------------
// An account is a source of an identity kind, keyed as the outside world keys it (`github-user:<login>`,
// `linear-user:<id>`, `email:<address>`, `git-author:<name <email>>`), linked from the person who holds it. Anything
// observed with an account on it resolves to its person here; an account no person claims resolves to nothing, and is
// never matched by name.

/** The person who claims an account, or undefined when no one does. */
export function personOf(loaded: Loaded, account: string): string | undefined {
  const key = account.toLowerCase().startsWith('email:')
    ? `email:${account.slice('email:'.length).toLowerCase()}`
    : account;
  const people = loaded.records.filter((r) => r.type === 'actor' && r.valid && r.data.kind === 'person');
  const holder = people.find(
    (r) =>
      Array.isArray(r.data.links) &&
      (r.data.links as unknown[]).some(
        (l) => typeof l === 'string' && (l === key || l.toLowerCase() === key.toLowerCase()),
      ),
  );
  return holder?.key;
}

/** The identity grammars: where an account's key comes from in a URL or a commit line. */
export const IDENTITY_GRAMMARS: Grammar[] = [
  {
    kind: 'github-user',
    url: (u) => {
      const seg = githubRepo(u);
      return seg &&
        seg.length === 1 &&
        ![
          'orgs',
          'settings',
          'marketplace',
          'explore',
          'topics',
          'features',
          'pulls',
          'issues',
          'notifications',
          'login',
        ].includes(seg[0])
        ? seg[0]
        : undefined;
    },
  },
  { kind: 'email', url: (u) => (u.protocol === 'mailto:' ? u.pathname.toLowerCase() : undefined) },
];
GRAMMARS.push(...IDENTITY_GRAMMARS);
