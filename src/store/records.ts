import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { parseRecord, sections, type Parsed } from './frontmatter.js';
import {
  aspectKey,
  canonicalSourceKey,
  decisionKey,
  parseAspectRest,
  parseDecisionRest,
  parseKey,
  parseReleaseRest,
  parseScopedRest,
  releaseKey,
  SCOPED_KINDS,
  VERSION_RE,
  type Key,
} from './keys.js';
import { ambiguous, CliError, notFound } from './util.js';
import { indexedEntries, type Entry, type Head, type HeadField } from './store-index.js';

export type RecordType =
  | 'product'
  | 'feature'
  | 'aspect'
  | 'place'
  | 'project'
  | 'change'
  | 'decision'
  | 'release'
  | 'source'
  | 'session'
  | 'session-kind'
  | 'actor';

export const FIELD_ORDER: Record<RecordType, readonly string[]> = {
  product: ['title', 'name', 'owners', 'levels', 'sequence', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  feature: [
    'title',
    'name',
    'status',
    'level',
    'product',
    'parent',
    'owners',
    'links',
    'aliases',
    'writer',
    'session',
    'created',
    'ext',
  ],
  aspect: ['title', 'name', 'parent', 'owners', 'links', 'writer', 'session', 'created', 'ext'],
  place: ['feature', 'links', 'writer', 'session', 'created', 'ext'],
  project: [
    'title',
    'product',
    'parent',
    'tracker',
    'map',
    'holds',
    'owners',
    'links',
    'writer',
    'session',
    'created',
    'ext',
  ],
  // a change and a decision carry the rungs (name, gist) over their foundation: a change's plan of steps and its
  // sections, a decision's thread; rungs_from is the foundation the rungs were written from; migrated marks a record
  // mapped mechanically and not yet written through the tool (foundation.ts)
  change: [
    'name',
    'gist',
    'status',
    'kind',
    'severity',
    'project',
    'parent',
    'depends_on',
    'features',
    'aspects',
    'owners',
    'target',
    'plan',
    'binds',
    'links',
    'aliases',
    'rungs_from',
    'migrated',
    'writer',
    'session',
    'created',
    'ext',
  ],
  decision: [
    'name',
    'gist',
    'status',
    'decided_by',
    'decided_on',
    'supersedes',
    'links',
    'thread',
    'rungs_from',
    'migrated',
    'writer',
    'session',
    'created',
    'ext',
  ],
  // a release: the version a product shipped, when, from which commit, at what level, and the changes it ships in order
  release: ['version', 'tag', 'level', 'at', 'commit', 'url', 'ships', 'links', 'writer', 'session', 'created', 'ext'],
  source: ['kind', 'key', 'title', 'url', 'links', 'writer', 'session', 'created', 'ext'],
  session: [
    'agent',
    'on_behalf_of',
    'started',
    'parent',
    'project',
    'name',
    'kind',
    'host',
    'changes',
    'focus',
    'briefed',
    'observed',
    'writer',
    'created',
    'ext',
  ],
  // a session kind: what a session with no change is doing (review, backlog, chat, other, or one a person made), store-wide
  'session-kind': ['name', 'gist', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  actor: ['kind', 'name', 'url', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
};

export const LAYER_OF: Record<RecordType, string> = {
  product: 'core',
  feature: 'core',
  aspect: 'core',
  place: 'core',
  project: 'core',
  change: 'work',
  decision: 'work',
  release: 'work',
  source: 'sources',
  session: 'core',
  'session-kind': 'core',
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
  /** An aspect's slug; for a place, the slug of the aspect it is under, with that aspect's full key. */
  aspectSlug?: string;
  aspectKey?: string;
  placeSlug?: string;
  /** A release's version: the file name under releases/. */
  releaseVersion?: string;
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
  /** A record file already parsed, when the source holds its parse (the store index): the parse as JSON text, read
   *  into objects only when the record's fields are, and the few fields every load reads. */
  held?(rel: string): { parsed: string; head: Head } | undefined;
}

/** The store as it stands on disk, read through its index (store-index.ts): the files' parses as held, brought up to
 *  date with what moved since. The store's root files are read live. Falls back to the disk when the index cannot be
 *  opened, and is not used when PJMAN_INDEX=0. */
let indexWarned = false;

export function indexedSource(store: Store): Source {
  const disk = diskSource(store.root);
  if (process.env.PJMAN_INDEX === '0') return disk;
  let entries: Map<string, Entry>;
  try {
    entries = indexedEntries(store);
  } catch (e) {
    // the files are the truth, so a load still answers; said once, since every load would be slow without the index
    if (!indexWarned)
      process.stderr.write(`pjman: the store index could not be used (${(e as Error).message}); reading the files\n`);
    indexWarned = true;
    return disk;
  }
  const children = new Map<string, string[]>();
  for (const rel of entries.keys()) {
    const at = rel.lastIndexOf('/');
    push(children, at < 0 ? '' : rel.slice(0, at), at < 0 ? rel : rel.slice(at + 1));
  }
  for (const names of children.values()) names.sort();
  const top = (rel: string) => !rel.includes('/');
  return {
    list: (rel) => (rel === '' ? disk.list('') : [...(children.get(rel) ?? [])]),
    isDir: (rel) => (rel === '' ? true : entries.has(rel) ? entries.get(rel)!.dir : top(rel) && disk.isDir(rel)),
    exists: (rel) => rel === '' || entries.has(rel) || (top(rel) && disk.exists(rel)),
    read: (rel) => disk.read(rel),
    held: (rel) => {
      const e = entries.get(rel);
      return e?.parsed && e.head ? { parsed: e.parsed, head: e.head } : undefined;
    },
  };
}

/** The store as it stands on disk. */
export function diskSource(root: string): Source {
  const abs = (rel: string) => (rel ? path.join(root, rel) : root);
  return {
    list(rel) {
      try {
        return fs
          .readdirSync(abs(rel))
          .filter((n) => !n.startsWith('.'))
          .sort();
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

/** The fields a load reads from a record the index held, so the load parses none of it whole. */
const heads = new WeakMap<Rec, Head>();
/** A field of the record, read from its head when the index held it, so reading it parses nothing. */
export const headField = (r: Rec, name: HeadField): unknown => {
  const h = heads.get(r);
  return h ? h[name] : r.data[name];
};

function readRec(src: Source, store: Store, rel: string, type: RecordType, key: string): Rec {
  const abs = `${store.root}${path.sep}${rel}`;
  const held = src.held?.(rel);
  if (held) {
    // the parse is read the first time a field is, and kept: every reader of the record sees the same objects
    let parsed: Parsed | undefined;
    let secs: Map<string, string> | undefined;
    const parse = () => (parsed ??= JSON.parse(held.parsed) as Parsed);
    const rec = { type, key, path: rel, abs, valid: held.head.valid } as Rec;
    Object.defineProperties(rec, {
      parsed: { get: parse, enumerable: true, configurable: true },
      data: { get: () => parse().data, enumerable: true, configurable: true },
      body: { get: () => parse().body, enumerable: true, configurable: true },
      sections: { get: () => (secs ??= sections(parse().body)), enumerable: true, configurable: true },
    });
    heads.set(rec, held.head);
    return rec;
  }
  const parsed = parseRecord(src.read(rel));
  const valid = parsed.hasFrontmatter && parsed.isMapping && parsed.errors.length === 0;
  return {
    type,
    key,
    path: rel,
    abs,
    data: parsed.data,
    body: parsed.body,
    sections: sections(parsed.body),
    parsed,
    valid,
  };
}

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

/** The store still holds records in the layout before keys were paths under the product. */
export function isLegacyLayout(root: string | Source): boolean {
  const src = typeof root === 'string' ? diskSource(root) : root;
  if (src.list('changes').some((n) => src.isDir(path.join('changes', n)))) return true;
  if (src.list('features').some((n) => src.isDir(path.join('features', n)))) return true;
  return src.list('products').some((n) => n.endsWith('.md'));
}

const STORE_FILES = [
  'products',
  'projects',
  'decisions',
  'sources',
  'sessions',
  'session-kinds',
  'actors',
  'pjman.yaml',
  'index.db',
  'events.jsonl',
  'README.md',
];

export function loadStore(store: Store, src: Source = indexedSource(store)): Loaded {
  const records: Rec[] = [];
  const problems: Problem[] = [];
  const listDir = (rel: string) => src.list(rel);
  const isDir = (rel: string) => src.isDir(rel);
  const exists = (rel: string) => src.exists(rel);
  // paths are relative to the store root; the source knows where the root is
  const root = '';
  if (isLegacyLayout(src))
    throw new CliError(
      'the store is laid out the old way (changes/, features/ and products/<slug>.md at the root); run `pjman migrate` once to key every record under its product',
    );
  const unexpected = (rel: string) =>
    problems.push({ level: 'warning', path: rel, message: 'unexpected file; not a record' });

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
      // releases/<version>.md: the versions the product shipped
      if (name === 'releases' && isDir(path.join(root, sub))) {
        for (const f of listDir(path.join(root, sub))) {
          const rel = path.join(sub, f);
          if (!f.endsWith('.md') || !VERSION_RE.test(f.slice(0, -3))) {
            problems.push({
              level: 'error',
              path: rel,
              message: 'release file name must be <major>.<minor>.<patch>.md',
            });
            continue;
          }
          const version = f.slice(0, -3);
          const r = readRec(src, store, rel, 'release', releaseKey(slug, version));
          r.productSlug = slug;
          r.releaseVersion = version;
          records.push(r);
        }
        continue;
      }
      // aspects/<slug>/aspect.md, with places/<place>.md beneath: what applies across the product, and where
      if (name === 'aspects' && isDir(path.join(root, sub))) {
        for (const aslug of listDir(path.join(root, sub))) {
          const adir = path.join(sub, aslug);
          if (!isDir(path.join(root, adir))) {
            unexpected(adir);
            continue;
          }
          const afile = path.join(adir, 'aspect.md');
          const akey = aspectKey(slug, aslug);
          if (exists(path.join(root, afile))) {
            const r = readRec(src, store, afile, 'aspect', akey);
            r.productSlug = slug;
            r.aspectSlug = aslug;
            records.push(r);
          } else problems.push({ level: 'error', path: adir, message: 'aspect folder without aspect.md' });
          for (const n of listDir(path.join(root, adir))) {
            if (n === 'aspect.md') continue;
            const pdir = path.join(adir, n);
            if (n !== 'places' || !isDir(path.join(root, pdir))) {
              unexpected(pdir);
              continue;
            }
            for (const f of listDir(path.join(root, pdir))) {
              const rel = path.join(pdir, f);
              if (!f.endsWith('.md')) {
                unexpected(rel);
                continue;
              }
              const pslug = f.slice(0, -3);
              const r = readRec(src, store, rel, 'place', aspectKey(slug, aslug, pslug));
              r.productSlug = slug;
              r.aspectSlug = aslug;
              r.aspectKey = akey;
              r.placeSlug = pslug;
              records.push(r);
            }
          }
        }
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
      const k = headField(r, 'kind');
      const key = headField(r, 'key');
      if (typeof k === 'string' && typeof key === 'string') r.key = canonicalSourceKey(k, key);
      records.push(r);
    }
  }

  // sessions/<date>-<id>.md
  for (const f of listDir(path.join(root, 'sessions'))) {
    const rel = path.join('sessions', f);
    const m = DATED.exec(f);
    if (!m) {
      problems.push({
        level: 'error',
        path: rel,
        message: 'session file name must be <yyyy-mm-dd>-<harness-session-id>.md',
      });
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
    const k = headField(r, 'kind');
    if (k === 'person' || k === 'agent') r.key = `${k}:${handle}`;
    records.push(r);
  }

  // session-kinds/<slug>.md: the kinds a session with no change may be given
  for (const f of listDir(path.join(root, 'session-kinds'))) {
    const rel = path.join('session-kinds', f);
    if (!f.endsWith('.md')) {
      unexpected(rel);
      continue;
    }
    const slug = f.slice(0, -3);
    const r = readRec(src, store, rel, 'session-kind', `session-kind:${slug}`);
    r.fileSlug = slug;
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
    const aliases = headField(r, 'aliases');
    if (!Array.isArray(aliases)) continue;
    const kind = r.key.slice(0, r.key.indexOf(':'));
    for (const a of aliases) {
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

/** The product the current project names, as a slug, or null, read from the project's file alone: what loadStore's
 *  scope is, for a caller that needs nothing else of the store. */
export function storeScope(store: Store): string | null {
  if (!store.project?.startsWith('project:')) return null;
  try {
    const project = parseRecord(
      fs.readFileSync(path.join(store.root, 'projects', `${store.project.slice('project:'.length)}.md`), 'utf8'),
    );
    const product = project.data.product;
    if (typeof product !== 'string' || !product.startsWith('product:')) return null;
    const slug = product.slice('product:'.length);
    return fs.existsSync(path.join(store.root, 'products', slug, 'product.md')) ? slug : null;
  } catch {
    return null;
  }
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

/** What is derived from a loaded store (lookups, resolutions), built on first use and kept with it, so a read costs
 *  what it asks and not a scan of the store per node (change:dashboard-reads-slow). A Loaded is read-only once loaded:
 *  whatever changes one in place calls forget() so nothing derived from its old state is read again. */
const derived = new WeakMap<Loaded, Map<string, unknown>>();

export function memo<T>(loaded: Loaded, name: string, build: () => T): T {
  let bag = derived.get(loaded);
  if (!bag) derived.set(loaded, (bag = new Map()));
  if (!bag.has(name)) bag.set(name, build());
  return bag.get(name) as T;
}

export function forget(loaded: Loaded): void {
  derived.delete(loaded);
}

/** Add `v` to the list at `k`. */
export function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const at = m.get(k);
  if (at) at.push(v);
  else m.set(k, [v]);
}

/** The records of one type, in the store's order. */
export function ofType(loaded: Loaded, type: RecordType): Rec[] {
  return (
    memo(loaded, 'of-type', () => {
      const out = new Map<string, Rec[]>();
      for (const r of loaded.records) push(out, r.type, r);
      return out;
    }).get(type) ?? []
  );
}

/** `<kind>:<rest>` → the records keyed `<kind>:<their product>/<rest>`: a bare key's store-wide candidates. */
const scopedByRest = (loaded: Loaded) =>
  memo(loaded, 'scoped-by-rest', () => {
    const out = new Map<string, Rec[]>();
    for (const r of loaded.records) {
      if (!r.productSlug) continue;
      const prefix = `${r.type}:${r.productSlug}/`;
      if (!r.key.startsWith(prefix)) continue;
      const k = `${r.type}:${r.key.slice(prefix.length)}`;
      push(out, k, r);
    }
    return out;
  });

/** Resolve a reference. Sources and actors need no record; the rest do. A bare feature, change or decision key
 *  resolves through `scope` (a product slug; undefined means the loaded default, null means no scope): first inside
 *  that product, else store-wide when exactly one product has the slug, else ambiguous. A former key resolves through
 *  its alias; a renamed product's old segment resolves too. */
export function resolve(loaded: Loaded, raw: unknown, scope: string | null | undefined = loaded.scope): Resolution {
  if (typeof raw !== 'string') return resolveOnce(loaded, raw, scope);
  const seen = memo(loaded, 'resolve', () => new Map<string, Resolution>());
  const k = `${scope}\u0000${raw}`;
  let r = seen.get(k);
  if (!r) seen.set(k, (r = resolveOnce(loaded, raw, scope)));
  return r;
}

function resolveOnce(loaded: Loaded, raw: unknown, scope: string | null | undefined): Resolution {
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
    const hits = scopedByRest(loaded).get(`${kind}:${rest}`) ?? [];
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
    if (c.status === 'ambiguous')
      return {
        status: 'ambiguous',
        key,
        candidates: c.candidates.map((k) => `decision:${k.slice('change:'.length)}/${d.slug}`),
      };
    return { status: 'missing', key };
  }
  if (key.kind === 'aspect') {
    const a = parseAspectRest(key.rest);
    if (!a) return { status: 'missing', key };
    const seg = a.segments;
    const at = (k: string): Resolution | null => {
      const rec = loaded.byKey.get(k)?.[0];
      return rec ? found(rec) : null;
    };
    if (seg.length === 3) {
      const p = product(seg[0]);
      return (p ? at(aspectKey(p, seg[1], seg[2])) : null) ?? { status: 'missing', key };
    }
    // one segment: an aspect in the scope, else the one product that has it; two: `<product>/<aspect>` when that
    // product has the aspect, else `<aspect>/<place>` found the same way as a bare aspect
    const bare = (tail: string[]): Resolution => {
      const inScope = scope ? at(aspectKey(scope, tail[0], tail[1])) : null;
      if (inScope) return inScope;
      const hits = loaded.records.filter(
        (r) =>
          r.key === aspectKey(r.productSlug ?? '', tail[0], tail[1]) && (r.type === 'aspect' || r.type === 'place'),
      );
      if (hits.length === 1) return found(hits[0]);
      if (hits.length > 1) return { status: 'ambiguous', key, candidates: hits.map((r) => r.key) };
      return { status: 'missing', key };
    };
    if (seg.length === 2) {
      const p = product(seg[0]);
      const full = p ? at(aspectKey(p, seg[1])) : null;
      if (full) return full;
    }
    return bare(seg);
  }
  if (key.kind === 'release') {
    const r = parseReleaseRest(key.rest);
    if (!r) return { status: 'missing', key };
    if (r.product) {
      const p = product(r.product);
      const rec = p ? loaded.byKey.get(releaseKey(p, r.version))?.[0] : undefined;
      return rec ? found(rec) : { status: 'missing', key };
    }
    const inScope = scope ? loaded.byKey.get(releaseKey(scope, r.version))?.[0] : undefined;
    if (inScope) return found(inScope);
    const hits = loaded.records.filter((x) => x.type === 'release' && x.releaseVersion === r.version);
    if (hits.length === 1) return found(hits[0]);
    if (hits.length > 1) return { status: 'ambiguous', key, candidates: hits.map((x) => x.key) };
    return { status: 'missing', key };
  }
  if (key.kind === 'product' || key.kind === 'session-kind') return viaAlias(key.raw) ?? { status: 'missing', key };
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
  return unresolvedError(res, raw).message;
}

/** The refusal for a reference that did not resolve: ambiguous naming the candidates, else not found. */
export function unresolvedError(res: Resolution, raw: string): CliError {
  if (res.status === 'ambiguous') return ambiguous(raw, res.candidates);
  if (res.status === 'malformed') return notFound(raw, { hint: 'name it by its key, <kind>:<slug>' });
  return notFound(raw);
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
  if (rec.type === 'feature' || rec.type === 'change' || rec.type === 'decision') {
    // the flat key the record had before keys were paths under the product
    const flat =
      rec.type === 'decision'
        ? decisionKey(null, null, rec.decisionSlug!).replace(
            'decision:/',
            rec.changeSlug ? `decision:${rec.changeSlug}/` : 'decision:/',
          )
        : `${kind}:${rec.key.slice(rec.key.lastIndexOf('/') + 1)}`;
    if (!out.includes(flat)) out.push(flat);
  }
  return out;
}

export function findSession(loaded: Loaded, id: string): Rec | undefined {
  return loaded.records.find((r) => r.type === 'session' && r.sessionId === id);
}
