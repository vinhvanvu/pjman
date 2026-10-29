import fs from 'node:fs';
import path from 'node:path';
import type { Store } from './config.js';
import { git } from './git.js';
import { parseKey } from './keys.js';
import type { RecordType } from './records.js';

/** One write to the store. The shape is part of the record contract; the transport (a file, a command that tails it) may change. */
export interface StoreEvent {
  /** Position in the stream; a rebuild renumbers. */
  seq: number;
  /** When the write happened (UTC instant). */
  at: string;
  op: 'created' | 'set' | 'log' | 'bind' | 'observe' | 'moved' | 'formatted' | 'removed' | 'init' | 'write' | 'applied' | 'reverted' | 'migrated';
  /** The record written, or `store` for the store itself. */
  key: string;
  type: RecordType | 'store';
  path: string;
  /** Names of the fields or sections that changed; absent on `created`. */
  fields?: string[];
  writer?: string;
  session?: string;
  /** The commit the write made, when the tool commits. */
  commit?: string | null;
}

export type EventInput = Omit<StoreEvent, 'seq' | 'at' | 'commit'>;

export function eventsPath(store: Store): string {
  return path.join(store.root, 'events.jsonl');
}

function parseLine(line: string): StoreEvent | null {
  try {
    const e = JSON.parse(line) as StoreEvent;
    return typeof e.seq === 'number' && typeof e.op === 'string' ? e : null;
  } catch {
    return null;
  }
}

/** The last sequence number in the file, from its tail. */
export function lastSeq(store: Store): number {
  const file = eventsPath(store);
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return 0;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 8192);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const e = parseLine(lines[i]);
      if (e) return e.seq;
    }
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/** Append events to the stream, numbered after the last one. */
export function emit(store: Store, inputs: EventInput[], commit: string | null = null, at: string = new Date().toISOString()): StoreEvent[] {
  if (inputs.length === 0) return [];
  let seq = lastSeq(store);
  const events = inputs.map((e) => ({ seq: ++seq, at, ...e, commit }));
  fs.appendFileSync(eventsPath(store), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return events;
}

/** Every event after `since`. */
export function readEvents(store: Store, since = 0): StoreEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(eventsPath(store), 'utf8');
  } catch {
    return [];
  }
  const out: StoreEvent[] = [];
  for (const line of text.split('\n')) {
    const e = line.trim() ? parseLine(line) : null;
    if (e && e.seq > since) out.push(e);
  }
  return out;
}

/** Deliver every event after `since`, then each new one as it is appended. Returns a stop function. */
export function follow(store: Store, since: number, fn: (e: StoreEvent) => void): () => void {
  let last = since;
  // the file is read again only once it changed: a follower held for a session's life costs a stat every two seconds
  let seen = '';
  const deliver = () => {
    let stamp = '';
    try {
      const st = fs.statSync(eventsPath(store));
      stamp = `${st.size}:${st.mtimeMs}`;
    } catch {
      // no stream yet
    }
    if (stamp && stamp === seen) return;
    seen = stamp;
    for (const e of readEvents(store, last)) {
      last = e.seq;
      fn(e);
    }
  };
  deliver();
  let timer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(deliver, 50);
  };
  const name = path.basename(eventsPath(store));
  const watcher = fs.watch(store.root, (_ev, file) => {
    if (!file || file === name) schedule();
  });
  // a safety net for platforms where fs.watch misses appends
  const poll = setInterval(deliver, 2000);
  return () => {
    watcher.close();
    clearInterval(poll);
    if (timer) clearTimeout(timer);
  };
}

export function formatEvent(e: StoreEvent): string {
  const fields = e.fields?.length ? ` ${e.fields.join(',')}` : '';
  const by = e.session ? ` (${e.session.replace(/^session:/, '').slice(0, 8)})` : '';
  return `#${e.seq} ${e.at.replace('T', ' ').slice(0, 19)} ${e.op.padEnd(9)} ${e.key}${fields}${by}`;
}

