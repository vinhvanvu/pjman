// A release is a record (decision releases-homebrew/release-is-a-record): keyed under its product by version, listing
// the changes it ships; its creation is the event; a change's shipped-in is read through the graph.
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
import { changeContext, ls } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { keyOfPath, readEvents, typeOfPath } from '../store/events.js';
import { get } from '../model/graph.js';
import { parseReleaseRest, releaseKey, shortenText } from '../store/keys.js';
import { loadStore, resolve } from '../store/records.js';
import { validate } from '../model/validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-releases-'));
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
const rec = (key: string) => {
  const r = resolve(loadStore(store), key);
  return r.status === 'ok' || r.status === 'alias' ? r.rec : undefined;
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: web });
  init({ checkers: [], cwd: web, name: 'web' });
  store = findStore(web)!;
  newRecord(store, 'product', 'shop', { title: 'Shop' });
  set(store, 'project:web', ['product=product:shop'], {});
  rm(store, 'product:web');
  newRecord(store, 'product', 'other', { title: 'Other' });
  newRecord(store, 'feature', 'cart', { title: 'The cart', product: 'product:shop' });
  change(store, 'cart-lines', { title: 'Lines in the cart', project: 'project:web', features: ['adds feature:cart'] });
  change(store, 'cart-total', {
    title: 'The total was off by the tax',
    project: 'project:web',
    kind: 'bug',
    severity: 'capability',
    features: ['feature:cart'],
  });
  newRecord(store, 'project', 'other-app', { title: 'The other app', product: 'product:other' });
  change(store, 'other/elsewhere', { title: 'A change of another product', project: 'project:other-app' });
});

test('the key grammar: a version, bare or under a product', () => {
  assert.deepEqual(parseReleaseRest('0.2.0'), { product: null, version: '0.2.0' });
  assert.deepEqual(parseReleaseRest('shop/0.2.0'), { product: 'shop', version: '0.2.0' });
  assert.equal(parseReleaseRest('v0.2.0'), null);
  assert.equal(parseReleaseRest('0.2'), null);
  assert.equal(releaseKey('shop', '0.2.0'), 'release:shop/0.2.0');
  assert.equal(shortenText('shipped in release:shop/0.2.0', 'product:shop'), 'shipped in release:0.2.0');
  assert.equal(typeOfPath('products/shop/releases/0.2.0.md'), 'release');
  assert.equal(keyOfPath('products/shop/releases/0.2.0.md', 'release', store.root, 'HEAD'), 'release:shop/0.2.0');
});

test('a release is created with what it ships, keyed under the product by version; its creation is the event', () => {
  const r = newRecord(store, 'release', '0.2.0', {
    at: '2026-11-06T10:00:00.000Z',
    level: 'minor',
    commit: 'abc1234',
    url: 'https://example.test/releases/v0.2.0',
    ships: ['change:cart-lines', 'change:cart-total'],
    body: '## 0.2.0\n\n### Added\n\n- Cart lines',
  });
  assert.equal(r.key, 'release:shop/0.2.0');
  assert.equal(r.path, 'products/shop/releases/0.2.0.md');
  assert.deepEqual(errors(), []);
  const rel = rec('release:0.2.0')!;
  assert.equal(rel.type, 'release');
  assert.equal(rel.data.tag, 'v0.2.0');
  assert.equal(rel.data.version, '0.2.0');
  // the changes it ships are stored as full keys, in the order given
  assert.deepEqual(rel.data.ships, ['change:shop/cart-lines', 'change:shop/cart-total']);
  assert.match(rel.body, /Cart lines/);
  assert.equal(rec('release:shop/0.2.0')?.key, 'release:shop/0.2.0');
  const created = readEvents(store).filter((e) => e.op === 'created' && e.key === 'release:shop/0.2.0');
  assert.equal(created.length, 1);
  assert.equal(created[0].type, 'release');
});

test('the graph: a change reads which release shipped it; the release lists its changes', () => {
  const loaded = loadStore(store);
  const fromChange = get(loaded, 'change:cart-lines');
  assert.ok(fromChange.in.some((e) => e.edge === 'ships' && e.from === 'release:shop/0.2.0'));
  const fromRelease = get(loaded, 'release:0.2.0');
  assert.deepEqual(
    fromRelease.out.filter((e) => e.edge === 'ships').map((e) => e.to),
    ['change:shop/cart-lines', 'change:shop/cart-total'],
  );
  assert.ok(ls(store, { type: 'release' }).some((row) => row.key === 'release:shop/0.2.0'));
});

test("a change's context names the releases that shipped it, with the version and the instant", () => {
  const ctx = changeContext(store, 'change:cart-lines');
  assert.deepEqual(
    ctx.releases.map((r) => [r.key, r.version, r.at]),
    [['release:shop/0.2.0', '0.2.0', '2026-11-06T10:00:00.000Z']],
  );
  assert.equal(ctx.releases[0].url, 'https://example.test/releases/v0.2.0');
});

test('refused: a second release of the same version, a version that is not semver, a change of another product, a change twice, no instant', () => {
  assert.throws(() => newRecord(store, 'release', '0.2.0', { at: '2026-11-06T11:00:00.000Z' }), /already exists/);
  assert.throws(() => newRecord(store, 'release', 'v0.3.0', { at: '2026-11-06T11:00:00.000Z' }), /not a version/);
  assert.throws(() => newRecord(store, 'release', '0.3.0', {}), /--at is required/);
  assert.throws(() => newRecord(store, 'release', '0.3.0', { at: 'yesterday' }), /timestamp/);
  assert.throws(
    () => newRecord(store, 'release', '0.3.0', { at: '2026-11-06T11:00:00.000Z', level: 'huge' }),
    /--level/,
  );
  assert.throws(
    () => newRecord(store, 'release', '0.3.0', { at: '2026-11-06T11:00:00.000Z', ships: ['change:other/elsewhere'] }),
    /another product/,
  );
  assert.throws(
    () =>
      newRecord(store, 'release', '0.3.0', {
        at: '2026-11-06T11:00:00.000Z',
        ships: ['change:cart-lines', 'change:cart-lines'],
      }),
    /twice/,
  );
  assert.throws(
    () => newRecord(store, 'release', '0.3.0', { at: '2026-11-06T11:00:00.000Z', ships: ['change:ghost'] }),
    /does not resolve|missing/,
  );
  assert.deepEqual(errors(), []);
  // nothing half-written survives a refusal
  assert.ok(!fs.existsSync(path.join(store.root, 'products/shop/releases/0.3.0.md')));
});

test('a release of another product is named in full; its version alone is ambiguous only when two products share it', () => {
  newRecord(store, 'release', 'other/0.2.0', { at: '2026-11-06T12:00:00.000Z' });
  assert.deepEqual(errors(), []);
  assert.equal(rec('release:other/0.2.0')?.key, 'release:other/0.2.0');
  // the bare version resolves in the scope (shop, the project's product)
  assert.equal(rec('release:0.2.0')?.key, 'release:shop/0.2.0');
  const unscoped = resolve({ ...loadStore(store), scope: null }, 'release:0.2.0');
  assert.equal(unscoped.status, 'ambiguous');
});
