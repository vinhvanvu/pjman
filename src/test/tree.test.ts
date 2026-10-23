import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { activity } from '../activity.js';
import { init } from '../commands/init.js';
import { mv } from '../commands/mv.js';
import { newRecord } from '../commands/new.js';
import { rm } from '../commands/rm.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { get } from '../graph.js';
import { loadStore } from '../records.js';
import { ancestorsOf, derivedStatus, descendantsOf, effectiveOwners, formatTree, levelOf, parseEffect, tree } from '../tree.js';
import { validate } from '../validate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-tree-'));
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: web });
  init({ cwd: web, name: 'web' });
  store = findStore(web)!;
  const api = path.join(tmp, 'api');
  fs.mkdirSync(api, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: api });
  init({ cwd: api, name: 'api' });
});

test('effects parse: a bare key changes; adds and removes are named; anything else is not an effect', () => {
  assert.deepEqual(parseEffect('feature:x'), { effect: 'changes', key: 'feature:x' });
  assert.deepEqual(parseEffect('adds feature:x'), { effect: 'adds', key: 'feature:x' });
  assert.deepEqual(parseEffect('removes  feature:x'), { effect: 'removes', key: 'feature:x' });
  assert.equal(parseEffect('deletes feature:x'), null);
  assert.equal(parseEffect('adds change:x'), null);
});

test('the tree: a product root, features at labelled levels, owners inherited, changes as effects, derived status, roll-ups', () => {
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Pay with a saved card', parent: 'feature:checkout' });
  newRecord(store, 'feature', 'card-scan', { title: 'Scan a card', parent: 'feature:saved-cards', owners: ['person:other'] });
  newRecord(store, 'feature', 'search', { title: 'Search', product: 'product:shop', status: 'live' });
  set(store, 'project:web', ['product=product:shop'], {});
  set(store, 'project:api', ['product=product:shop'], {});
  newRecord(store, 'change', 'card-form', { title: 'Card form', summary: 's', project: 'project:web', features: ['adds feature:saved-cards'], status: 'active' });
  newRecord(store, 'change', 'card-endpoint', { title: 'Card endpoint', summary: 's', project: 'project:api', features: ['adds feature:saved-cards'] });
  newRecord(store, 'change', 'chore', { title: 'Chore', summary: 's', project: 'project:web' });
  newRecord(store, 'decision', 'card-form/why', { title: 'Why', decision: 'd', why: 'w' });
  assert.deepEqual(errors(), []);

  let loaded = loadStore(store);
  // levels from the template: feature, capability, then capability again below
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:checkout')![0]), 'feature');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:saved-cards')![0]), 'capability');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:card-scan')![0]), 'capability');
  set(store, 'feature:card-scan', ['level=sub-capability'], {});
  set(store, 'product:shop', ['levels=area,feature,capability'], {});
  loaded = loadStore(store);
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:checkout')![0]), 'area');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:card-scan')![0]), 'sub-capability');

  // owners: own, else the nearest ancestor's
  assert.deepEqual(effectiveOwners(loaded, 'feature:saved-cards'), { owners: ['person:tester'], from: 'product:shop' });
  assert.deepEqual(effectiveOwners(loaded, 'feature:card-scan'), { owners: ['person:other'], from: 'feature:card-scan' });
  assert.deepEqual(effectiveOwners(loaded, 'change:card-form'), { owners: ['person:tester'], from: 'product:shop' });

  // ancestry across chains: a change climbs its project and its features to the product
  assert.deepEqual(ancestorsOf(loaded, 'change:card-form').sort(), ['feature:checkout', 'feature:saved-cards', 'product:shop', 'project:web']);
  assert.deepEqual(ancestorsOf(loaded, 'decision:card-form/why').sort(), ['change:card-form', 'feature:checkout', 'feature:saved-cards', 'product:shop', 'project:web']);
  assert.ok(descendantsOf(loaded, 'feature:checkout').has('change:card-endpoint'));
  assert.ok(descendantsOf(loaded, 'product:shop').has('change:chore'));
  assert.ok(!descendantsOf(loaded, 'feature:search').has('change:chore'));

  // derived status: building while in flight, live once an adding change is done, a parent lifts with its child
  assert.equal(derivedStatus(loaded, 'feature:saved-cards').status, 'building');
  assert.equal(derivedStatus(loaded, 'feature:checkout').status, 'building');
  assert.equal(derivedStatus(loaded, 'feature:card-scan').status, 'planned');
  set(store, 'change:card-form', ['status=done'], {});
  loaded = loadStore(store);
  assert.equal(derivedStatus(loaded, 'feature:saved-cards').status, 'live');
  assert.equal(derivedStatus(loaded, 'feature:checkout').status, 'live');
  newRecord(store, 'change', 'drop-scan', { title: 'Drop card scan', summary: 's', project: 'project:web', features: ['removes feature:card-scan'], status: 'done' });
  loaded = loadStore(store);
  assert.equal(derivedStatus(loaded, 'feature:card-scan').status, 'retired');

  // the tree with roll-ups
  const [shop] = tree(loaded);
  assert.equal(shop.key, 'product:shop');
  assert.deepEqual(shop.children.map((c) => c.key), ['feature:checkout', 'feature:search']);
  const checkout = shop.children[0];
  assert.deepEqual(checkout.backlog, { done: 2, open: 1 });
  assert.deepEqual(checkout.projects, ['project:api', 'project:web']);
  assert.equal(shop.unassigned, 1); // change:chore names no feature
  assert.equal(shop.children[1].status, 'live');
  assert.deepEqual(tree(loaded, 'feature:saved-cards')[0].children.map((c) => c.key), ['feature:card-scan']);
  assert.deepEqual(tree(loaded, 'change:chore'), []);
  const text = formatTree(tree(loaded));
  assert.match(text, /product:shop \(product\) — Shop · person:tester/);
  assert.match(text, /feature:saved-cards \(feature\) \[live\]/);
  assert.match(text, /1 open change under its projects name no feature/);

  // the getter reaches a feature and the changes that affect it
  const n = get(loaded, 'feature:saved-cards');
  assert.deepEqual(n.changes.map((c) => c.change.key).sort(), ['change:card-endpoint', 'change:card-form']);
  assert.ok(n.in.some((e) => e.edge === 'adds' && e.from === 'change:card-form'));
});

