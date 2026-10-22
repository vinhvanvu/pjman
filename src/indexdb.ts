import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Store } from './config.js';
import { canonicalSourceKey, parseKey } from './keys.js';
import { loadStore, resolve, type Loaded, type Rec } from './records.js';
import { uuidv7 } from './util.js';
import { validate } from './validate.js';

export interface IndexReport {
  path: string;
  records: Record<string, number>;
  sources_as_keys: number;
  edges: number;
  conflicts: { kind: string; key: string; paths: string[]; message: string }[];
  problems: { errors: number; warnings: number; infos: number };
}

type Sqlite = typeof import('node:sqlite');
let sqlite: Sqlite | undefined;
/** Loaded on first use so that commands that never touch the index never load node:sqlite. */
function dbOpen(file: string, opts?: { readOnly?: boolean }) {
  sqlite ??= createRequire(import.meta.url)('node:sqlite') as Sqlite;
  return new sqlite.DatabaseSync(file, opts ?? {});
}

export function indexPath(store: Store): string {
  return path.join(store.root, 'index.db');
}

const SCHEMA = `
CREATE TABLE records (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, type TEXT NOT NULL, path TEXT,
  title TEXT, status TEXT, created TEXT, writer TEXT, session TEXT, valid INTEGER NOT NULL, data TEXT
);
CREATE INDEX records_key ON records(key);
CREATE INDEX records_type ON records(type);
CREATE TABLE edges (
  edge TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, declared_on TEXT NOT NULL,
  observed INTEGER NOT NULL DEFAULT 0, at TEXT
);
CREATE INDEX edges_from ON edges(from_key); CREATE INDEX edges_to ON edges(to_key);
CREATE TABLE aliases (alias TEXT PRIMARY KEY, key TEXT NOT NULL);
CREATE TABLE conflicts (kind TEXT NOT NULL, key TEXT NOT NULL, paths TEXT NOT NULL, message TEXT NOT NULL);
CREATE TABLE problems (level TEXT NOT NULL, path TEXT NOT NULL, message TEXT NOT NULL);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
`;

