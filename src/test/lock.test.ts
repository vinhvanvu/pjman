import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
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
  init({ checkers: [], cwd: project });
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

test('a lock left by a dead process is reclaimed at once', () => {
  const file = lockPath(store.root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 - 7, at: new Date().toISOString() }));
  const t = Date.now();
  withStoreLock(store.root, () => {});
  assert.ok(Date.now() - t < 200);
  assert.ok(!fs.existsSync(file));
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