test('validation: a feature needs a product or a parent; effects are checked; parent cycles are refused on features and projects', () => {
  assert.throws(() => newRecord(store, 'feature', 'orphan', { title: 'Orphan' }), /--product|--parent/);
  assert.throws(() => newRecord(store, 'change', 'bad', { title: 'b', summary: 's', features: ['deletes feature:checkout'] }), /must be '<effect> feature:<slug>'/);
  assert.throws(() => newRecord(store, 'change', 'bad', { title: 'b', summary: 's', features: ['adds feature:nope'] }), /does not resolve/);
  assert.throws(() => set(store, 'feature:checkout', ['parent=feature:saved-cards'], {}), /cycles/);
  assert.throws(() => set(store, 'feature:search', ['status=shipped'], {}), /not one of planned, building, live, retired/);
  set(store, 'project:api', ['parent=project:web'], {});
  assert.throws(() => set(store, 'project:web', ['parent=project:api'], {}), /cycles/);
  assert.deepEqual(errors(), []);
});

test('activity: the events beneath a node, through every chain, with what they say about health', () => {
  const loaded = loadStore(store);
  const a = activity(store, loaded, 'product:shop', { days: 1 });
  assert.ok(a.subtree > 5);
  assert.ok(a.events.length > 0);
  assert.ok(a.summary.doneChanges.includes('change:card-form'));
  assert.ok(a.summary.newChanges.includes('change:drop-scan'));
  assert.deepEqual(a.summary.proposedDecisions, ['decision:card-form/why']);
  assert.equal(a.summary.staleDays, 0);
  const f = activity(store, loaded, 'feature:search', { days: 1 });
  assert.ok(!f.events.some((e) => e.key === 'change:card-form'));
  const c = activity(store, loaded, 'change:card-form', { days: 1 });
  assert.ok(c.events.some((e) => e.key === 'decision:card-form/why'));
});

test('rename and remove reach products and features; a product with members refuses; effects follow a renamed feature', () => {
  mv(store, 'feature:saved-cards', 'feature:stored-cards', {});
  let loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('feature:saved-cards'));
  assert.deepEqual(loaded.byKey.get('change:card-form')![0].data.features, ['adds feature:stored-cards']);
  assert.equal(loaded.byKey.get('feature:card-scan')![0].data.parent, 'feature:stored-cards');
  mv(store, 'product:shop', 'product:store', {});
  loaded = loadStore(store);
  assert.equal(loaded.byKey.get('feature:checkout')![0].data.product, 'product:store');
  assert.equal(loaded.byKey.get('project:web')![0].data.product, 'product:store');
  assert.deepEqual(errors(), []);
  assert.throws(() => rm(store, 'product:store', { detach: true }), /is the product of/);
  assert.throws(() => rm(store, 'feature:card-scan'), /change:drop-scan  features/);
  rm(store, 'feature:card-scan', { detach: true });
  loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('feature:card-scan'));
  assert.equal(loaded.byKey.get('change:drop-scan')![0].data.features, undefined);
  assert.deepEqual(errors(), []);
});