function existingIds(file: string): Map<string, string> {
  const ids = new Map<string, string>();
  if (!fs.existsSync(file)) return ids;
  try {
    const d = dbOpen(file, { readOnly: true });
    for (const row of d.prepare('SELECT key, id FROM records').all() as { key: string; id: string }[]) {
      if (!ids.has(row.key)) ids.set(row.key, row.id);
    }
    d.close();
  } catch {
    // an unreadable old index is disposable
  }
  return ids;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function canon(raw: string): string {
  const k = parseKey(raw);
  return k && k.kind === 'url' ? canonicalSourceKey('url', k.rest) : raw;
}

/** Rebuild index.db from the records. Ids already minted for a key are kept. */
export function buildIndex(store: Store, loaded: Loaded = loadStore(store)): IndexReport {
  const file = indexPath(store);
  const ids = existingIds(file);
  const problems = validate(loaded);
  const tmp = file + '.tmp';
  fs.rmSync(tmp, { force: true });
  const db = dbOpen(tmp);
  db.exec(SCHEMA);

  const idFor = (key: string): string => {
    let id = ids.get(key);
    if (!id) {
      id = uuidv7();
      ids.set(key, id);
    }
    return id;
  };

  const insRec = db.prepare(
    'INSERT OR IGNORE INTO records (id, key, type, path, title, status, created, writer, session, valid, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  const insEdge = db.prepare('INSERT INTO edges (edge, from_key, to_key, declared_on, observed, at) VALUES (?,?,?,?,?,?)');
  const insAlias = db.prepare('INSERT OR REPLACE INTO aliases (alias, key) VALUES (?,?)');
  const insConflict = db.prepare('INSERT INTO conflicts (kind, key, paths, message) VALUES (?,?,?,?)');
  const insProblem = db.prepare('INSERT INTO problems (level, path, message) VALUES (?,?,?)');

  const conflicts: IndexReport['conflicts'] = [];
  const counts: Record<string, number> = {};
  const seenKeys = new Map<string, Rec>();
  const str = (v: unknown) => (typeof v === 'string' ? v : null);

  db.exec('BEGIN');
  for (const r of loaded.records) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
    const dup = seenKeys.get(r.key);
    if (dup) {
      const c = { kind: 'duplicate-key', key: r.key, paths: [dup.path, r.path], message: `two records resolve to '${r.key}'` };
      conflicts.push(c);
      // the second record gets its own id, under its path, so nothing is lost
      insRec.run(uuidv7(), r.key, r.type, r.path, str(r.data.title), str(r.data.status), str(r.data.created), str(r.data.writer), str(r.data.session), r.valid ? 1 : 0, JSON.stringify(r.data));
      continue;
    }
    seenKeys.set(r.key, r);
    insRec.run(idFor(r.key), r.key, r.type, r.path, str(r.data.title), str(r.data.status), str(r.data.created), str(r.data.writer), str(r.data.session), r.valid ? 1 : 0, JSON.stringify(r.data));
  }

  const sourceKeys = new Set<string>();
  const noteSource = (raw: string) => {
    const k = parseKey(raw);
    if (!k || ['person', 'agent', 'change', 'decision', 'session', 'project'].includes(k.kind)) return;
    const c = canon(raw);
    if (!seenKeys.has(c)) sourceKeys.add(c);
  };
  const edge = (name: string, from: string, to: string, on: Rec) => insEdge.run(name, from, canon(to), on.path, 0, null);

  const boundBy = new Map<string, Rec[]>();
  for (const r of loaded.records) {
    if (!r.valid) continue;
    const d = r.data;
    switch (r.type) {
      case 'project':
        for (const k of list(d.links)) {
          edge('links', r.key, k, r);
          noteSource(k);
        }
        break;
      case 'change':
        if (typeof d.project === 'string') edge('project', r.key, d.project, r);
        for (const k of list(d.binds)) {
          edge('binds', r.key, k, r);
          noteSource(k);
          const c = canon(k);
          boundBy.set(c, [...(boundBy.get(c) ?? []), r]);
        }
        for (const k of list(d.links)) {
          edge('links', r.key, k, r);
          noteSource(k);
        }
        for (const a of list(d.aliases)) insAlias.run(`change:${a}`, r.key);
        break;
      case 'decision':
        if (typeof d.supersedes === 'string') {
          const res = resolve(loaded, d.supersedes);
          edge('supersedes', r.key, res.status === 'ok' || res.status === 'alias' ? res.rec.key : d.supersedes, r);
        }
        for (const k of list(d.links)) {
          edge('links', r.key, k, r);
          noteSource(k);
        }
        if (r.changeSlug) edge('in', r.key, `change:${r.changeSlug}`, r);
        break;
      case 'source':
        for (const k of list(d.links)) {
          edge('links', r.key, k, r);
          noteSource(k);
        }
        break;
      case 'session':
        if (typeof d.parent === 'string') edge('parent', r.key, d.parent, r);
        for (const k of list(d.changes)) {
          const res = resolve(loaded, k);
          edge('changes', r.key, res.status === 'ok' || res.status === 'alias' ? res.rec.key : k, r);
        }
        if (Array.isArray(d.observed)) {
          for (const o of d.observed) {
            if (!o || typeof o !== 'object') continue;
            const e = o as Record<string, unknown>;
            if (typeof e.edge !== 'string' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
            insEdge.run(e.edge, e.from, canon(e.to), r.path, 1, typeof e.at === 'string' ? e.at : null);
            noteSource(e.from);
            noteSource(e.to);
          }
        }
        break;
      case 'actor':
        break;
    }
    if (typeof d.writer === 'string') edge('writer', r.key, d.writer, r);
    if (typeof d.session === 'string') edge('session', r.key, d.session, r);
  }
  for (const key of sourceKeys) {
    insRec.run(idFor(key), key, 'source', null, null, null, null, null, null, 1, null);
  }
  for (const [src, recs] of boundBy) {
    if (recs.length > 1) {
      conflicts.push({ kind: 'double-bind', key: src, paths: recs.map((r) => r.path), message: `'${src}' is bound by ${recs.map((r) => r.key).join(' and ')}` });
    }
  }
  for (const c of conflicts) insConflict.run(c.kind, c.key, JSON.stringify(c.paths), c.message);
  for (const p of problems) insProblem.run(p.level, p.path, p.message);
  db.prepare('INSERT INTO meta (k, v) VALUES (?,?)').run('built', new Date().toISOString());
  db.prepare('INSERT INTO meta (k, v) VALUES (?,?)').run('store', store.root);
  db.exec('COMMIT');
  const edgeCount = (db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number }).n;
  db.close();
  fs.renameSync(tmp, file);

  return {
    path: file,
    records: counts,
    sources_as_keys: sourceKeys.size,
    edges: edgeCount,
    conflicts,
    problems: {
      errors: problems.filter((p) => p.level === 'error').length,
      warnings: problems.filter((p) => p.level === 'warning').length,
      infos: problems.filter((p) => p.level === 'info').length,
    },
  };
}

export function query(store: Store, sql: string): unknown[] {
  const file = indexPath(store);
  if (!fs.existsSync(file)) buildIndex(store);
  const d = dbOpen(file, { readOnly: true });
  try {
    return d.prepare(sql).all();
  } finally {
    d.close();
  }
}
