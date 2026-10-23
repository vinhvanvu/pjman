import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { sessionBind } from '../commands/session.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { loadStore } from '../records.js';
import { scope, type ScopeNode } from '../scope.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-scope-'));
let store: Store;
const keys = (nodes: ScopeNode[]): string[] => nodes.map((n) => n.key);
const find = (nodes: ScopeNode[], key: string): ScopeNode | undefined => {
  for (const n of nodes) {
    if (n.key === key) return n;
    const inner = find(n.children, key);
    if (inner) return inner;
  }
  return undefined;
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  for (const name of ['web', 'api']) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    init({ cwd: dir, name });
  }
  store = findStore(path.join(tmp, 'web'))!;
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Saved cards', parent: 'feature:checkout' });
  newRecord(store, 'feature', 'search', { title: 'Search', product: 'product:shop', status: 'live' });
  newRecord(store, 'feature', 'fax', { title: 'Fax orders', product: 'product:shop', status: 'retired' });
  set(store, 'project:web', ['product=product:shop'], {});
  set(store, 'project:api', ['product=product:shop'], {});
  newRecord(store, 'change', 'cards', { title: 'Cards milestone', summary: 's', project: 'project:web', status: 'planning' });
  newRecord(store, 'change', 'card-form', { title: 'Card form', summary: 's', project: 'project:web', parent: 'change:cards', features: ['adds feature:saved-cards', 'feature:search'], status: 'active', binds: ['github-issue:acme/shop#7'] });
  newRecord(store, 'change', 'card-endpoint', { title: 'Card endpoint', summary: 's', project: 'project:api', parent: 'change:cards', features: ['adds feature:saved-cards'] });
  newRecord(store, 'change', 'card-tests', { title: 'Card tests', summary: 's', project: 'project:web', parent: 'change:card-form' });
  newRecord(store, 'change', 'chore', { title: 'Chore', summary: 's', project: 'project:web' });
  newRecord(store, 'change', 'old', { title: 'Old', summary: 's', project: 'project:web', features: ['feature:search'], status: 'done' });
  newRecord(store, 'decision', 'card-form/why', { title: 'Why', decision: 'd', why: 'w' });
  newRecord(store, 'session', 'live-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 'live-1', 'change:card-form');
});

test('feature lens: features nest, a change sits under every feature it names, a child naming nothing nests under its parent, the unnamed close the list', () => {
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop' });
  assert.equal(s.container, 'product:shop');
  assert.deepEqual(keys(s.tree), ['feature:checkout', 'feature:search', 'unassigned']);
  assert.equal(s.retiredHidden, 1);
  assert.equal(s.doneHidden, 1);
  const checkout = s.tree[0];
  assert.deepEqual(keys(checkout.children), ['feature:saved-cards']);
  assert.equal(checkout.childCount, 1);
  assert.equal(checkout.open, 3); // card-form, card-endpoint, card-tests (through its parent)
  assert.equal(checkout.inFlight, 1);
  assert.deepEqual(checkout.projects, ['project:api', 'project:web']);
  assert.deepEqual(checkout.owners, ['person:tester']);
  assert.equal(checkout.ownersFrom, 'product:shop');
  const saved = checkout.children[0];
  assert.deepEqual(keys(saved.children), ['change:card-form', 'change:card-endpoint']);
  assert.deepEqual(keys(saved.children[0].children), ['change:card-tests']);
  // the same change again under the second feature it names; its child is not placed twice
  assert.deepEqual(keys(s.tree[1].children), ['change:card-form']);
  assert.deepEqual(s.tree[1].children[0].children, []);
  assert.deepEqual(keys(s.tree[2].children), ['change:cards', 'change:chore']);
  assert.deepEqual(s.tree[2].children[0].children, []); // its children live under their features
  // the row
  const r = saved.children[0].row!;
  assert.deepEqual(r.ticket, { key: 'github-issue:acme/shop#7', label: '#7', url: 'https://github.com/acme/shop/issues/7' });
  assert.equal(r.waiting, 1);
  assert.equal(r.live, true);
  assert.deepEqual(r.progress, { done: 0, total: 1 });
  assert.deepEqual(r.features.map((f) => `${f.effect} ${f.key}`), ['adds feature:saved-cards', 'changes feature:search']);
  assert.equal(s.tree[2].children[0].row!.progress?.total, 2);
  // the health of the node, the live session beneath it, the window
  assert.equal(s.health.waiting, 1);
  assert.equal(s.health.created, 6);
  assert.equal(s.health.staleDays, 0);
  assert.deepEqual(s.sessions.map((x) => [x.key, x.on]), [['session:live-1', 'change:card-form']]);
  assert.deepEqual(s.projects, ['project:api', 'project:web']);
  assert.ok(s.recent.length > 0);
  assert.equal(s.node?.summary, 'A shop.');
  // retired and done shown on request
  const all = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', done: true, retired: true });
  assert.deepEqual(keys(all.tree), ['feature:checkout', 'feature:fax', 'feature:search', 'unassigned']);
  assert.deepEqual(keys(all.tree[2].children), ['change:card-form', 'change:old']);
  assert.equal(all.doneHidden, 0);
});

