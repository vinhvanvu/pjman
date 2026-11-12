import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { activity } from '../model/activity.js';
import { init } from '../cli/init.js';
import { mv } from '../ops/mv.js';
import { newRecord } from '../ops/new.js';
import { rm } from '../ops/rm.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { get } from '../model/graph.js';
import { loadStore, resolve } from '../store/records.js';
import {
  ancestorsOf,
  derivedStatus,
  descendantsOf,
  effectiveOwners,
  formatTree,
  levelOf,
  parseEffect,
  tree,
} from '../model/tree.js';
import { validate } from '../model/validate.js';
import { change, decisionRec } from './shape.js';

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
  init({ checkers: [], cwd: web, name: 'web' });
  store = findStore(web)!;
  const api = path.join(tmp, 'api');
  fs.mkdirSync(api, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: api });
  init({ checkers: [], cwd: api, name: 'api' });
  // the two repositories build one product: shop; the ones init made with their names are not needed
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  set(store, 'project:web', ['product=product:shop'], {});
  set(store, 'project:api', ['product=product:shop'], {});
  rm(store, 'product:web');
  rm(store, 'product:api');
});

test('effects parse: a bare key changes; adds and removes are named; anything else is not an effect', () => {
  assert.deepEqual(parseEffect('feature:x'), { effect: 'changes', key: 'feature:x' });
  assert.deepEqual(parseEffect('adds feature:x'), { effect: 'adds', key: 'feature:x' });
  assert.deepEqual(parseEffect('removes  feature:x'), { effect: 'removes', key: 'feature:x' });
  assert.equal(parseEffect('deletes feature:x'), null);
  assert.equal(parseEffect('adds change:x'), null);
});

