import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { parseRecord, sections, type Parsed } from './frontmatter.js';
import { canonicalSourceKey, parseKey, type Key } from './keys.js';

export type RecordType = 'product' | 'feature' | 'project' | 'change' | 'decision' | 'source' | 'session' | 'actor';

export const FIELD_ORDER: Record<RecordType, readonly string[]> = {
  product: ['title', 'owners', 'levels', 'sequence', 'links', 'writer', 'session', 'created', 'ext'],
  feature: ['title', 'name', 'status', 'level', 'product', 'parent', 'owners', 'links', 'writer', 'session', 'created', 'ext'],
  project: ['title', 'product', 'parent', 'tracker', 'owners', 'links', 'writer', 'session', 'created', 'ext'],
  change: ['title', 'status', 'kind', 'severity', 'project', 'parent', 'depends_on', 'features', 'owners', 'target', 'next', 'binds', 'links', 'aliases', 'writer', 'session', 'created', 'ext'],
  decision: ['title', 'status', 'decided_by', 'decided_on', 'supersedes', 'links', 'writer', 'session', 'created', 'ext'],
  source: ['kind', 'key', 'title', 'url', 'links', 'writer', 'session', 'created', 'ext'],
  session: ['agent', 'on_behalf_of', 'started', 'parent', 'changes', 'observed', 'writer', 'created', 'ext'],
  actor: ['kind', 'name', 'url', 'writer', 'session', 'created', 'ext'],
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
  productSlug?: string;
  featureSlug?: string;
  changeSlug?: string;
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
  /** change alias slug → current change key. */
  aliasOf: Map<string, string>;
  problems: Problem[];
}

