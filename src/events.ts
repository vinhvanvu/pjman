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
  /** On a set that moved a change's or a decision's `status` (or, that aside, its `decided_by`): the new value. On a
   *  session's `bind` or a set of its `focus`: the key of the change. Absent otherwise, so a reader can say what a
   *  move was, not only that a field moved. */
  value?: string;
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

/** The stream as last read, per file: the events and how far into the file they reach. The stream only grows, so a
 *  later read parses only what was appended; a file that shrank or was replaced (a rebuild renumbers) is read whole
 *  again (change:dashboard-reads-slow). */
const streams = new Map<string, { ino: number; bytes: number; events: readonly StoreEvent[] }>();

function stream(store: Store): readonly StoreEvent[] {
  const file = eventsPath(store);
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    streams.delete(file);
    return [];
  }
  try {
    const st = fs.fstatSync(fd);
    let held = streams.get(file);
    if (held && (held.ino !== st.ino || st.size < held.bytes)) held = undefined;
    if (held && st.size === held.bytes) return held.events;
    const from = held?.bytes ?? 0;
    const buf = Buffer.alloc(st.size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    // only whole lines: a write caught halfway is read with the rest of it next time
    const end = buf.lastIndexOf(0x0a) + 1;
    const fresh: StoreEvent[] = [];
    for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
      const e = line.trim() ? parseLine(line) : null;
      if (e) fresh.push(e);
    }
    const events = Object.freeze(held ? [...held.events, ...fresh] : fresh);
    streams.set(file, { ino: st.ino, bytes: from + end, events });
    return events;
  } finally {
    fs.closeSync(fd);
  }
}

/** Every event after `since`. Read-only: the whole stream is shared by every reader in the process. */
export function readEvents(store: Store, since = 0): StoreEvent[] {
  // after a point, in a process that has not read the whole stream: only the tail past it
  if (since > 0 && !streams.has(eventsPath(store))) return tailEvents(store, { seq: since + 1 });
  const all = stream(store) as StoreEvent[];
  if (since <= 0) return all;
  // seq rises through the file; the first past `since` is found by halving
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (all[mid].seq > since) hi = mid;
    else lo = mid + 1;
  }
  return all.slice(lo);
}

/** The stream's tail: every event after the last one that is both before `seq` and before `at` (either may be
 *  absent), read back from the end of the file, so a process that needs only what is recent never reads the whole
 *  stream (change:dashboard-reads-slow). With the whole stream already read in this process, cut from that. */
export function tailEvents(store: Store, back: { seq?: number; at?: string }): StoreEvent[] {
  const before = (e: StoreEvent) => (back.seq === undefined || e.seq < back.seq) && (back.at === undefined || e.at < back.at);
  const file = eventsPath(store);
  const whole = streams.get(file);
  const cut = (all: readonly StoreEvent[]) => {
    let i = all.length;
    while (i > 0 && !before(all[i - 1])) i--;
    return all.slice(i);
  };
  if (whole) return cut(stream(store));
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const out: StoreEvent[] = [];
    let end = size;
    let carry = Buffer.alloc(0);
    const CHUNK = 1 << 16;
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = Buffer.concat([buf, carry]);
      // the first line of the chunk may be cut; it is read with the chunk before it
      const nl = start === 0 ? -1 : text.indexOf(0x0a);
      end = start;
      if (start > 0 && nl < 0) {
        // a line longer than the chunk: read on back until its start
        carry = text;
        continue;
      }
      carry = start === 0 ? Buffer.alloc(0) : text.subarray(0, nl + 1);
      const lines = text.subarray(nl + 1).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const e = lines[i].trim() ? parseLine(lines[i]) : null;
        if (!e) continue;
        if (before(e)) return out.reverse();
        out.push(e);
      }
    }
    return out.reverse();
  } finally {
    fs.closeSync(fd);
  }
}

/** What is derived from one read of the stream, built on first use and kept with it: a read that changes nothing
 *  reuses it, and the next append is a new read (change:dashboard-reads-slow). */
const derived = new WeakMap<readonly StoreEvent[], Map<string, unknown>>();
export function streamMemo<T>(events: readonly StoreEvent[], name: string, build: () => T): T {
  let bag = derived.get(events);
  if (!bag) derived.set(events, (bag = new Map()));
  if (!bag.has(name)) bag.set(name, build());
  return bag.get(name) as T;
}

const group = (events: readonly StoreEvent[], by: (e: StoreEvent) => string | undefined): Map<string, StoreEvent[]> => {
  const m = new Map<string, StoreEvent[]>();
  for (const e of events) {
    const k = by(e);
    if (k === undefined) continue;
    const at = m.get(k);
    if (at) at.push(e);
    else m.set(k, [e]);
  }
  return m;
};

/** Each key's events in the stream's order. */
export function eventsByKey(events: readonly StoreEvent[]): Map<string, StoreEvent[]> {
  return streamMemo(events, 'by-key', () => group(events, (e) => e.key));
}

