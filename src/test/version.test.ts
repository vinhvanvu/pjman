// The store names its version (decision releases-homebrew/store-names-its-version): init stamps the format, a store
// from before the stamp reads as 0.1.0 and its one pending move is the stamp, a store newer than the tool is refused,
// an older one is told to migrate, and each move names the version that introduced it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { describeMigration, FORMAT_VERSION, formatMismatch, migrate, MIGRATIONS, pendingMigration, storeVersion } from '../commands/migrate.js';
import { newRecord } from '../commands/new.js';
import { findStore, loadStoreConfig, writeStoreConfig, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { loadStore } from '../records.js';
import { validate } from '../validate.js';
import { compareVersions, TOOL_VERSION, UNSTAMPED_VERSION } from '../version.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-version-'));
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
let store: Store;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: web });
  init({ checkers: [], cwd: web, name: 'web' });
  store = findStore(web)!;
});

test('versions compare as semver; the tool has one; the format is the latest move', () => {
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.match(TOOL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(FORMAT_VERSION, /^\d+\.\d+\.\d+$/);
  // the format may run ahead of the package between a move being written and the release that ships it; the release
  // command refuses a move whose version is not the release's
  for (const m of MIGRATIONS) assert.ok(compareVersions(m.since, FORMAT_VERSION) <= 0);
  assert.match(describeMigration('layout'), /the layout move .*introduced in 0\.2\.0/);
  assert.match(describeMigration('stamp'), new RegExp(FORMAT_VERSION.replace(/\./g, '\\.')));
});

test('init stamps the format; nothing waits; the tool writes it', () => {
  assert.equal(loadStoreConfig(store.root).version, FORMAT_VERSION);
  assert.equal(storeVersion(store), FORMAT_VERSION);
  assert.equal(pendingMigration(store), null);
  assert.equal(formatMismatch(store, TOOL_VERSION), null);
  assert.throws(() => migrate(store), /nothing to migrate.*format/);
  assert.ok(!validate(loadStore(store)).some((p) => /names no format version/.test(p.message)));
});

test('a store from before the stamp reads as 0.1.0: validate says so, its one pending move is the stamp, and migrate stamps it as one commit and one event', () => {
  const { version: _dropped, ...without } = loadStoreConfig(store.root);
  writeStoreConfig(store.root, without);
  git(store.root, 'add', '-A');
  git(store.root, 'commit', '-qm', 'before the stamp');
  const unstamped = findStore(path.join(tmp, 'web'))!;
  assert.equal(unstamped.config.version, undefined);
  assert.equal(storeVersion(unstamped), UNSTAMPED_VERSION);
  assert.ok(validate(loadStore(unstamped)).some((p) => p.level === 'info' && /names no format version/.test(p.message)));
  // never refused: the moves guard themselves, and the stamp follows them
  assert.equal(formatMismatch(unstamped, TOOL_VERSION), null);
  assert.equal(pendingMigration(unstamped), 'stamp');
  const before = readEvents(unstamped).length;
  const r = migrate(unstamped);
  assert.equal(r.kind, 'stamp');
  assert.equal(r.version, FORMAT_VERSION);
  assert.ok(r.commit);
  assert.equal(loadStoreConfig(unstamped.root).version, FORMAT_VERSION);
  const events = readEvents(unstamped).slice(before);
  assert.equal(events.length, 1);
  assert.equal(events[0].op, 'migrated');
  assert.deepEqual(events[0].fields, ['version', `${UNSTAMPED_VERSION} → ${FORMAT_VERSION}`]);
  assert.equal(pendingMigration(unstamped), null);
  // an ordinary write never stamps: the version is written by init and migrate alone
  newRecord(unstamped, 'product', 'shop', { title: 'Shop' });
  assert.equal(loadStoreConfig(unstamped.root).version, FORMAT_VERSION);
});

test('a store stamped newer than the tool is refused for writing, naming the version to install; one stamped older is told to migrate', () => {
  const newer: Store = { ...store, config: { ...store.config, version: '99.0.0' } };
  assert.match(formatMismatch(newer, TOOL_VERSION)!, /format 99\.0\.0, newer than this pjman .*install pjman 99\.0\.0 or newer/);
  const older: Store = { ...store, config: { ...store.config, version: '0.0.1' } };
  assert.match(formatMismatch(older, TOOL_VERSION)!, /format 0\.0\.1; this pjman .*brings format .*run pjman migrate/);
  assert.match(formatMismatch(older, TOOL_VERSION)!, /the layout move/);
  // a store at the format, or below it with the sniffs saying nothing, has only the stamp to make
  assert.equal(pendingMigration(older), 'stamp');
});
