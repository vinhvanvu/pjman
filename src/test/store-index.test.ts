import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { rm } from '../ops/rm.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { diskSource, loadStore, type Loaded } from '../store/records.js';
import { indexFileOf, notePending, SqliteIndex } from '../store/store-index.js';
import { change } from './shape.js';
import { settleIndex } from '../ops/write.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-index-'));
let store: Store;
let project: string;

/** The store read through the index and read from the disk, as the same records. */
function same(s: Store): Loaded {
  const viaIndex = loadStore(s);
  const fromDisk = loadStore(s, diskSource(s.root));
  const shape = (l: Loaded) => ({
    records: l.records.map((r) => ({
      key: r.key,
      path: r.path,
      type: r.type,
      valid: r.valid,
      data: r.data,
      body: r.body,
    })),
    problems: l.problems,
    aliases: [...l.aliases],
  });
  assert.deepEqual(shape(viaIndex), shape(fromDisk));
  return viaIndex;
}

const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`git ${args.join(' ')}: ${err.stdout ?? ''}${err.stderr ?? ''}`, { cause: e });
  }
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  project = path.join(tmp, 'web');
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  init({ checkers: [], cwd: project, name: 'web' });
  store = findStore(project)!;
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:web' });
  change(store, 'card-form', { title: 'Card form', project: 'project:web', features: ['feature:web/checkout'] });
});

test('the index is kept outside the store and reads as the disk does', () => {
  same(store);
  assert.ok(fs.existsSync(indexFileOf(store)));
  assert.ok(!fs.readdirSync(store.root).some((n) => n.endsWith('.db')));
});

test('a write through pjman is read at once', () => {
  same(store);
  set(store, 'change:web/card-form', ['gist=Cards are saved at checkout'], {});
  const l = same(store);
  assert.equal(l.byKey.get('change:web/card-form')?.[0].data.gist, 'Cards are saved at checkout');
  change(store, 'saved-cards', { title: 'Saved cards', project: 'project:web' });
  assert.ok(same(store).byKey.has('change:web/saved-cards'));
});

test('a file moved by a commit, with no event, is read once the commit lands', () => {
  same(store);
  const file = path.join(store.root, loadStore(store).byKey.get('change:web/card-form')![0].path);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^gist: .*$/m, 'gist: Changed in a pull'));
  git(store.root, '-c', 'user.email=t@example.com', '-c', 'user.name=tester', 'commit', '-qam', 'a teammate');
  assert.equal(same(store).byKey.get('change:web/card-form')?.[0].data.gist, 'Changed in a pull');
});

test('a file this process names as pending is read whatever the stream says', () => {
  same(store);
  const rel = loadStore(store).byKey.get('change:web/saved-cards')![0].path;
  const file = path.join(store.root, rel);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^gist: .*$/m, 'gist: Written before its event'));
  notePending(store, [rel]);
  assert.equal(same(store).byKey.get('change:web/saved-cards')?.[0].data.gist, 'Written before its event');
});

test('a removed record and its folder leave the index', () => {
  same(store);
  rm(store, 'change:web/saved-cards');
  const l = same(store);
  assert.ok(!l.byKey.has('change:web/saved-cards'));
});

test('an index written by another version is read again whole', () => {
  same(store);
  const db = new SqliteIndex(indexFileOf(store));
  const c = db.cursor()!;
  db.apply([], [], { ...c, format: 'old' });
  db.close();
  same(store);
  const again = new SqliteIndex(indexFileOf(store));
  assert.notEqual(again.cursor()!.format, 'old');
  again.close();
});

test('a replaced stream makes the index compare every file', () => {
  same(store);
  const file = path.join(store.root, loadStore(store).byKey.get('change:web/card-form')![0].path);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^gist: .*$/m, 'gist: Edited by hand'));
  const events = path.join(store.root, 'events.jsonl');
  const text = fs.readFileSync(events, 'utf8');
  fs.rmSync(events);
  fs.writeFileSync(events, text);
  assert.equal(same(store).byKey.get('change:web/card-form')?.[0].data.gist, 'Edited by hand');
});

test('PJMAN_INDEX=0 reads the disk', () => {
  fs.rmSync(indexFileOf(store));
  process.env.PJMAN_INDEX = '0';
  try {
    same(store);
    assert.ok(!fs.existsSync(indexFileOf(store)));
  } finally {
    delete process.env.PJMAN_INDEX;
  }
});

test('a refused create leaves no entry behind for the next process (change:refused-write-leaves-index-entry)', () => {
  same(store);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'cli', 'main.js');
  const run = (...args: string[]) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [cli, ...args], {
          cwd: project,
          env: { ...process.env, PJMAN_SESSION: '' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const fields = [
    '--name',
    'Ghost',
    '--gist',
    'A change refused once',
    '--origin',
    'a test',
    '--intent',
    'Nothing.',
    '--done-when',
    'Never.',
  ];
  const refused = run('new', 'change', 'ghost', ...fields, '--links', 'change:web/card-form');
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /would not validate/);
  assert.ok(!fs.existsSync(path.join(store.root, 'products/web/changes/ghost')));
  // another process reads the store as the disk has it: no phantom, nothing to report, and the create goes through
  const checked = run('validate');
  assert.equal(checked.code, 0, checked.out);
  assert.doesNotMatch(checked.out, /ghost/);
  const again = run('new', 'change', 'ghost', ...fields);
  assert.equal(again.code, 0, again.out);
  same(store);
});

test('an undo settled through the index is not read back by the next process (rm and apply undo this way)', () => {
  same(store);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'cli', 'main.js');
  const rel = 'products/web/changes/undone/change.md';
  const abs = path.join(store.root, rel);
  const file = loadStore(store).byKey.get('change:web/card-form')![0];
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fs.readFileSync(file.abs, 'utf8'));
  notePending(store, [rel]);
  loadStore(store); // the write as validation reads it: into the index
  fs.rmSync(path.dirname(abs), { recursive: true });
  settleIndex(store, [rel]);
  const out = execFileSync(process.execPath, [cli, 'ls', 'change'], {
    cwd: project,
    env: { ...process.env, PJMAN_SESSION: '' },
    encoding: 'utf8',
  });
  assert.doesNotMatch(out, /undone/);
  same(store);
});

test('pjman index reads every file again, clearing an entry whose file is gone', () => {
  same(store);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'cli', 'main.js');
  const rel = 'products/web/changes/drifted/change.md';
  const abs = path.join(store.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fs.readFileSync(loadStore(store).byKey.get('change:web/card-form')![0].abs, 'utf8'));
  notePending(store, [rel]);
  loadStore(store);
  fs.rmSync(path.dirname(abs), { recursive: true }); // gone with no event: the index drifts
  const ls = () =>
    execFileSync(process.execPath, [cli, 'ls', 'change'], {
      cwd: project,
      env: { ...process.env, PJMAN_SESSION: '' },
      encoding: 'utf8',
    });
  assert.match(ls(), /drifted/);
  execFileSync(process.execPath, [cli, 'index'], {
    cwd: project,
    env: { ...process.env, PJMAN_SESSION: '' },
    encoding: 'utf8',
  });
  assert.doesNotMatch(ls(), /drifted/);
  settleIndex(store, [rel]);
  same(store);
});