test('project lens: projects under the product, changes nested by parent within a project, a child in another project stands on its own', () => {
  const s = scope(store, loadStore(store), { lens: 'project', node: 'product:shop' });
  assert.deepEqual(keys(s.tree), ['project:api', 'project:web']);
  assert.deepEqual(keys(s.tree[0].children), ['change:card-endpoint']);
  assert.deepEqual(keys(s.tree[1].children), ['change:cards', 'change:chore']);
  assert.deepEqual(keys(s.tree[1].children[0].children), ['change:card-form']);
  assert.deepEqual(keys(s.tree[1].children[0].children[0].children), ['change:card-tests']);
  assert.deepEqual(s.tree[1].progress, { done: 1, total: 6 }); // card-endpoint counts beneath web through its parent milestone
  const web = scope(store, loadStore(store), { lens: 'project', node: 'project:web' });
  // a child of a web milestone that lives in api is beneath web; the project lens cannot place it here, so it closes the list
  assert.deepEqual(keys(web.tree), ['change:cards', 'change:chore', 'unassigned']);
  assert.equal(web.tree[2].title, 'In other projects');
  assert.deepEqual(keys(web.tree[2].children), ['change:card-endpoint']);
  assert.deepEqual(web.crumbs.map((c) => c.key), ['product:shop']);
  assert.deepEqual(web.changes.map((c) => c.key), ['change:cards', 'change:card-form', 'change:card-endpoint', 'change:card-tests', 'change:chore']);
  assert.deepEqual(web.projects, ['project:api', 'project:web']);
});

test('milestone lens: parent changes nested all the way down, changes without a milestone close the list', () => {
  const s = scope(store, loadStore(store), { lens: 'milestone', node: 'product:shop' });
  assert.deepEqual(keys(s.tree), ['change:cards', 'unassigned']);
  assert.deepEqual(keys(s.tree[0].children), ['change:card-form', 'change:card-endpoint']);
  assert.deepEqual(keys(s.tree[0].children[0].children), ['change:card-tests']);
  assert.deepEqual(keys(s.tree[1].children), ['change:chore']);
  const m = scope(store, loadStore(store), { lens: 'milestone', node: 'change:cards' });
  assert.equal(m.container, 'change:cards');
  assert.deepEqual(keys(m.tree), ['change:card-form', 'change:card-endpoint']);
  assert.ok(m.change);
  assert.deepEqual(m.change.progress, { done: 0, total: 2 });
});

test('a leaf change stands in its container for the lens; the crumbs climb that chain; the root holds every product', () => {
  const loaded = loadStore(store);
  const f = scope(store, loaded, { lens: 'feature', node: 'change:card-tests' });
  assert.equal(f.container, 'feature:saved-cards'); // it names nothing; its parent's first feature files it
  assert.deepEqual(f.crumbs.map((c) => c.key), ['product:shop', 'feature:checkout', 'feature:saved-cards', 'change:cards', 'change:card-form']);
  const p = scope(store, loaded, { lens: 'project', node: 'change:card-tests' });
  assert.equal(p.container, 'project:web');
  assert.deepEqual(p.crumbs.map((c) => c.key), ['product:shop', 'project:web', 'change:cards', 'change:card-form']);
  const m = scope(store, loaded, { lens: 'milestone', node: 'change:card-tests' });
  assert.equal(m.container, 'change:card-form');
  assert.equal(m.change?.change.key, 'change:card-tests');
  const root = scope(store, loaded, { lens: 'feature' });
  assert.equal(root.node, null);
  assert.deepEqual(keys(root.tree), ['product:shop', 'unassigned']);
  assert.equal(root.tree[0].type, 'product');
  assert.deepEqual(root.products.map((r) => r.key), ['product:shop']);
  assert.throws(() => scope(store, loaded, { lens: 'colour' }), /lens must be one of/);
  assert.throws(() => scope(store, loaded, { node: 'change:nope' }), /has no record/);
  assert.throws(() => scope(store, loaded, { node: 'session:live-1' }), /not a node of the tree/);
});

test('health reads the window: a change done today counts, blocked counts as it stands, last moved tints past the window', () => {
  set(store, 'change:chore', ['status=done'], {});
  set(store, 'change:card-endpoint', ['status=blocked'], {});
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', days: 7 });
  assert.equal(s.health.done, 1);
  assert.equal(s.health.blocked, 1);
  assert.equal(s.health.days, 7);
  const checkout = find(s.tree, 'feature:checkout')!;
  assert.equal(checkout.health?.blocked, 1);
  assert.equal(find(s.tree, 'feature:search')!.health?.blocked, 0);
  // a window that ended long ago: nothing moved inside it, last stays
  const stale = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', now: Date.now() + 30 * 86_400_000 });
  assert.equal(stale.health.moved, 0);
  assert.equal(stale.health.staleDays, 30);
  assert.deepEqual(stale.sessions, []);
});
