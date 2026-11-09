import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { rm } from '../commands/rm.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { diskSource, loadStore, type Loaded } from '../records.js';
import { indexFileOf, notePending, SqliteIndex } from '../store-index.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-index-'));
let store: Store;
let project: string;

/** The store read through the index and read from the disk, as the same records. */
function same(s: Store): Loaded {
  const viaIndex = loadStore(s);
  const fromDisk = loadStore(s, diskSource(s.root));
  const shape = (l: Loaded) => ({
    records: l.records.map((r) => ({ key: r.key, path: r.path, type: r.type, valid: r.valid, data: r.data, body: r.body })),
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
    throw new Error(`git ${args.join(' ')}: ${err.stdout ?? ''}${err.stderr ?? ''}`);
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
