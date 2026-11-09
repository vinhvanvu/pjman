// The store index (decisions dashboard-reads-slow/indexed-store and index-shape): every file of the store as last read,
// with its record parsed, kept beside the store so a load reads the index and parses only what changed since. The files
// stay the truth; the index is a cache that can be deleted and is rebuilt from them. It lives in the person's pjman
// folder (indexFileOf), not in the store.
//
// What the index has applied is its cursor: the event stream up to a byte (every write through pjman appends an event
// naming the file it wrote) and the commit the store's repository was at (a pull, a checkout or a reset moves the
// files without an event). A load moves the cursor: it reads the events since, diffs the commits since, and reads
// again only the files they name. A move, a removal, a replaced stream or a commit it cannot diff from makes it
// compare every file with what it holds instead. A process that writes a file and loads again before the write's
// event lands (a write's own validation, a batch) names the file as pending, and pending files are compared on every
// load.
//
// The library reads through IndexBackend, so the store for an organization is another backend behind the same calls;
// the one here is SQLite in the store's folder, in plain SQL a server database runs unchanged.
import './quiet.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { userDir, type Store } from './config.js';
import { parseRecord, type Parsed } from './frontmatter.js';
import { TOOL_VERSION } from './version.js';

/** One file or folder of the store as the index holds it. */
export interface Entry {
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  /** A record file's parse; null for a folder or a file that is not a record. */
  parsed: Parsed | null;
}

/** Where the index has read to. */
export interface Cursor {
  /** The index's format and the tool that wrote it: either changing means the parses are read again. */
  format: string;
  /** The event stream's file identity and the byte the index has read to. */
  streamIno: number;
  streamBytes: number;
  /** The commit the store's repository was at; null without one. */
  head: string | null;
}

/** What the index is kept in. The library calls only these. */
export interface IndexBackend {
  cursor(): Cursor | null;
  entries(): Entry[];
  /** Replace these entries and remove those paths, and move the cursor, as one write. */
  apply(put: Entry[], drop: string[], cursor: Cursor, replaceAll?: boolean): void;
  close(): void;
}

const FORMAT = `1:${TOOL_VERSION}`;

/** Where a store's index lives: in the person's pjman folder, one file per store folder, never in the store, so it is
 *  never committed with it and every worktree of a store in a project has its own. */
export function indexFileOf(store: Store): string {
  let root = store.root;
  try {
    root = fs.realpathSync(root);
  } catch {
    // a store not on disk yet
  }
  return path.join(userDir(), 'index', `${createHash('sha1').update(root).digest('hex').slice(0, 16)}.db`);
}

type Sqlite = typeof import('node:sqlite');
let sqlite: Sqlite | undefined;

/** The index in SQLite, in the store's folder. */
export class SqliteIndex implements IndexBackend {
  private db: import('node:sqlite').DatabaseSync;