/** Each session's events (those stamped with it), in the stream's order. */
export function eventsBySession(events: readonly StoreEvent[]): Map<string, StoreEvent[]> {
  return streamMemo(events, 'by-session', () => group(events, (e) => e.session));
}

/** The events at or after `since` (an instant): the stream's tail, read back from its end. The stream runs forward in
 *  time; a write stamped a little early (a clock, a batch) is still caught by reading an hour past the cut. */
export function eventsSince(events: readonly StoreEvent[], since: string): StoreEvent[] {
  const slack = new Date(Date.parse(since) - 3_600_000).toISOString();
  let i = events.length;
  while (i > 0 && events[i - 1].at >= slack) i--;
  return events.slice(i).filter((e) => e.at >= since);
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
  // products/<p>/{product.md, features/<f>/feature.md, changes/<c>/change.md, changes/<c>/decisions/<d>.md, decisions/<d>.md,
  // aspects/<a>/aspect.md, aspects/<a>/places/<p>.md};
  // the flat forms (products/<p>.md, features/, changes/ at the root) are the layout before the migration, still in the history
  if (p.startsWith('products/')) {
    if (p.endsWith('/product.md') || !p.slice('products/'.length).includes('/')) return 'product';
    if (p.endsWith('/feature.md')) return 'feature';
    if (p.endsWith('/change.md')) return 'change';
    if (p.includes('/decisions/')) return 'decision';
    if (p.endsWith('/aspect.md')) return 'aspect';
    if (p.includes('/aspects/') && p.includes('/places/')) return 'place';
    if (p.includes('/releases/')) return 'release';
    return null;
  }
  if (p.startsWith('features/') && p.endsWith('/feature.md')) return 'feature';
  if (p.startsWith('projects/')) return 'project';
  if (p.startsWith('changes/') && p.endsWith('/change.md')) return 'change';
  if (p.startsWith('changes/') && p.includes('/decisions/')) return 'decision';
  if (p.startsWith('decisions/')) return 'decision';
  if (p.startsWith('sources/')) return 'source';
  if (p.startsWith('sessions/')) return 'session';
  if (p.startsWith('session-kinds/')) return 'session-kind';
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
    case 'aspect': return `aspect:${under}/${seg[3]}`;
    case 'place': return `aspect:${under}/${seg[3]}/${base}`;
    case 'release': return `release:${under}/${base}`;
    case 'session': return `session:${dated?.[1] ?? base}`;
    case 'session-kind': return `session-kind:${base}`;
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

/** A record's text at a commit, empty when it was not there. */
function textAt(root: string, rev: string, p: string): string {
  try {
    return git(root, ['show', `${rev}:${p}`]);
  } catch {
    return '';
  }
}

/** A scalar field of a record's frontmatter, unquoted. */
function fieldOf(text: string, name: string): string | undefined {
  return new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1');
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
      else if (verb === 'decision') { op = 'set'; fields = ['thread', ...rest.split(' ').slice(1)]; } // entries appended to a decision's thread
      else if (verb === 'step') { op = 'set'; fields = ['plan', `step ${rest.split(' ')[1] ?? ''}`.trim()]; } // one move of a change's plan
      else if (verb === 'session' && rest.startsWith('unbind')) { op = 'set'; fields = ['changes', 'observed', 'log']; }
      else if (verb === 'session' && (rest.startsWith('focus') || rest.startsWith('briefed'))) { op = 'set'; fields = [rest.startsWith('focus') ? 'focus' : 'briefed']; }
      else if (verb === 'session') { op = rest.startsWith('log') ? 'log' : rest.startsWith('bind') ? 'bind' : 'observe'; fields = [op === 'log' ? 'log' : op === 'bind' ? 'changes' : 'observed']; }
      else if (verb === 'note') { op = 'log'; fields = ['notes']; }
      else if (verb === 'mv') { op = status.startsWith('R') || key === rest.split(' ')[1] ? 'moved' : 'set'; if (op === 'set') fields = ['references']; }
      else if (verb === 'fmt') op = 'formatted';
      else if (verb === 'apply' || verb === 'undo') op = status.startsWith('A') ? 'created' : 'set';
      else if (status.startsWith('A')) op = 'created';
      let writer: string | undefined;
      let value: string | undefined;
      if (op === 'created' || op === 'set') {
        const text = textAt(root, sha, p);
        writer = fieldOf(text, 'writer');
        if (op === 'set' && (type === 'change' || type === 'decision')) {
          // the value a set left: status when it moved, else decided_by; the field is named among the changed ones
          const prior = textAt(root, `${sha}^`, p);
          const moved = (['status', 'decided_by'] as const).find((f) => fieldOf(text, f) !== undefined && fieldOf(text, f) !== fieldOf(prior, f));
          if (moved) {
            value = fieldOf(text, moved);
            if (fields && !fields.includes(moved)) fields = [...fields, moved];
          }
        }
      }
      if (type === 'session' && (op === 'bind' || (op === 'set' && fields?.includes('focus')))) value = rest.split(' ')[2] || undefined;
      events.push({ seq: ++seq, at, op, key, type, path: p, fields, value, writer, session, commit: short });
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