test('the tree: a product root, features at labelled levels, owners inherited, changes as effects, derived status, roll-ups', () => {
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Pay with a saved card', parent: 'feature:shop/checkout' });
  newRecord(store, 'feature', 'card-scan', {
    title: 'Scan a card',
    parent: 'feature:shop/saved-cards',
    owners: ['person:other'],
  });
  newRecord(store, 'feature', 'search', { title: 'Search', product: 'product:shop', status: 'live' });
  change(store, 'card-form', {
    title: 'Card form',
    summary: 's',
    project: 'project:web',
    features: ['adds feature:shop/saved-cards'],
    status: 'active',
  });
  change(store, 'card-endpoint', {
    title: 'Card endpoint',
    summary: 's',
    project: 'project:api',
    features: ['adds feature:shop/saved-cards'],
  });
  change(store, 'chore', { title: 'Chore', summary: 's', project: 'project:web' });
  decisionRec(store, 'card-form/why', { title: 'Why', decision: 'd', why: 'w' });
  assert.deepEqual(errors(), []);

  let loaded = loadStore(store);
  // levels from the template: feature, capability, then capability again below
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:shop/checkout')![0]), 'feature');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:shop/saved-cards')![0]), 'capability');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:shop/card-scan')![0]), 'capability');
  set(store, 'feature:shop/card-scan', ['level=sub-capability'], {});
  set(store, 'product:shop', ['levels=area,feature,capability'], {});
  loaded = loadStore(store);
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:shop/checkout')![0]), 'area');
  assert.equal(levelOf(loaded, loaded.byKey.get('feature:shop/card-scan')![0]), 'sub-capability');

  // owners: own, else the nearest ancestor's
  assert.deepEqual(effectiveOwners(loaded, 'feature:shop/saved-cards'), {
    owners: ['person:tester'],
    from: 'product:shop',
  });
  assert.deepEqual(effectiveOwners(loaded, 'feature:shop/card-scan'), {
    owners: ['person:other'],
    from: 'feature:shop/card-scan',
  });
  assert.deepEqual(effectiveOwners(loaded, 'change:shop/card-form'), {
    owners: ['person:tester'],
    from: 'product:shop',
  });

  // ancestry across chains: a change climbs its project and its features to the product
  assert.deepEqual(ancestorsOf(loaded, 'change:shop/card-form').toSorted(), [
    'feature:shop/checkout',
    'feature:shop/saved-cards',
    'product:shop',
    'project:web',
  ]);
  assert.deepEqual(ancestorsOf(loaded, 'decision:shop/card-form/why').toSorted(), [
    'change:shop/card-form',
    'feature:shop/checkout',
    'feature:shop/saved-cards',
    'product:shop',
    'project:web',
  ]);
  assert.ok(descendantsOf(loaded, 'feature:shop/checkout').has('change:shop/card-endpoint'));
  assert.ok(descendantsOf(loaded, 'product:shop').has('change:shop/chore'));
  assert.ok(!descendantsOf(loaded, 'feature:shop/search').has('change:shop/chore'));

  // derived status: building while in flight, live once an adding change is done, a parent lifts with its child
  assert.equal(derivedStatus(loaded, 'feature:shop/saved-cards').status, 'building');
  assert.equal(derivedStatus(loaded, 'feature:shop/checkout').status, 'building');
  assert.equal(derivedStatus(loaded, 'feature:shop/card-scan').status, 'planned');
  // planning is thinking, not building
  set(store, 'change:shop/card-form', ['status=planning'], {});
  assert.equal(derivedStatus(loadStore(store), 'feature:shop/saved-cards').status, 'planned');
  set(store, 'change:shop/card-form', ['status=done'], {});
  loaded = loadStore(store);
  assert.equal(derivedStatus(loaded, 'feature:shop/saved-cards').status, 'live');
  assert.equal(derivedStatus(loaded, 'feature:shop/checkout').status, 'live');
  change(store, 'drop-scan', {
    title: 'Drop card scan',
    summary: 's',
    project: 'project:web',
    features: ['removes feature:shop/card-scan'],
    status: 'done',
  });
  loaded = loadStore(store);
  assert.equal(derivedStatus(loaded, 'feature:shop/card-scan').status, 'retired');
  // nothing to derive from: the authored status stands (a cold-started map), and lifts its parent
  newRecord(store, 'feature', 'cold', { title: 'Cold', product: 'product:shop', status: 'live' });
  newRecord(store, 'feature', 'cold-kid', { title: 'Cold kid', parent: 'feature:shop/cold', status: 'live' });
  newRecord(store, 'feature', 'cold-plan', { title: 'Cold plan', parent: 'feature:shop/cold' });
  loaded = loadStore(store);
  assert.deepEqual(derivedStatus(loaded, 'feature:shop/cold-kid'), {
    status: 'live',
    because: 'authored; no change affects it yet',
  });
  assert.equal(derivedStatus(loaded, 'feature:shop/cold').status, 'live');
  assert.equal(derivedStatus(loaded, 'feature:shop/cold-plan').status, 'planned');
  // an open change decides nothing: the authored status still stands; one in flight reads building
  change(store, 'rework-kid', {
    title: 'Rework',
    summary: 's',
    project: 'project:web',
    features: ['feature:shop/cold-kid'],
    status: 'open',
  });
  assert.deepEqual(derivedStatus(loadStore(store), 'feature:shop/cold-kid'), {
    status: 'live',
    because: 'authored; nothing affecting it is done or in flight',
  });
  set(store, 'change:shop/rework-kid', ['status=active'], {});
  assert.equal(derivedStatus(loadStore(store), 'feature:shop/cold-kid').status, 'building');
  // a done change that changes a node derives live, whatever was authored
  set(store, 'change:shop/rework-kid', ['status=done'], {});
  assert.deepEqual(derivedStatus(loadStore(store), 'feature:shop/cold-kid'), {
    status: 'live',
    because: 'change:shop/rework-kid (changes) is done',
  });
  change(store, 'touch-plan', {
    title: 'Touch plan',
    summary: 's',
    project: 'project:web',
    features: ['feature:shop/cold-plan'],
    status: 'done',
  });
  assert.equal(derivedStatus(loadStore(store), 'feature:shop/cold-plan').status, 'live');
  for (const k of [
    'change:shop/touch-plan',
    'change:shop/rework-kid',
    'feature:shop/cold-plan',
    'feature:shop/cold-kid',
    'feature:shop/cold',
  ])
    rm(store, k);
  loaded = loadStore(store);

  // the tree with roll-ups
  const [shop] = tree(loaded);
  assert.equal(shop.key, 'product:shop');
  assert.deepEqual(
    shop.children.map((c) => c.key),
    ['feature:shop/checkout', 'feature:shop/search'],
  );
  const checkout = shop.children[0];
  assert.deepEqual(checkout.backlog, { done: 2, open: 1 });
  assert.deepEqual(checkout.projects, ['project:api', 'project:web']);
  assert.equal(shop.unassigned, 1); // change:chore names no feature
  assert.equal(shop.children[1].status, 'live');
  assert.deepEqual(
    tree(loaded, 'feature:shop/saved-cards')[0].children.map((c) => c.key),
    ['feature:shop/card-scan'],
  );
  assert.deepEqual(tree(loaded, 'change:shop/chore'), []);
  const text = formatTree(tree(loaded));
  assert.match(text, /product:shop \(product\) — Shop · person:tester/);
  assert.match(text, /feature:shop\/saved-cards \(feature\) \[live\]/);
  assert.match(text, /1 open change under its projects name no feature/);

  // the getter reaches a feature and the changes that affect it
  const n = get(loaded, 'feature:shop/saved-cards');
  assert.deepEqual(n.changes.map((c) => c.change.key).toSorted(), [
    'change:shop/card-endpoint',
    'change:shop/card-form',
  ]);
  assert.ok(n.in.some((e) => e.edge === 'adds' && e.from === 'change:shop/card-form'));
});