/** The stream is derived: a store created before it existed gets it added to .gitignore. */
export function ensureIgnored(store: Store): void {
  const file = path.join(store.root, '.gitignore');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const missing = ['events.jsonl', 'events.jsonl.tmp'].filter((n) => !text.split('\n').includes(n));
  if (missing.length) fs.writeFileSync(file, text.replace(/\n?$/, '\n') + missing.join('\n') + '\n');
}

// --- rebuild from git -------------------------------------------------------------------------

export const typeOfPath = (p: string): RecordType | null => {
  // products/<p>/{product.md, features/<f>/feature.md, changes/<c>/change.md, changes/<c>/decisions/<d>.md, decisions/<d>.md};
  // the flat forms (products/<p>.md, features/, changes/ at the root) are the layout before the migration, still in the history
  if (p.startsWith('products/')) {
    if (p.endsWith('/product.md') || !p.slice('products/'.length).includes('/')) return 'product';
    if (p.endsWith('/feature.md')) return 'feature';
    if (p.endsWith('/change.md')) return 'change';
    if (p.includes('/decisions/')) return 'decision';
    return null;
  }
  if (p.startsWith('features/') && p.endsWith('/feature.md')) return 'feature';
  if (p.startsWith('projects/')) return 'project';
  if (p.startsWith('changes/') && p.endsWith('/change.md')) return 'change';
  if (p.startsWith('changes/') && p.includes('/decisions/')) return 'decision';
  if (p.startsWith('decisions/')) return 'decision';
  if (p.startsWith('sources/')) return 'source';
  if (p.startsWith('sessions/')) return 'session';
  if (p.startsWith('actors/')) return 'actor';
  return null;
};

export function keyOfPath(p: string, type: RecordType, root: string, sha: string): string {
  const base = path.basename(p, '.md');
  const dated = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(base);
  const seg = p.split('/');
  const under = seg[0] === 'products' && seg.length > 2 ? seg[1] : null; // the product the path is beneath, in the current layout
  switch (type) {
    case 'product': return `product:${under ?? base}`;
    case 'feature': return under ? `feature:${under}/${seg[3]}` : `feature:${seg[1]}`;
    case 'project': return `project:${base}`;
    case 'change': return under ? `change:${under}/${seg[3]}` : `change:${seg[1]}`;
    case 'decision': {
      const slug = dated?.[1] ?? base;
      if (under) return seg[2] === 'changes' ? `decision:${under}/${seg[3]}/${slug}` : `decision:${under}/${slug}`;
      return p.startsWith('decisions/') ? `decision:/${slug}` : `decision:${seg[1]}/${slug}`;
    }
    case 'session': return `session:${dated?.[1] ?? base}`;
    case 'source':
    case 'actor': {
      // the key is in the frontmatter at that commit
      try {
        const text = git(root, ['show', `${sha}:${p}`]);
        const kind = /^kind:\s*(.+)$/m.exec(text)?.[1]?.trim();
        const key = /^key:\s*(.+)$/m.exec(text)?.[1]?.trim();
        if (type === 'source' && kind && key) return `${kind}:${key.replace(/^"(.*)"$/, '$1')}`;
        if (type === 'actor' && kind) return `${kind}:${base}`;
      } catch {
        // fall through
      }
      return `${type}:?${base}`;
    }
  }
}