  constructor(file: string) {
    sqlite ??= createRequire(import.meta.url)('node:sqlite') as Sqlite;
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (path TEXT PRIMARY KEY, dir INTEGER NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, parsed TEXT);
      CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), format TEXT NOT NULL, stream_ino INTEGER NOT NULL, stream_bytes INTEGER NOT NULL, head TEXT);
    `);
  }

  cursor(): Cursor | null {
    const row = this.db.prepare('SELECT format, stream_ino, stream_bytes, head FROM cursor WHERE id = 1').get() as { format: string; stream_ino: number; stream_bytes: number; head: string | null } | undefined;
    return row ? { format: row.format, streamIno: row.stream_ino, streamBytes: row.stream_bytes, head: row.head } : null;
  }

  entries(): Entry[] {
    const rows = this.db.prepare('SELECT path, dir, size, mtime, parsed FROM entries').all() as { path: string; dir: number; size: number; mtime: number; parsed: string | null }[];
    return rows.map((r) => ({ path: r.path, dir: r.dir === 1, size: r.size, mtime: r.mtime, parsed: r.parsed === null ? null : (JSON.parse(r.parsed) as Parsed) }));
  }

  apply(put: Entry[], drop: string[], cursor: Cursor, replaceAll = false): void {
    const ins = this.db.prepare('INSERT OR REPLACE INTO entries (path, dir, size, mtime, parsed) VALUES (?, ?, ?, ?, ?)');
    const del = this.db.prepare('DELETE FROM entries WHERE path = ?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (replaceAll) this.db.exec('DELETE FROM entries');
      for (const p of drop) del.run(p);
      for (const e of put) ins.run(e.path, e.dir ? 1 : 0, e.size, e.mtime, e.parsed === null ? null : JSON.stringify(e.parsed));
      this.db
        .prepare('INSERT OR REPLACE INTO cursor (id, format, stream_ino, stream_bytes, head) VALUES (1, ?, ?, ?, ?)')
        .run(cursor.format, cursor.streamIno, cursor.streamBytes, cursor.head);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}

// --- what changed ----------------------------------------------------------------------------------

/** Files written by this process whose events may not have landed yet, by store root. */
const pending = new Map<string, Set<string>>();

/** Name files this process wrote, so every later load in it compares them whatever the stream says. */
export function notePending(store: Store, rels: Iterable<string>): void {
  let set = pending.get(store.root);
  if (!set) pending.set(store.root, (set = new Set()));
  for (const r of rels) set.add(r);
}

/** Stores this process reshapes (moves, removes, batches, undoes): every later load in it compares every file. */
const reshaping = new Set<string>();

/** Say this process moves or removes files, or holds their events back: its loads compare every file from now on. */
export function noteReshaping(store: Store): void {
  reshaping.add(store.root);
}

/** Events that move or remove files in ways an event's one path does not name: read every file again. */
const RESHAPING = new Set(['moved', 'removed', 'applied', 'reverted', 'migrated', 'init']);

/** The files the stream names since `from`, and whether one of its events asks for every file to be compared. */
function streamSince(file: string, from: number): { paths: Set<string>; bytes: number; reshaped: boolean } {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    const end = buf.lastIndexOf(0x0a) + 1;
    const paths = new Set<string>();
    let reshaped = false;
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as { op?: string; path?: string };
        if (e.op && RESHAPING.has(e.op)) reshaped = true;
        if (typeof e.path === 'string' && e.path) paths.add(e.path);
      } catch {
        // a line that does not parse names nothing
      }
    }
    return { paths, bytes: from + end, reshaped };
  } finally {
    fs.closeSync(fd);
  }
}

/** The repository's folder (its .git, followed when it is a worktree's file) above `root`, or null. */
function gitDirOf(root: string): { dir: string; common: string } | null {
  for (let at = root; ; at = path.dirname(at)) {
    const dotgit = path.join(at, '.git');
    try {
      const st = fs.statSync(dotgit);
      let dir = dotgit;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, 'utf8'));
        if (!m) return null;
        dir = path.resolve(at, m[1].trim());
      }
      let common = dir;
      try {
        common = path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim());
      } catch {
        // not a linked worktree
      }
      return { dir, common };
    } catch {
      // not here
    }
    if (path.dirname(at) === at) return null;
  }
}

/** The commit HEAD names, read from the repository's files; null without a repository or a commit. */
export function headOf(root: string): string | null {
  const g = gitDirOf(root);
  if (!g) return null;
  try {
    const head = fs.readFileSync(path.join(g.dir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
    for (const base of [g.dir, g.common]) {
      try {
        return fs.readFileSync(path.join(base, ref), 'utf8').trim();
      } catch {
        // packed, or in the common folder
      }
    }
    const packed = fs.readFileSync(path.join(g.common, 'packed-refs'), 'utf8');
    for (const line of packed.split('\n')) if (line.endsWith(` ${ref}`)) return line.slice(0, line.indexOf(' '));
    return null;
  } catch {
    return null;
  }
}

/** The store's files that differ between two commits, relative to the store; null when git cannot say. */
function diffSince(root: string, from: string, to: string): string[] | null {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--relative', '--no-renames', '-z', from, to, '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

// --- reading the store ---------------------------------------------------------------------------

/** What the index never holds: the stream, the indexes, anything dotted. The store's root files are read live. */
const skip = (name: string) => name.startsWith('.');

/** One entry read from the disk; null when the path is gone. */
function readEntry(root: string, rel: string): Entry | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(path.join(root, rel));
  } catch {
    return null;
  }
  if (st.isDirectory()) return { path: rel, dir: true, size: 0, mtime: 0, parsed: null };
  const parsed = rel.endsWith('.md') ? parseRecord(fs.readFileSync(path.join(root, rel), 'utf8')) : null;
  return { path: rel, dir: false, size: st.size, mtime: st.mtimeMs, parsed };
}

/** Every file and folder below the root's folders, as size and time only. */
function walk(root: string): Map<string, { dir: boolean; size: number; mtime: number }> {
  const out = new Map<string, { dir: boolean; size: number; mtime: number }>();
  const visit = (rel: string) => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      if (skip(d.name)) continue;
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        out.set(child, { dir: true, size: 0, mtime: 0 });
        visit(child);
      } else if (rel) {
        const st = fs.statSync(path.join(root, child));
        out.set(child, { dir: false, size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  visit('');
  return out;
}

/** The store's files as of now: from the index, brought up to date with what moved since its cursor. */
export function indexedEntries(store: Store): Map<string, Entry> {
  const root = store.root;
  const file = indexFileOf(store);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new SqliteIndex(file);
  try {
    const cursor = db.cursor();
    const streamFile = path.join(root, 'events.jsonl');
    let stream: fs.Stats | null = null;
    try {
      stream = fs.statSync(streamFile);
    } catch {
      // no stream yet
    }
    const head = headOf(root);
    const next = (bytes: number): Cursor => ({ format: FORMAT, streamIno: stream?.ino ?? 0, streamBytes: bytes, head });

    // no index, or one an older tool wrote: read every file
    if (!cursor || cursor.format !== FORMAT) {
      const entries = new Map<string, Entry>();
      for (const [rel, w] of walk(root)) entries.set(rel, w.dir ? { path: rel, ...w, parsed: null } : readEntry(root, rel)!);
      db.apply([...entries.values()], [], next(stream?.size ?? 0), true);
      return entries;
    }

    const entries = new Map(db.entries().map((e) => [e.path, e]));
    const named = new Set<string>(pending.get(root) ?? []);
    let compareAll = reshaping.has(root);
    let bytes = cursor.streamBytes;
    if (stream) {
      if (stream.ino !== cursor.streamIno || stream.size < cursor.streamBytes) {
        compareAll = true;
        bytes = stream.size;
      } else if (stream.size > cursor.streamBytes) {
        const s = streamSince(streamFile, cursor.streamBytes);
        for (const p of s.paths) named.add(p);
        compareAll ||= s.reshaped;
        bytes = s.bytes;
      }
    }
    if (head !== cursor.head) {
      const diff = head && cursor.head ? diffSince(root, cursor.head, head) : null;
      if (diff) for (const p of diff) named.add(p);
      else compareAll = true;
    }

    const put: Entry[] = [];
    const drop: string[] = [];
    const refresh = (rel: string) => {
      const e = readEntry(root, rel);
      if (e) {
        entries.set(rel, e);
        put.push(e);
      } else if (entries.has(rel)) {
        entries.delete(rel);
        drop.push(rel);
      }
    };
    if (compareAll) {
      const now = walk(root);
      for (const [rel, w] of now) {
        const held = entries.get(rel);
        if (!held || held.dir !== w.dir || held.size !== w.size || held.mtime !== w.mtime) refresh(rel);
      }
      for (const rel of [...entries.keys()]) if (!now.has(rel)) refresh(rel);
    } else {
      for (const rel of named) {
        if (!rel || rel.startsWith('.') || !rel.includes('/')) continue;
        // the file, and every folder above it, as they stand now
        const held = entries.get(rel);
        let st: fs.Stats | null = null;
        try {
          st = fs.statSync(path.join(root, rel));
        } catch {
          // gone
        }
        if (!st || !held || held.size !== st.size || held.mtime !== st.mtimeMs || held.dir !== st.isDirectory()) refresh(rel);
        for (let dir = path.dirname(rel); dir !== '.' && dir !== ''; dir = path.dirname(dir)) {
          const there = fs.existsSync(path.join(root, dir));
          if (there !== entries.has(dir)) refresh(dir);
        }
        // a folder that went away takes what was beneath it
        if (!st) for (const k of [...entries.keys()]) if (k.startsWith(`${rel}/`)) refresh(k);
      }
    }
    if (put.length || drop.length || bytes !== cursor.streamBytes || head !== cursor.head || (stream?.ino ?? 0) !== cursor.streamIno) db.apply(put, drop, next(bytes));
    return entries;
  } finally {
    db.close();
  }
}
