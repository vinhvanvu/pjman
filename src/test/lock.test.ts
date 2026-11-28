import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, type Store } from '../store/config.js';
import { holdsLock, lockPath, lockStore, unlockStore, withStoreLock } from '../store/lock.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-lock-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'person:tester';
process.env.PJMAN_LOCK_WAIT_MS = '400';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pjman.js');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
/** A child process that holds the store's lock for `ms` milliseconds. */
const holder = (root: string, ms: number) =>
  spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { lockStore } from ${JSON.stringify(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'lock.js'))}; lockStore(${JSON.stringify(root)}); process.stdout.write('held\\n'); setTimeout(() => {}, ${ms});`,
    ],
    { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
  );
const onceHeld = (child: ReturnType<typeof spawn>) =>
  new Promise<void>((res) => child.stdout!.once('data', () => res()));

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
  init({ cwd: project });
  store = findStore(project)!;
});

test('the lock is a file under the user directory, re-entrant in one process, gone when released', () => {
  const file = lockPath(store.root);
  assert.ok(file.startsWith(path.join(home, 'locks')));
  lockStore(store.root);
  lockStore(store.root);
  assert.ok(holdsLock(store.root));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid);
  unlockStore(store.root);
  assert.ok(holdsLock(store.root), 'the inner release keeps the lock');
  unlockStore(store.root);
  assert.ok(!holdsLock(store.root));
  assert.ok(!fs.existsSync(file));
  assert.equal(
    withStoreLock(store.root, () => 7),
    7,
  );
  assert.ok(!fs.existsSync(file));
});

test('a second writer waits for a short hold and then takes the lock', async () => {
  const child = holder(store.root, 250);
  await onceHeld(child);
  const t = Date.now();
  withStoreLock(store.root, () => {});
  assert.ok(Date.now() - t >= 150, 'waited for the holder');
  child.kill();
});

test('a second writer refuses after the wait, naming the holder', async () => {
  const child = holder(store.root, 3000);
  await onceHeld(child);
  assert.throws(
    () => withStoreLock(store.root, () => {}),
    new RegExp(`the store is busy: another pjman is writing it \\(pid ${child.pid}`),
  );
  child.kill();
  await new Promise((res) => child.once('exit', res));
});

test('every command that writes the store takes its lock: code, person and tie wait for a writer and refuse after', async () => {
  const child = holder(store.root, 5000);
  await onceHeld(child);
  for (const args of [
    ['person', 'Sam'],
    ['tie', 'person:tester', 'owner', 'product:none'],
    ['code', 'link', 'feature:none', 'a.ts'],
  ]) {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: project, env: process.env, encoding: 'utf8' });
    assert.equal(r.status, 1, args[0]);
    assert.match(r.stderr, /the store is busy/, args[0]);
  }
  child.kill();
  await new Promise((res) => child.once('exit', res));
});

test('a lock left by a dead process is reclaimed at once', () => {
  const file = lockPath(store.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 - 7, at: new Date().toISOString() }));
  const t = Date.now();
  withStoreLock(store.root, () => {});
  assert.ok(Date.now() - t < 200);
  assert.ok(!fs.existsSync(file));
});

test('a lock that cannot be read is reclaimed, and a reclaim left half-done by a dead writer does not hold the next', () => {
  const file = lockPath(store.root);
  const reclaim = `${file}.reclaim`;
  const dead = JSON.stringify({ pid: 2 ** 22 - 7, at: new Date().toISOString() });
  // an empty file, and one that holds something other than a holder: nobody's lock
  // (nor is one with no time on it, even under a process that lives: it could never be read as hung)
  for (const text of ['', 'not json', '3', JSON.stringify({ pid: process.pid })]) {
    fs.writeFileSync(file, text);
    const t = Date.now();
    withStoreLock(store.root, () => {
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid, 'the lock taken is this writer’s own');
    });
    // (at once: without the wait a reclaim marker takes to grow old)
    assert.ok(Date.now() - t < 1500, `'${text}' is reclaimed at once`);
    assert.ok(!fs.existsSync(file));
  }
  // a writer died while reclaiming: its marker is old, and is cleared on sight
  fs.writeFileSync(file, dead);
  fs.mkdirSync(reclaim);
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(reclaim, old, old);
  let t = Date.now();
  withStoreLock(store.root, () => {});
  assert.ok(Date.now() - t < 1500, 'an old marker does not hold the lock');
  assert.ok(!fs.existsSync(reclaim) && !fs.existsSync(file));
  // a marker just made may be a writer at work: it is waited for, and cleared once it is old
  fs.writeFileSync(file, dead);
  fs.mkdirSync(reclaim);
  t = Date.now();
  withStoreLock(store.root, () => {});
  const took = Date.now() - t;
  assert.ok(took >= 1500 && took < 4000, `waited for the marker to grow old (${took} ms)`);
  assert.ok(!fs.existsSync(reclaim) && !fs.existsSync(file));
  // a lock moved aside by a waiter that read it as dead is released from where it was moved: put back after its
  // holder let go, it would stand under a process that lives on, held by nobody
  lockStore(store.root);
  const aside = `${file}.dead.${2 ** 22 - 7}`;
  fs.renameSync(file, aside);
  unlockStore(store.root);
  assert.ok(!fs.existsSync(aside) && !fs.existsSync(file));
  // nothing is left beside the lock: no writer's own file, no lock moved aside
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(path.basename(file))),
    [],
  );
});

test('two commands writing the store at once each land in their own commit', async () => {
  const run = (args: string[]) =>
    new Promise<string>((res, rej) =>
      execFile(
        process.execPath,
        [bin, ...args],
        { cwd: project, env: { ...process.env, PJMAN_LOCK_WAIT_MS: '8000' }, encoding: 'utf8' },
        (err, stdout, stderr) => (err ? rej(new Error(stderr || err.message)) : res(stdout)),
      ),
    );
  const before = git(store.root, 'rev-list', '--count', 'HEAD');
  const [a, b] = await Promise.all([
    run([
      'new',
      'change',
      'left',
      '--name',
      'Left',
      '--gist',
      'Left',
      '--origin',
      'asked',
      '--intent',
      'l',
      '--done-when',
      'd',
    ]),
    run([
      'new',
      'change',
      'right',
      '--name',
      'Right',
      '--gist',
      'Right',
      '--origin',
      'asked',
      '--intent',
      'r',
      '--done-when',
      'd',
    ]),
  ]);
  assert.match(a, /created change:(project\/)?left/);
  assert.match(b, /created change:(project\/)?right/);
  assert.equal(Number(git(store.root, 'rev-list', '--count', 'HEAD')) - Number(before), 2);
  const last = git(store.root, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean);
  const prior = git(store.root, 'show', '--name-only', '--format=%s', 'HEAD~1').split('\n').filter(Boolean);
  for (const c of [last, prior]) {
    const subject = c[0];
    const which = /left/.test(subject) ? 'left' : 'right';
    assert.match(subject, /^pjman: new change:(project\/)?(left|right)/);
    assert.ok(
      c.slice(1).every((p) => p.includes(`/changes/${which}/`)),
      `commit '${subject}' holds only its own files: ${c.slice(1).join(', ')}`,
    );
  }
});

test('the lock appears whole: many writers starting at once never see one half-written, and each takes its turn', async () => {
  process.env.PJMAN_LOCK_WAIT_MS = '5000';
  try {
    const lockJs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'store', 'lock.js');
    const log = path.join(tmp, 'turns.log');
    // each writer takes the lock, notes that it is in, waits, notes that it is out: two in at once would interleave
    const writer = (n: number) =>
      new Promise<number | null>((res) =>
        spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import fs from 'node:fs'; import { lockStore, unlockStore } from ${JSON.stringify(lockJs)};
           lockStore(${JSON.stringify(store.root)}); fs.appendFileSync(${JSON.stringify(log)}, 'in ${n}\\n');
           Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
           fs.appendFileSync(${JSON.stringify(log)}, 'out ${n}\\n'); unlockStore(${JSON.stringify(store.root)});`,
          ],
          { env: process.env, stdio: 'ignore' },
        ).on('close', res),
      );
    const codes = await Promise.all(Array.from({ length: 8 }, (_, n) => writer(n)));
    assert.deepEqual(
      codes,
      Array.from({ length: 8 }, () => 0),
    );
    const turns = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(turns.length, 16);
    for (let i = 0; i < turns.length; i += 2)
      assert.equal(turns[i + 1], turns[i].replace('in', 'out'), turns.join(' '));
  } finally {
    process.env.PJMAN_LOCK_WAIT_MS = '400';
  }
});
