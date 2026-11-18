// The store lock: one writer at a time per store on this machine (decision store-lock/one-lock-per-write). A write
// stages the whole store and commits, so two writers at once could fail on git's index lock or commit each other's
// half-written files under the wrong message. The lock is taken before a write command touches a file and released
// after its commit; a second writer waits briefly, then refuses naming the holder; a lock whose process is gone is
// reclaimed. It lives under the user directory, keyed by the store's path, where no store's own commit sweep reaches.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { userDir } from './config.js';
import { CliError } from './util.js';

/** How long a second writer waits before refusing, and how old a live holder may be before it is taken for hung. */
const waitMs = () => Number(process.env.PJMAN_LOCK_WAIT_MS) || 5000;
const staleMs = () => Number(process.env.PJMAN_LOCK_STALE_MS) || 120_000;
const POLL_MS = 25;

interface Holder {
  pid: number;
  at: string;
  cmd?: string;
}

/** The lock file for a store: under the user directory, named by a hash of the store's path. */
export function lockPath(root: string): string {
  const id = createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(userDir(), 'locks', `${id}.lock`);
}

const held = new Map<string, number>(); // lock file → depth, for this process

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // someone else's process, alive
  }
}

function readHolder(file: string): Holder | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Holder;
  } catch {
    return null;
  }
}

/** A lock nobody holds: unreadable, its process gone, or held longer than any write takes. */
const isStale = (h: Holder | null): boolean => !h || !alive(h.pid) || Date.now() - Date.parse(h.at) > staleMs();

/** Take the store's lock for this process; re-entrant. Waits a few seconds for another writer, then refuses. */
export function lockStore(root: string): void {
  const file = lockPath(root);
  const depth = held.get(file) ?? 0;
  if (depth > 0) {
    held.set(file, depth + 1);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const holder: Holder = {
    pid: process.pid,
    at: new Date().toISOString(),
    cmd: process.argv.slice(2, 5).join(' ') || undefined,
  };
  const started = Date.now();
  for (;;) {
    // the lock appears whole or not at all: written beside it, then linked into place. Created and then written in two
    // steps, a second writer could read it in between, find nothing in it, take it for dead and remove it
    const mine = `${file}.${process.pid}`;
    try {
      fs.writeFileSync(mine, JSON.stringify(holder));
      fs.linkSync(mine, file);
      held.set(file, 1);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    } finally {
      fs.rmSync(mine, { force: true });
    }
    const other = readHolder(file);
    if (!other || isStale(other)) {
      // reclaimed by one writer at a time, and only if it is still the dead lock that was read: two waiters removing
      // "the stale lock" one after the other would have the second remove the first one's fresh lock
      const reclaim = `${file}.reclaim`;
      try {
        fs.mkdirSync(reclaim);
      } catch {
        // another writer is reclaiming (or died doing so: its marker is cleared once it is old)
        try {
          if (Date.now() - fs.statSync(reclaim).mtimeMs > 2000) fs.rmSync(reclaim, { recursive: true, force: true });
        } catch {
          // gone already
        }
        sleep(POLL_MS);
        continue;
      }
      try {
        if (isStale(readHolder(file))) fs.rmSync(file, { force: true });
      } finally {
        fs.rmSync(reclaim, { recursive: true, force: true });
      }
      continue;
    }
    if (Date.now() - started >= waitMs()) {
      throw new CliError(
        `the store is busy: another pjman is writing it (pid ${other.pid}${other.cmd ? `, ${other.cmd}` : ''}, since ${other.at}); try again in a moment`,
      );
    }
    sleep(POLL_MS);
  }
}

/** Release the lock this process holds on the store, once the outermost holder lets go. */
export function unlockStore(root: string): void {
  const file = lockPath(root);
  const depth = held.get(file) ?? 0;
  if (depth > 1) {
    held.set(file, depth - 1);
    return;
  }
  held.delete(file);
  const other = readHolder(file);
  if (other && other.pid === process.pid) fs.rmSync(file, { force: true });
}

/** Run `fn` holding the store's lock. */
export function withStoreLock<T>(root: string, fn: () => T): T {
  lockStore(root);
  try {
    return fn();
  } finally {
    unlockStore(root);
  }
}

/** Whether this process holds the store's lock. */
export const holdsLock = (root: string): boolean => (held.get(lockPath(root)) ?? 0) > 0;

process.on('exit', () => {
  for (const file of held.keys()) {
    const other = readHolder(file);
    if (other && other.pid === process.pid) fs.rmSync(file, { force: true });
  }
});
