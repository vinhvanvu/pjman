import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { parseRecord, sections, type Parsed } from './frontmatter.js';
import { canonicalSourceKey, decisionKey, parseDecisionRest, parseKey, parseScopedRest, SCOPED_KINDS, type Key } from './keys.js';
import { CliError } from './util.js';

export type RecordType = 'product' | 'feature' | 'project' | 'change' | 'decision' | 'source' | 'session' | 'actor';

export const FIELD_ORDER: Record<RecordType, readonly string[]> = {
  product: ['title', 'name', 'owners', 'levels', 'sequence', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  feature: ['title', 'name', 'status', 'level', 'product', 'parent', 'owners', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  project: ['title', 'product', 'parent', 'tracker', 'map', 'owners', 'links', 'writer', 'session', 'created', 'ext'],
  change: ['title', 'status', 'kind', 'severity', 'project', 'parent', 'depends_on', 'features', 'owners', 'target', 'next', 'binds', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'supersedes', 'links', 'writer', 'session', 'created', 'ext'],
  source: ['kind', 'key', 'title', 'url', 'links', 'writer', 'session', 'created', 'ext'],
  session: ['agent', 'on_behalf_of', 'started', 'parent', 'project', 'changes', 'observed', 'writer', 'created', 'ext'],
  actor: ['kind', 'name', 'url', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
};

export const LAYER_OF: Record<RecordType, string> = {
  product: 'core',
  feature: 'core',
  project: 'core',
  change: 'work',
  decision: 'work',
  source: 'sources',
  session: 'core',
  actor: 'core',
};

export interface Problem {
  level: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}

export interface Rec {
  type: RecordType;
  /** The key derived from the path (or, for sources and actors, from the frontmatter). */
  key: string;
  path: string;
  abs: string;
  data: Record<string, unknown>;
  body: string;
  sections: Map<string, string>;
  parsed: Parsed;
  /** Frontmatter parsed and is a mapping. */
  valid: boolean;
  projectSlug?: string;
  /** The product's slug: its own for a product; the namespace for a feature, a change or a decision beneath one. */
  productSlug?: string;
  featureSlug?: string;
  changeSlug?: string;
  /** A decision under a change: that change's full key. */
  changeKey?: string;
  decisionSlug?: string;
  fileDate?: string;
  fileSlug?: string;
  handle?: string;
  sessionId?: string;
}

export interface Loaded {
  store: Store;
  records: Rec[];
  byKey: Map<string, Rec[]>;
  /** Every alias form → the live keys it names: `change:<old>` (bare) and `change:<product>/<old>` (scoped) for a
   *  renamed change or feature; `product:<old>`; `person:<old>`. More than one key under a bare form is ambiguous. */
  aliases: Map<string, string[]>;
  /** The product slug a bare key resolves in when nothing closer is known: the current project's product. */
  scope: string | null;
  problems: Problem[];
}

/** Where a store's files are read from: the working tree (the default), or a commit in its history (moment.ts).
 *  Paths are relative to the store root; '' is the root. */
export interface Source {
  list(rel: string): string[];
  isDir(rel: string): boolean;
  exists(rel: string): boolean;
  read(rel: string): string;
}

/** The store as it stands on disk. */
export function diskSource(root: string): Source {
  const abs = (rel: string) => (rel ? path.join(root, rel) : root);
  return {
    list(rel) {
      try {
        return fs.readdirSync(abs(rel)).filter((n) => !n.startsWith('.')).sort();
      } catch {
        return [];
      }
    },
    isDir(rel) {
      try {
        return fs.statSync(abs(rel)).isDirectory();
      } catch {
        return false;
      }
    },
    exists(rel) {
      return fs.existsSync(abs(rel));
    },
    read(rel) {
      return fs.readFileSync(abs(rel), 'utf8');
    },
  };
}

function readRec(src: Source, store: Store, rel: string, type: RecordType, key: string): Rec {
  const abs = path.join(store.root, rel);
  const text = src.read(rel);
  const parsed = parseRecord(text);
  const valid = parsed.hasFrontmatter && parsed.isMapping && parsed.errors.length === 0;
  return { type, key, path: rel, abs, data: parsed.data, body: parsed.body, sections: sections(parsed.body), parsed, valid };
}

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

/** The store still holds records in the layout before keys were paths under the product. */
export function isLegacyLayout(root: string | Source): boolean {
  const src = typeof root === 'string' ? diskSource(root) : root;
  if (src.list('changes').some((n) => src.isDir(path.join('changes', n)))) return true;
  if (src.list('features').some((n) => src.isDir(path.join('features', n)))) return true;
  return src.list('products').some((n) => n.endsWith('.md'));
}

const STORE_FILES = ['products', 'projects', 'decisions', 'sources', 'sessions', 'actors', 'pjman.yaml', 'index.db', 'events.jsonl', 'README.md'];

export function loadStore(store: Store, src: Source = diskSource(store.root)): Loaded {
  const records: Rec[] = [];
  const problems: Problem[] = [];
  const listDir = (rel: string) => src.list(rel);
  const isDir = (rel: string) => src.isDir(rel);
  const exists = (rel: string) => src.exists(rel);
  // paths are relative to the store root; the source knows where the root is
  const root = '';
  if (isLegacyLayout(src)) throw new CliError('the store is laid out the old way (changes/, features/ and products/<slug>.md at the root); run `pjman migrate` once to key every record under its product');
  const unexpected = (rel: string) => problems.push({ level: 'warning', path: rel, message: 'unexpected file; not a record' });

  const readDecisions = (dir: string, product: string | null, change: string | null, changeKeyOf?: string): void => {
    for (const f of listDir(path.join(root, dir))) {
      const rel = path.join(dir, f);
      const m = DATED.exec(f);
      if (!m) {
        problems.push({ level: 'error', path: rel, message: 'decision file name must be <yyyy-mm-dd>-<slug>.md' });
        continue;
      }
      const r = readRec(src, store, rel, 'decision', decisionKey(product, change, m[2]));
      if (product) r.productSlug = product;
      if (change) {
        r.changeSlug = change;
        r.changeKey = changeKeyOf;
      }
      r.decisionSlug = m[2];
      r.fileDate = m[1];
      records.push(r);
    }
  };

  // products/<slug>/product.md, with features/, changes/ and decisions/ beneath
  for (const slug of listDir(path.join(root, 'products'))) {
    const dir = path.join('products', slug);
    if (!isDir(path.join(root, dir))) {
      unexpected(dir);
      continue;
    }
    const file = path.join(dir, 'product.md');
    if (exists(path.join(root, file))) {
      const r = readRec(src, store, file, 'product', `product:${slug}`);
      r.productSlug = slug;
      records.push(r);
    } else problems.push({ level: 'error', path: dir, message: 'product folder without product.md' });
    for (const name of listDir(path.join(root, dir))) {
      const sub = path.join(dir, name);
      if (name === 'product.md') continue;
      if (name === 'features' && isDir(path.join(root, sub))) {
        for (const fslug of listDir(path.join(root, sub))) {
          const fdir = path.join(sub, fslug);
          if (!isDir(path.join(root, fdir))) {
            unexpected(fdir);
            continue;
          }
          const ffile = path.join(fdir, 'feature.md');
          if (exists(path.join(root, ffile))) {
            const r = readRec(src, store, ffile, 'feature', `feature:${slug}/${fslug}`);
            r.productSlug = slug;
            r.featureSlug = fslug;
            records.push(r);
          } else problems.push({ level: 'error', path: fdir, message: 'feature folder without feature.md' });
          for (const n of listDir(path.join(root, fdir))) if (n !== 'feature.md') unexpected(path.join(fdir, n));
        }
        continue;
      }
      if (name === 'changes' && isDir(path.join(root, sub))) {
        for (const cslug of listDir(path.join(root, sub))) {
          const cdir = path.join(sub, cslug);
          if (!isDir(path.join(root, cdir))) {
            unexpected(cdir);
            continue;
          }
          const cfile = path.join(cdir, 'change.md');
          const ckey = `change:${slug}/${cslug}`;
          if (exists(path.join(root, cfile))) {
            const r = readRec(src, store, cfile, 'change', ckey);
            r.productSlug = slug;
            r.changeSlug = cslug;
            records.push(r);
          } else problems.push({ level: 'error', path: cdir, message: 'change folder without change.md' });
          for (const n of listDir(path.join(root, cdir))) {
            if (n === 'change.md' || n === 'plan.md') continue;
            if (n === 'decisions' && isDir(path.join(root, cdir, 'decisions'))) {
              readDecisions(path.join(cdir, 'decisions'), slug, cslug, ckey);
              continue;
            }
            unexpected(path.join(cdir, n));
          }
        }
        continue;
      }
      if (name === 'decisions' && isDir(path.join(root, sub))) {
        readDecisions(sub, slug, null);
        continue;
      }
      unexpected(sub);
    }
  }

  // projects/<slug>.md
  for (const f of listDir(path.join(root, 'projects'))) {
    const rel = path.join('projects', f);
    if (!f.endsWith('.md')) {
      unexpected(rel);
      continue;
    }
    const slug = f.slice(0, -3);
    const r = readRec(src, store, rel, 'project', `project:${slug}`);
    r.projectSlug = slug;
    records.push(r);
  }

  // decisions/<date>-<slug>.md (store level)
  readDecisions('decisions', null, null);

  // sources/<kind>/<slug>.md
  for (const kind of listDir(path.join(root, 'sources'))) {
    const dir = path.join('sources', kind);
    if (!isDir(path.join(root, dir))) {
      unexpected(dir);
      continue;
    }
    for (const f of listDir(path.join(root, dir))) {
      const rel = path.join(dir, f);
      if (!f.endsWith('.md')) {
        unexpected(rel);
        continue;
      }
      const r = readRec(src, store, rel, 'source', `${kind}:?${f.slice(0, -3)}`);
      r.fileSlug = f.slice(0, -3);
      const k = r.data.kind;
      const key = r.data.key;
      if (typeof k === 'string' && typeof key === 'string') r.key = canonicalSourceKey(k, key);
      records.push(r);
    }
  }

  // sessions/<date>-<id>.md
  for (const f of listDir(path.join(root, 'sessions'))) {
    const rel = path.join('sessions', f);
    const m = DATED.exec(f);
    if (!m) {
      problems.push({ level: 'error', path: rel, message: 'session file name must be <yyyy-mm-dd>-<harness-session-id>.md' });
      continue;
    }
    const r = readRec(src, store, rel, 'session', `session:${m[2]}`);
    r.sessionId = m[2];
    r.fileDate = m[1];
    records.push(r);
  }

  // actors/<handle>.md
  for (const f of listDir(path.join(root, 'actors'))) {
    const rel = path.join('actors', f);
    if (!f.endsWith('.md')) {
      unexpected(rel);
      continue;
    }
    const handle = f.slice(0, -3);
    const r = readRec(src, store, rel, 'actor', `?:${handle}`);
    r.handle = handle;
    const k = r.data.kind;
    if (k === 'person' || k === 'agent') r.key = `${k}:${handle}`;
    records.push(r);
  }

  // anything else at the root that is not a store file
  for (const name of listDir('')) {
    if (STORE_FILES.includes(name)) continue;
    if ((name === 'changes' || name === 'features') && listDir(path.join(root, name)).length === 0) continue; // emptied by the migration
    unexpected(name);
  }

  const byKey = new Map<string, Rec[]>();
  for (const r of records) {
    const list = byKey.get(r.key) ?? [];
    list.push(r);
    byKey.set(r.key, list);
  }
  const aliases = new Map<string, string[]>();
  const alias = (form: string, key: string) => aliases.set(form, [...(aliases.get(form) ?? []), key]);
  for (const r of records) {
    if (!Array.isArray(r.data.aliases)) continue;
    const kind = r.key.slice(0, r.key.indexOf(':'));
    for (const a of r.data.aliases) {
      if (typeof a !== 'string') continue;
      if (SCOPED_KINDS.has(r.type)) {
        // `old` names the slug it had in this product; `other/old` the full rest it had in another
        const scoped = a.includes('/') ? a : `${r.productSlug}/${a}`;
        alias(`${kind}:${scoped}`, r.key);
        alias(`${kind}:${a.slice(a.indexOf('/') + 1)}`, r.key);
      } else alias(`${kind}:${a}`, r.key);
    }
  }
  const scope = scopeOf(store, byKey);
  return { store, records, byKey, aliases, scope, problems };
}

/** The product the current project names, as a slug, or null. */
function scopeOf(store: Store, byKey: Map<string, Rec[]>): string | null {
  if (!store.project) return null;
  const project = byKey.get(store.project)?.[0];
  const product = project && typeof project.data.product === 'string' ? project.data.product : undefined;
  return product && product.startsWith('product:') && byKey.has(product) ? product.slice('product:'.length) : null;
}

export type Resolution =
  | { status: 'ok'; rec: Rec }
  | { status: 'alias'; rec: Rec; via: string }
  | { status: 'invalid'; rec: Rec }
  | { status: 'ambiguous'; key: Key; candidates: string[] }
  | { status: 'source-key'; key: Key }
  | { status: 'actor-key'; key: Key }
  | { status: 'missing'; key: Key }
  | { status: 'malformed' };

const found = (rec: Rec): Resolution => (rec.valid ? { status: 'ok', rec } : { status: 'invalid', rec });

/** Resolve a reference. Sources and actors need no record; the rest do. A bare feature, change or decision key
 *  resolves through `scope` (a product slug; undefined means the loaded default, null means no scope): first inside
 *  that product, else store-wide when exactly one product has the slug, else ambiguous. A former key resolves through
 *  its alias; a renamed product's old segment resolves too. */
export function resolve(loaded: Loaded, raw: unknown, scope: string | null | undefined = loaded.scope): Resolution {
  const key = parseKey(raw);
  if (!key) return { status: 'malformed' };
  const direct = loaded.byKey.get(key.raw)?.[0];
  if (direct) return found(direct);
  const product = (slug: string): string | null => {
    if (loaded.byKey.has(`product:${slug}`)) return slug;
    const via = loaded.aliases.get(`product:${slug}`);
    return via?.length === 1 ? via[0].slice('product:'.length) : null;
  };
  const viaAlias = (form: string): Resolution | null => {
    const keys = loaded.aliases.get(form);
    if (!keys?.length) return null;
    const live = [...new Set(keys)];
    if (live.length > 1) return { status: 'ambiguous', key, candidates: live };
    const rec = loaded.byKey.get(live[0])?.[0];
    return rec ? { status: 'alias', rec, via: live[0] } : null;
  };
  const inProduct = (kind: string, p: string, rest: string): Resolution | null => {
    const rec = loaded.byKey.get(`${kind}:${p}/${rest}`)?.[0];
    if (rec) return found(rec);
    return viaAlias(`${kind}:${p}/${rest}`);
  };
  const storeWide = (kind: string, rest: string): Resolution => {
    const hits = loaded.records.filter((r) => r.type === kind && r.key === `${kind}:${r.productSlug}/${rest}`);
    if (hits.length === 1) return found(hits[0]);
    if (hits.length > 1) {
      // two products share the slug: the bare form belongs to the record that held it as a flat key, when one did
      const held = hits.filter((r) => Array.isArray(r.data.aliases) && (r.data.aliases as unknown[]).includes(rest));
      if (held.length === 1) return { status: 'alias', rec: held[0], via: held[0].key };
      return { status: 'ambiguous', key, candidates: hits.map((r) => r.key) };
    }
    return viaAlias(`${kind}:${rest}`) ?? { status: 'missing', key };
  };

  if (key.kind === 'change' || key.kind === 'feature') {
    const s = parseScopedRest(key.rest);
    if (!s) return { status: 'missing', key };
    if (s.product) {
      const p = product(s.product);
      return (p ? inProduct(key.kind, p, s.slug) : null) ?? { status: 'missing', key };
    }
    const scoped = scope ? inProduct(key.kind, scope, s.slug) : null;
    return scoped ?? storeWide(key.kind, s.slug);
  }
  if (key.kind === 'decision') {
    const d = parseDecisionRest(key.rest);
    if (!d) return { status: 'missing', key };
    if (!d.head) return { status: 'missing', key }; // store level: only a direct hit
    if (d.segments === 3) {
      const p = product(d.head);
      if (!p) return { status: 'missing', key };
      const direct3 = loaded.byKey.get(`decision:${p}/${d.change}/${d.slug}`)?.[0];
      if (direct3) return found(direct3);
      // the change may have been renamed: its alias leads to the live change, whose decision this is
      const c = resolve(loaded, `change:${p}/${d.change}`, null);
      if (c.status === 'alias' || c.status === 'ok') {
        const rec = loaded.byKey.get(`decision:${c.rec.productSlug}/${c.rec.changeSlug}/${d.slug}`)?.[0];
        if (rec) return { status: 'alias', rec, via: rec.key };
      }
      return { status: 'missing', key };
    }
    // two segments: `<product>/<slug>` at product level, else `<change>/<slug>` resolved like a bare change
    const p = product(d.head);
    const atProduct = p ? loaded.byKey.get(`decision:${p}/${d.slug}`)?.[0] : undefined;
    if (atProduct) return found(atProduct);
    const c = resolve(loaded, `change:${d.head}`, scope);
    if (c.status === 'ok' || c.status === 'alias') {
      const rec = loaded.byKey.get(`decision:${c.rec.productSlug}/${c.rec.changeSlug}/${d.slug}`)?.[0];
      if (rec) return c.status === 'alias' ? { status: 'alias', rec, via: rec.key } : found(rec);
      return { status: 'missing', key };
    }
    if (c.status === 'ambiguous') return { status: 'ambiguous', key, candidates: c.candidates.map((k) => `decision:${k.slice('change:'.length)}/${d.slug}`) };
    return { status: 'missing', key };
  }
  if (key.kind === 'product') return viaAlias(key.raw) ?? { status: 'missing', key };
  if (key.kind === 'session' || key.kind === 'project') return { status: 'missing', key };
  if (key.kind === 'person' || key.kind === 'agent') return viaAlias(key.raw) ?? { status: 'actor-key', key };
  if (key.kind === 'url') {
    const rec = loaded.byKey.get(canonicalSourceKey('url', key.rest))?.[0];
    if (rec) return found(rec);
  }
  return { status: 'source-key', key };
}

/** The live full key a reference names, through the scope and the aliases, or the reference itself when it names no record. */
export function fullKey(loaded: Loaded, raw: string, scope?: string | null): string {
  const res = resolve(loaded, raw, scope);
  return res.status === 'ok' || res.status === 'alias' || res.status === 'invalid' ? res.rec.key : raw;
}

/** The record a reference resolves to, or undefined. */
export function recordOf(loaded: Loaded, raw: unknown, scope?: string | null): Rec | undefined {
  const res = typeof raw === 'string' ? resolve(loaded, raw, scope) : null;
  return res && (res.status === 'ok' || res.status === 'alias') ? res.rec : undefined;
}

/** One line saying why a reference did not resolve, for a refusal. */
export function unresolved(res: Resolution, raw: string): string {
  if (res.status === 'ambiguous') return `${raw} is ambiguous: ${res.candidates.join(', ')} (name the product: ${res.candidates[0]})`;
  if (res.status === 'malformed') return `'${raw}' is not a key`;
  return `${raw} does not resolve to a record`;
}

/** The keys a record's events were written under: its key, and every key it had before a rename (bare and scoped). */
export function eventKeysOf(rec: Rec): string[] {
  const out = [rec.key];
  const kind = rec.key.slice(0, rec.key.indexOf(':'));
  if (Array.isArray(rec.data.aliases)) {
    for (const a of rec.data.aliases) {
      if (typeof a !== 'string') continue;
      out.push(`${kind}:${a}`);
      if (SCOPED_KINDS.has(rec.type) && !a.includes('/')) out.push(`${kind}:${rec.productSlug}/${a}`);
    }
  }
  if (SCOPED_KINDS.has(rec.type)) {
    // the flat key the record had before keys were paths under the product
    const flat = rec.type === 'decision' ? decisionKey(null, null, rec.decisionSlug!).replace('decision:/', rec.changeSlug ? `decision:${rec.changeSlug}/` : 'decision:/') : `${kind}:${rec.key.slice(rec.key.lastIndexOf('/') + 1)}`;
    if (!out.includes(flat)) out.push(flat);
  }
  return out;
}

export function findSession(loaded: Loaded, id: string): Rec | undefined {
  return loaded.records.find((r) => r.type === 'session' && r.sessionId === id);
}