/** Rewrite the stream from the store's git history: one event per record per commit. The stream is derived and disposable. */
export function rebuildEvents(store: Store): { events: number; commits: number } {
  const root = store.root;
  ensureIgnored(store);
  const log = git(root, ['log', '--reverse', '--format=%H%x1f%aI%x1f%s%x1f%(trailers:key=Pjman-Session,valueonly)']);
  const events: StoreEvent[] = [];
  let seq = 0;
  let commits = 0;
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, rawAt, subject, trailer] = line.split('\x1f');
    const at = new Date(rawAt).toISOString();
    commits++;
    const session = trailer?.trim() || undefined;
    const short = sha.slice(0, 7);
    const changed = git(root, ['show', '--name-status', '--format=', sha]).split('\n').filter(Boolean);
    const m = /^pjman: (\S+)(?: (.*))?$/.exec(subject);
    const verb = m?.[1];
    const rest = m?.[2] ?? '';
    if (verb === 'init') {
      events.push({ seq: ++seq, at, op: 'init', key: 'store', type: 'store', path: 'pjman.yaml', session, commit: short });
      continue;
    }
    if (verb === 'migrate') {
      // every record moved under its product: one event on the store, not one per record
      events.push({ seq: ++seq, at, op: 'migrated', key: 'store', type: 'store', path: 'pjman.yaml', fields: [`${changed.length} files`], session, commit: short });
      continue;
    }
    // the record the subject names comes first, as the live write emitted it
    const rows = changed.map((row) => row.split('\t')).map(([status, a, b]) => ({ status, p: b ?? a }));
    const named = rest.split(' ')[0];
    rows.sort((x, y) => {
      const tx = typeOfPath(x.p);
      const ty = typeOfPath(y.p);
      const nx = tx && keyOfPath(x.p, tx, root, sha) === named ? 0 : 1;
      const ny = ty && keyOfPath(y.p, ty, root, sha) === named ? 0 : 1;
      return nx - ny;
    });
    for (const { status, p } of rows) {
      const type = typeOfPath(p);
      if (!type) continue;
      if (status.startsWith('D')) {
        // a removed record: its key as it was in the parent commit
        if (verb === 'rm') events.push({ seq: ++seq, at, op: 'removed', key: keyOfPath(p, type, root, `${sha}^`), type, path: p, session, commit: short });
        continue;
      }
      const key = keyOfPath(p, type, root, sha);
      let op: StoreEvent['op'] = 'write';
      let fields: string[] | undefined;
      if (verb === 'new' && rest === key) op = 'created';
      else if (verb === 'rm') { op = 'set'; fields = ['references']; } // a record that lost a reference to the removed one
      else if (verb === 'new') { op = 'set'; fields = ['status']; } // the record a new decision superseded
      else if (verb === 'set') { op = 'set'; fields = rest.split(' ').slice(1); }
      else if (verb === 'session' && rest.startsWith('unbind')) { op = 'set'; fields = ['changes', 'observed', 'log']; }
      else if (verb === 'session' && (rest.startsWith('focus') || rest.startsWith('briefed'))) { op = 'set'; fields = [rest.startsWith('focus') ? 'focus' : 'briefed']; }
      else if (verb === 'session') { op = rest.startsWith('log') ? 'log' : rest.startsWith('bind') ? 'bind' : 'observe'; fields = [op === 'log' ? 'log' : op === 'bind' ? 'changes' : 'observed']; }
      else if (verb === 'note') { op = 'log'; fields = ['notes']; }
      else if (verb === 'mv') { op = status.startsWith('R') || key === rest.split(' ')[1] ? 'moved' : 'set'; if (op === 'set') fields = ['references']; }
      else if (verb === 'fmt') op = 'formatted';
      else if (verb === 'apply' || verb === 'undo') op = status.startsWith('A') ? 'created' : 'set';
      else if (status.startsWith('A')) op = 'created';
      let writer: string | undefined;
      if (op === 'created' || op === 'set') {
        try {
          writer = /^writer:\s*(.+)$/m.exec(git(root, ['show', `${sha}:${p}`]))?.[1]?.trim();
        } catch {
          // no writer recorded
        }
      }
      events.push({ seq: ++seq, at, op, key, type, path: p, fields, writer, session, commit: short });
    }
    // a batch or its undo closes with the event that names what it was for
    if (verb === 'apply' || verb === 'undo') {
      const forKey = git(root, ['log', '-1', '--format=%(trailers:key=Pjman-For,valueonly)', sha]).trim() || 'store';
      const forType = forKey === 'store' ? 'store' : (parseKey(forKey)?.kind as RecordType | undefined) ?? 'store';
      events.push({ seq: ++seq, at, op: verb === 'apply' ? 'applied' : 'reverted', key: forKey, type: forType, path: 'pjman.yaml', fields: [rest], session, commit: short });
    }
  }
  const tmp = eventsPath(store) + '.tmp';
  fs.writeFileSync(tmp, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
  fs.renameSync(tmp, eventsPath(store));
  return { events: events.length, commits };
}
