// The store at a moment (decision read-at-a-moment/moment-is-an-event). Every write lands as one commit and one
// numbered event, so the store as of an event is the store at that event's commit. A moment is named by an event's
// sequence number; an instant is accepted and resolves to the last event at or before it. The records are read from
// the commit without touching the working tree, and the loaded store is cached by commit, so stepping and scrubbing
// cost one tree read per distinct commit.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Store } from './config.js';
import { readEvents, type StoreEvent } from './events.js';
import { git } from './git.js';
import { isLegacyLayout, loadStore, type Loaded, type Source } from './records.js';
import { CliError } from './util.js';

export interface Moment {
  /** The event the moment is named by. */
  seq: number;
  /** When that event happened. */
  at: string;
  /** The commit the store stood at after it. */
  commit: string;
}

/** What a request may name: an event's sequence number (digits) or an instant (anything Date parses). */
export type At = number | string;

const SEQ = /^\d+$/;

/** The moment a request names, from the stream. A sequence number past the end resolves to the last event; an instant
 *  resolves to the last event at or before it. Refused before the first event, and when no commit stands behind it. */
export function resolveMoment(store: Store, at: At, events: StoreEvent[] = readEvents(store)): Moment {
  if (events.length === 0) throw new CliError('the store has no events yet, so it has no moments');
  let i: number;
  if (typeof at === 'number' || SEQ.test(at)) {
    const seq = typeof at === 'number' ? at : Number(at);
    if (!Number.isInteger(seq) || seq < 1) throw new CliError(`at=${at}: a moment is an event's sequence number (1 or more) or an instant`);
    i = events.findIndex((e) => e.seq >= seq);
    if (i === -1) i = events.length - 1;
    else if (events[i].seq > seq) i = i - 1; // a gap in the numbering: the last event before it
    if (i < 0) throw new CliError(`at=${at}: before the first event (#${events[0].seq})`);
  } else {
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) throw new CliError(`at=${at}: not an event's sequence number and not an instant`);
    const iso = new Date(ms).toISOString();
    i = -1;
    for (let k = events.length - 1; k >= 0; k--) {
      if (events[k].at <= iso) {
        i = k;
        break;
      }
    }
    if (i < 0) throw new CliError(`at=${at}: before the first event (${events[0].at})`);
  }
  const target = events[i];
  // the commit the store stood at: this event's, else the nearest earlier write that committed
  let commit: string | null = null;
  for (let k = i; k >= 0 && !commit; k--) commit = events[k].commit ?? null;
  if (!commit) throw new CliError(`at=${at}: no commit stands behind event #${target.seq}; the store's history begins later`);
  return { seq: target.seq, at: target.at, commit };
}

/** The events between two points: `since < seq <= until`. */
export function eventsBetween(store: Store, since: number, until: number): StoreEvent[] {
  return readEvents(store, since).filter((e) => e.seq <= until);
}

/** The store's files at a commit, read through git without a checkout: the tree listed once, every record's text
 *  fetched in one batch. */
export function gitSource(root: string, commit: string): Source {
  let listing: string;
  try {
    listing = git(root, ['ls-tree', '-r', '--name-only', '-z', commit]);
  } catch (e) {
    throw new CliError(`commit ${commit} is not in the store's history (${(e as Error).message.split('\n')[0]})`);
  }
  const files = listing.split('\0').filter(Boolean);
  const fileSet = new Set(files);
  const dirs = new Set<string>(['']);
  const children = new Map<string, Set<string>>();
  const add = (dir: string, name: string) => {
    let s = children.get(dir);
    if (!s) children.set(dir, (s = new Set()));
    s.add(name);
  };
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (i < parts.length - 1) dirs.add(parts.slice(0, i + 1).join('/'));
      add(dir, parts[i]);
    }
  }
  // every text file the loader may read, in one cat-file call
  const wanted = files.filter((f) => f.endsWith('.md') || f.endsWith('.yaml'));
  const texts = new Map<string, string>();
  if (wanted.length) {
    const out = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: wanted.map((f) => `${commit}:${f}\n`).join(''),
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let pos = 0;
    for (const f of wanted) {
      const nl = out.indexOf(10, pos);
      const header = out.subarray(pos, nl).toString('utf8');
      pos = nl + 1;
      if (header.endsWith(' missing')) continue;
      const size = Number(header.split(' ')[2]);
      texts.set(f, out.subarray(pos, pos + size).toString('utf8'));
      pos += size + 1; // the newline after the object
    }
  }
  const norm = (rel: string) => (rel === '.' ? '' : rel.split(path.sep).join('/').replace(/\/$/, ''));
  return {
    list: (rel) => [...(children.get(norm(rel)) ?? [])].filter((n) => !n.startsWith('.')).sort(),
    isDir: (rel) => dirs.has(norm(rel)),
    exists: (rel) => fileSet.has(norm(rel)) || dirs.has(norm(rel)),
    read: (rel) => {
      const t = texts.get(norm(rel));
      if (t === undefined) throw new CliError(`${rel} is not in commit ${commit}`);
      return t;
    },
  };
}

const CACHE_SIZE = 32;
const cache = new Map<string, Loaded>();
let hits = 0;

/** The store as of a moment: the records at its commit, loaded as the working tree would be. Cached by commit in this
 *  process; the copy handed back is shallow, so a caller may set its scope without touching the cache. */
export function loadAt(store: Store, at: At): { moment: Moment; loaded: Loaded } {
  const moment = resolveMoment(store, at);
  const key = `${store.root}@${moment.commit}`;
  let loaded = cache.get(key);
  if (loaded) {
    hits++;
    cache.delete(key);
    cache.set(key, loaded);
  } else {
    const src = gitSource(store.root, moment.commit);
    if (isLegacyLayout(src)) throw new CliError(`at=${at}: event #${moment.seq} (${moment.at}) is before the store's layout migration, and moments before it cannot be read`);
    loaded = loadStore(store, src);
    cache.set(key, loaded);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return { moment, loaded: { ...loaded } };
}

/** For tests and the curious: what the cache holds. */
export function momentCache(): { size: number; hits: number } {
  return { size: cache.size, hits };
}