function listDir(abs: string): string[] {
  try {
    return fs.readdirSync(abs).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
}

function isDir(abs: string): boolean {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

function readRec(store: Store, rel: string, type: RecordType, key: string): Rec {
  const abs = path.join(store.root, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const parsed = parseRecord(text);
  const valid = parsed.hasFrontmatter && parsed.isMapping && parsed.errors.length === 0;
  return { type, key, path: rel, abs, data: parsed.data, body: parsed.body, sections: sections(parsed.body), parsed, valid };
}

const DATED = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

export function loadStore(store: Store): Loaded {
  const records: Rec[] = [];
  const problems: Problem[] = [];
  const root = store.root;
  const unexpected = (rel: string) => problems.push({ level: 'warning', path: rel, message: 'unexpected file; not a record' });

  // products/<slug>.md
  for (const f of listDir(path.join(root, 'products'))) {
    const rel = path.join('products', f);
    if (!f.endsWith('.md')) {
      unexpected(rel);
      continue;
    }
    const slug = f.slice(0, -3);
    const r = readRec(store, rel, 'product', `product:${slug}`);
    r.productSlug = slug;
    records.push(r);
  }

  // features/<slug>/feature.md
  for (const slug of listDir(path.join(root, 'features'))) {
    const dir = path.join('features', slug);
    if (!isDir(path.join(root, dir))) {
      unexpected(dir);
      continue;
    }
    const file = path.join(dir, 'feature.md');
    if (fs.existsSync(path.join(root, file))) {
      const r = readRec(store, file, 'feature', `feature:${slug}`);
      r.featureSlug = slug;
      records.push(r);
    } else problems.push({ level: 'error', path: dir, message: 'feature folder without feature.md' });
    for (const name of listDir(path.join(root, dir))) if (name !== 'feature.md') unexpected(path.join(dir, name));
  }

  // projects/<slug>.md
  for (const f of listDir(path.join(root, 'projects'))) {
    const rel = path.join('projects', f);
    if (!f.endsWith('.md')) {
      unexpected(rel);
      continue;
    }
    const slug = f.slice(0, -3);
    const r = readRec(store, rel, 'project', `project:${slug}`);
    r.projectSlug = slug;
    records.push(r);
  }

  // changes/<slug>/change.md, changes/<slug>/decisions/<date>-<slug>.md
  for (const slug of listDir(path.join(root, 'changes'))) {
    const dir = path.join('changes', slug);
    if (!isDir(path.join(root, dir))) {
      unexpected(dir);
      continue;
    }
    const changeFile = path.join(dir, 'change.md');
    if (fs.existsSync(path.join(root, changeFile))) {
      const r = readRec(store, changeFile, 'change', `change:${slug}`);
      r.changeSlug = slug;
      records.push(r);
    } else {
      problems.push({ level: 'error', path: dir, message: 'change folder without change.md' });
    }
    for (const name of listDir(path.join(root, dir))) {
      if (name === 'change.md' || name === 'plan.md') continue;
      if (name === 'decisions' && isDir(path.join(root, dir, 'decisions'))) {
        for (const f of listDir(path.join(root, dir, 'decisions'))) {
          const rel = path.join(dir, 'decisions', f);
          const m = DATED.exec(f);
          if (!m) {
            problems.push({ level: 'error', path: rel, message: 'decision file name must be <yyyy-mm-dd>-<slug>.md' });
            continue;
          }
          const r = readRec(store, rel, 'decision', `decision:${slug}/${m[2]}`);
          r.changeSlug = slug;
          r.decisionSlug = m[2];
          r.fileDate = m[1];
          records.push(r);
        }
        continue;
      }
      unexpected(path.join(dir, name));
    }
  }

  // decisions/<date>-<slug>.md (store level)
  for (const f of listDir(path.join(root, 'decisions'))) {
    const rel = path.join('decisions', f);
    const m = DATED.exec(f);
    if (!m) {
      problems.push({ level: 'error', path: rel, message: 'decision file name must be <yyyy-mm-dd>-<slug>.md' });
      continue;
    }
    const r = readRec(store, rel, 'decision', `decision:/${m[2]}`);
    r.decisionSlug = m[2];
    r.fileDate = m[1];
    records.push(r);
  }

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
      const r = readRec(store, rel, 'source', `${kind}:?${f.slice(0, -3)}`);
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
    const r = readRec(store, rel, 'session', `session:${m[2]}`);
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
    const r = readRec(store, rel, 'actor', `?:${handle}`);
    r.handle = handle;
    const k = r.data.kind;
    if (k === 'person' || k === 'agent') r.key = `${k}:${handle}`;
    records.push(r);
  }

  // anything else at the root that is not a store file
  for (const name of listDir(root)) {
    if (['products', 'features', 'projects', 'changes', 'decisions', 'sources', 'sessions', 'actors', 'pjman.yaml', 'index.db', 'events.jsonl', 'README.md'].includes(name)) continue;
    unexpected(name);
  }

  const byKey = new Map<string, Rec[]>();
  for (const r of records) {
    const list = byKey.get(r.key) ?? [];
    list.push(r);
    byKey.set(r.key, list);
  }
  const aliasOf = new Map<string, string>();
  for (const r of records) {
    if (r.type !== 'change' || !Array.isArray(r.data.aliases)) continue;
    for (const a of r.data.aliases) if (typeof a === 'string') aliasOf.set(a, r.key);
  }
  return { store, records, byKey, aliasOf, problems };
}

export type Resolution =
  | { status: 'ok'; rec: Rec }
  | { status: 'alias'; rec: Rec; via: string }
  | { status: 'invalid'; rec: Rec }
  | { status: 'source-key'; key: Key }
  | { status: 'actor-key'; key: Key }
  | { status: 'missing'; key: Key }
  | { status: 'malformed' };

/** Resolve a reference. Sources and actors need no record; changes, decisions and sessions do. */
export function resolve(loaded: Loaded, raw: unknown): Resolution {
  const key = parseKey(raw);
  if (!key) return { status: 'malformed' };
  const direct = loaded.byKey.get(key.raw)?.[0];
  if (direct) return direct.valid ? { status: 'ok', rec: direct } : { status: 'invalid', rec: direct };
  if (key.kind === 'change') {
    const target = loaded.aliasOf.get(key.rest);
    const rec = target ? loaded.byKey.get(target)?.[0] : undefined;
    if (rec) return { status: 'alias', rec, via: target! };
    return { status: 'missing', key };
  }
  if (key.kind === 'decision') {
    const i = key.rest.indexOf('/');
    const slug = i >= 0 ? key.rest.slice(0, i) : '';
    const target = slug ? loaded.aliasOf.get(slug) : undefined;
    if (target) {
      const rec = loaded.byKey.get(`decision:${target.slice('change:'.length)}${key.rest.slice(i)}`)?.[0];
      if (rec) return { status: 'alias', rec, via: rec.key };
    }
    return { status: 'missing', key };
  }
  if (key.kind === 'session' || key.kind === 'project' || key.kind === 'product' || key.kind === 'feature') return { status: 'missing', key };
  if (key.kind === 'person' || key.kind === 'agent') return { status: 'actor-key', key };
  if (key.kind === 'url') {
    const rec = loaded.byKey.get(canonicalSourceKey('url', key.rest))?.[0];
    if (rec) return rec.valid ? { status: 'ok', rec } : { status: 'invalid', rec };
  }
  return { status: 'source-key', key };
}

export function findSession(loaded: Loaded, id: string): Rec | undefined {
  return loaded.records.find((r) => r.type === 'session' && r.sessionId === id);
}
