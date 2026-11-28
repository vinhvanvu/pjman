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

/** How long a second writer waits before refusing, and how old a live holder may be before it is taken for hung: well
 *  past any write, since no command holds the lock while it waits on Entire (withoutStoreLock). */
const waitMs = () => Number(process.env.PJMAN_LOCK_WAIT_MS) || 5000;
const staleMs = () => Number(process.env.PJMAN_LOCK_STALE_MS) || 600_000;
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

/** Who holds the lock: undefined when there is no lock (released, not dead), null when the file cannot be read. */
function readHolder(file: string): Holder | null | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : null;
  }
  try {
    const h = JSON.parse(text) as Holder | null;
    // (a holder names its process and when it took the lock: without the time it could never be read as hung)
    return h && typeof h.pid === 'number' && Number.isFinite(Date.parse(h.at)) ? h : null;
  } catch {
    return null;
  }
}

/** A lock nobody holds: unreadable, its process gone, or held longer than any write takes. */
const isStale = (h: Holder | null): boolean => !h || !alive(h.pid) || Date.now() - Date.parse(h.at) > staleMs();

/** Remove a lock read as dead, and only that one: it is moved aside first and what was moved is read. Removed by
 *  its path, a lock released and taken afresh since the read would be the one removed, and two writers would hold
 *  the store; a fresh lock found in what was moved is put back. */
function removeDead(file: string): void {
  const aside = `${file}.dead.${process.pid}`;
  try {
    fs.renameSync(file, aside);
  } catch {
    return; // gone already
  }
  try {
    const moved = readHolder(aside);
    if (moved && !isStale(moved)) fs.linkSync(aside, file);
  } catch {
    // its place was taken meanwhile: nothing to put back into
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

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
    // released since the link was refused: there is nothing to reclaim, and the link is tried again. Taken for a dead
    // lock, each release under contention would send the waiters to remove whatever lock came next
    if (other === undefined) {
      // (a path that refuses the link and still reads as nothing there, a dangling link, is not waited on forever)
      if (Date.now() - started >= waitMs())
        throw new CliError(`the store is busy: its lock could not be taken (${file}); try again in a moment`);
      sleep(1);
      continue;
    }
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
        const still = readHolder(file);
        if (still !== undefined && isStale(still)) removeDead(file);
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

/** Remove this process's lock. A waiter that read it as dead may have moved it aside (removeDead) and be about to
 *  put it back: not found in its place, it is removed from where it was moved, and looked for in its place once
 *  more, so a lock nobody holds is never put back to stand under a process that lives on. */
function release(file: string): void {
  const mine = (f: string): boolean => {
    if (readHolder(f)?.pid !== process.pid) return false;
    fs.rmSync(f, { force: true });
    return true;
  };
  if (mine(file)) return;
  const dir = path.dirname(file);
  let beside: string[] = [];
  try {
    beside = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of beside) if (f.startsWith(`${path.basename(file)}.dead.`)) mine(path.join(dir, f));
  mine(file);
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
  release(file);
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

/** Run `fn` with the store's lock let go, and take it back after: for a locked command's wait on Entire, whose writes
 *  take the lock themselves. Other writers go ahead meanwhile, so what was read before is read again after. */
export function withoutStoreLock<T>(root: string, fn: () => T): T {
  const file = lockPath(root);
  const depth = held.get(file) ?? 0;
  if (!depth) return fn();
  held.delete(file);
  release(file);
  let out: T;
  try {
    out = fn();
  } catch (e) {
    // fn's own error is the one told; a lock not taken back is let go with the process
    try {
      retake(root, depth);
    } catch {
      // (fn's error stands)
    }
    throw e;
  }
  try {
    retake(root, depth);
  } catch {
    // fn's writes have landed under the lock they took themselves; what the command writes after takes it again
  }
  return out;
}

/** Take the lock back at the depth it was held, however long the other writers take: the command goes on as it began.
 *  Only a busy store is waited on; any other failure is thrown at once. */
function retake(root: string, depth: number): void {
  for (const until = Date.now() + staleMs(); ;) {
    try {
      lockStore(root);
      held.set(lockPath(root), depth);
      return;
    } catch (e) {
      if (!/the store is busy/.test((e as Error).message) || Date.now() > until) throw e;
    }
  }
}

/** Whether this process holds the store's lock. */
export const holdsLock = (root: string): boolean => (held.get(lockPath(root)) ?? 0) > 0;

process.on('exit', () => {
  for (const file of held.keys()) release(file);
});