test('validation: a feature needs a product or a parent; effects are checked; parent cycles are refused on features and projects', () => {
  assert.throws(() => newRecord(store, 'feature', 'orphan', { title: 'Orphan' }), /--product|--parent/);
  assert.throws(
    () => change(store, 'bad', { title: 'b', summary: 's', features: ['deletes feature:checkout'] }),
    /must be '<effect> feature:<slug>'/,
  );
  assert.throws(
    () => change(store, 'bad', { title: 'b', summary: 's', features: ['adds feature:shop/nope'] }),
    /does not resolve/,
  );
  assert.throws(() => set(store, 'feature:shop/checkout', ['parent=feature:saved-cards'], {}), /cycles/);
  assert.throws(
    () => set(store, 'feature:shop/search', ['status=shipped'], {}),
    /not one of planned, building, live, retired/,
  );
  set(store, 'project:api', ['parent=project:web'], {});
  assert.throws(() => set(store, 'project:web', ['parent=project:api'], {}), /cycles/);
  assert.deepEqual(errors(), []);
});

test('activity: the events beneath a node, through every chain, with what they say about health', () => {
  const loaded = loadStore(store);
  const a = activity(store, loaded, 'product:shop', { days: 1 });
  assert.ok(a.subtree > 5);
  assert.ok(a.events.length > 0);
  assert.ok(a.summary.doneChanges.includes('change:shop/card-form'));
  assert.ok(a.summary.newChanges.includes('change:shop/drop-scan'));
  assert.deepEqual(a.summary.proposedDecisions, ['decision:shop/card-form/why']);
  assert.equal(a.summary.staleDays, 0);
  const f = activity(store, loaded, 'feature:shop/search', { days: 1 });
  assert.ok(!f.events.some((e) => e.key === 'change:shop/card-form'));
  const c = activity(store, loaded, 'change:shop/card-form', { days: 1 });
  assert.ok(c.events.some((e) => e.key === 'decision:shop/card-form/why'));
});

test('rename and remove reach products and features; a product with members refuses; effects follow a renamed feature', () => {
  mv(store, 'feature:shop/saved-cards', 'feature:shop/stored-cards', {});
  let loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('feature:shop/saved-cards'));
  assert.deepEqual(loaded.byKey.get('change:shop/card-form')![0].data.features, ['adds feature:shop/stored-cards']);
  assert.equal(loaded.byKey.get('feature:shop/card-scan')![0].data.parent, 'feature:shop/stored-cards');
  mv(store, 'product:shop', 'product:store', {});
  loaded = loadStore(store);
  assert.equal(loaded.byKey.get('feature:store/checkout')![0].data.product, 'product:store');
  assert.deepEqual(loaded.byKey.get('product:store')![0].data.aliases, ['shop']);
  assert.equal(loaded.byKey.get('feature:store/card-scan')![0].data.parent, 'feature:store/stored-cards');
  assert.equal(
    loaded.byKey.get('change:store/card-form')![0].data.features![0 as never],
    'adds feature:store/stored-cards',
  );
  // the old product segment still resolves
  assert.equal(resolve(loaded, 'feature:shop/checkout').status, 'ok');
  assert.equal(loaded.byKey.get('project:web')![0].data.product, 'product:store');
  assert.deepEqual(errors(), []);
  assert.throws(() => rm(store, 'product:store', { detach: true }), /is the product of/);
  assert.throws(() => rm(store, 'feature:store/card-scan'), /change:store\/drop-scan  features/);
  rm(store, 'feature:store/card-scan', { detach: true });
  loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('feature:store/card-scan'));
  assert.equal(loaded.byKey.get('change:store/drop-scan')![0].data.features, undefined);
  assert.deepEqual(errors(), []);
});
