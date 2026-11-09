import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { ahead, order } from '../commands/order.js';
import { rm } from '../commands/rm.js';
import { sessionBind, sessionLog } from '../commands/session.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { loadStore } from '../records.js';
import { scope, type ScopeNode } from '../scope.js';
import { change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-scope-'));
let store: Store;
const keys = (nodes: ScopeNode[]): string[] => nodes.map((n) => n.key);
/** A few milliseconds on, so the next write's instant follows the last one's. */
const tick = () => {
  const until = Date.now() + 5;
  while (Date.now() < until) { /* wait */ }
};
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
    init({ checkers: [], cwd: dir, name });
  }
  store = findStore(path.join(tmp, 'web'))!;
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  set(store, 'project:web', ['product=product:shop'], {});
  set(store, 'project:api', ['product=product:shop'], {});
  rm(store, 'product:web');
  rm(store, 'product:api');
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Saved cards for faster checkout', name: 'Saved cards', parent: 'feature:shop/checkout' });
  newRecord(store, 'feature', 'search', { title: 'Search', product: 'product:shop', status: 'live' });
  newRecord(store, 'feature', 'fax', { title: 'Fax orders', product: 'product:shop', status: 'retired' });
  change(store, 'cards', { title: 'Cards milestone', summary: 's', project: 'project:web', status: 'planning' });
  change(store, 'card-form', { title: 'Card form', summary: 's', project: 'project:web', parent: 'change:shop/cards', features: ['adds feature:shop/saved-cards', 'feature:shop/search'], status: 'active', binds: ['github-issue:acme/shop#7'] });
  change(store, 'card-endpoint', { title: 'Card endpoint', summary: 's', project: 'project:api', parent: 'change:shop/cards', features: ['adds feature:shop/saved-cards'] });
  change(store, 'card-tests', { title: 'Card tests', summary: 's', project: 'project:web', parent: 'change:shop/card-form' });
  change(store, 'chore', { title: 'Chore', summary: 's', project: 'project:web' });
  change(store, 'old', { title: 'Old', summary: 's', project: 'project:web', features: ['feature:shop/search'], status: 'done' });
  decisionRec(store, 'card-form/why', { title: 'Why', decision: 'd', why: 'w' });
  decisionRec(store, 'card-form/how', { title: 'How', decision: 'h', why: 'w', decidedBy: 'person:tester', decidedOn: '2026-01-02' });
  // working: its last act is a bind, no stop line after it
  newRecord(store, 'session', 'live-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 'live-1', 'change:shop/card-form');
  // stopped: bound, then its stop line last; nothing proposed on its change
  tick();
  newRecord(store, 'session', 'stopped-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 'stopped-1', 'change:shop/chore');
  tick();
  sessionLog(store, 'stopped-1', 'Done for now.');
});

test('feature lens: features nest, a change sits under every feature it names, a child naming nothing nests under its parent, the unnamed close the list', () => {
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop' });
  assert.equal(s.container, 'product:shop');
  assert.deepEqual(keys(s.tree), ['feature:shop/checkout', 'feature:shop/search', 'unassigned']);
  assert.equal(s.retiredHidden, 1);
  assert.equal(s.doneHidden, 1);
  const checkout = s.tree[0];
  assert.deepEqual(keys(checkout.children), ['feature:shop/saved-cards']);
  assert.equal(checkout.childCount, 1);
  assert.equal(checkout.open, 3); // card-form, card-endpoint, card-tests (through its parent)
  assert.equal(checkout.inFlight, 1);
  assert.deepEqual(checkout.projects, ['project:api', 'project:web']);
  assert.deepEqual(checkout.owners, ['person:tester']);
  assert.equal(checkout.ownersFrom, 'product:shop');
  const saved = checkout.children[0];
  assert.equal(saved.name, 'Saved cards'); // the short name the tree shows; the title stays the sentence
  assert.deepEqual(keys(saved.children), ['change:shop/card-form', 'change:shop/card-endpoint']);
  assert.deepEqual(keys(saved.children[0].children), ['change:shop/card-tests']);
  // the same change again under the second feature it names; its child is not placed twice
  assert.deepEqual(keys(s.tree[1].children), ['change:shop/card-form']);
  assert.deepEqual(s.tree[1].children[0].children, []);
  assert.deepEqual(keys(s.tree[2].children), ['change:shop/cards', 'change:shop/chore']);
  assert.deepEqual(s.tree[2].children[0].children, []); // its children live under their features
  // the row
  const r = saved.children[0].row!;
  assert.deepEqual(r.ticket, { key: 'github-issue:acme/shop#7', label: '#7', url: 'https://github.com/acme/shop/issues/7' });
  assert.equal(r.waiting, 1);
  assert.equal(r.decided, 1); // the decided one counts; the proposed one waits
  assert.equal(r.live, true);
  assert.deepEqual(r.progress, { done: 0, total: 1 });
  assert.deepEqual(r.features.map((f) => `${f.effect} ${f.key}`), ['adds feature:shop/saved-cards', 'changes feature:shop/search']);
  assert.equal(s.tree[2].children[0].row!.progress?.total, 2);
  // the health of the node, the live session beneath it, the window
  assert.equal(s.health.waiting, 1);
  // the inbox: the proposed decision beneath, with the recommendation and the change it is on
  assert.deepEqual(s.waitingOn.map((d) => [d.key, d.change, d.state.options.find((o) => o.recommended)?.text]), [['decision:shop/card-form/why', 'change:shop/card-form', 'd']]);
  assert.equal(s.health.created, 6);
  assert.equal(s.health.staleDays, 0);
  // the live sessions beneath, newest first, each with its state by the bridge's rule: a bind after no line is working,
  // a stop line last is stopped
  assert.deepEqual(s.sessions.map((x) => [x.key, x.on, x.state]), [['session:stopped-1', 'change:shop/chore', 'stopped'], ['session:live-1', 'change:shop/card-form', 'working']]);
  assert.deepEqual(s.projects, ['project:api', 'project:web']);
  assert.ok(s.recent.length > 0);
  assert.equal(s.node?.summary, 'A shop.');
  // retired and done shown on request
  const all = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', done: true, retired: true });
  assert.deepEqual(keys(all.tree), ['feature:shop/checkout', 'feature:shop/fax', 'feature:shop/search', 'unassigned']);
  assert.deepEqual(keys(all.tree[2].children), ['change:shop/card-form', 'change:shop/old']);
  assert.equal(all.doneHidden, 0);
});

test('project lens: projects under the product, changes nested by parent within a project, a child in another project stands on its own', () => {
  const s = scope(store, loadStore(store), { lens: 'project', node: 'product:shop' });
  assert.deepEqual(keys(s.tree), ['project:api', 'project:web']);
  assert.deepEqual(keys(s.tree[0].children), ['change:shop/card-endpoint']);
  assert.deepEqual(keys(s.tree[1].children), ['change:shop/cards', 'change:shop/chore']);
  assert.deepEqual(keys(s.tree[1].children[0].children), ['change:shop/card-form']);
  assert.deepEqual(keys(s.tree[1].children[0].children[0].children), ['change:shop/card-tests']);
  assert.deepEqual(s.tree[1].progress, { done: 1, total: 6 }); // card-endpoint counts beneath web through its parent milestone
  const web = scope(store, loadStore(store), { lens: 'project', node: 'project:web' });
  assert.deepEqual(web.node?.progress, { done: 1, total: 6 }); // the project's own progress on the node, for the header
  // a child of a web milestone that lives in api is beneath web; the project lens cannot place it here, so it closes the list
  assert.deepEqual(keys(web.tree), ['change:shop/cards', 'change:shop/chore', 'unassigned']);
  assert.equal(web.tree[2].title, 'In other projects');
  assert.deepEqual(keys(web.tree[2].children), ['change:shop/card-endpoint']);
  assert.deepEqual(web.crumbs.map((c) => c.key), ['product:shop']);
  assert.deepEqual(web.changes.map((c) => c.key), ['change:shop/cards', 'change:shop/card-form', 'change:shop/card-endpoint', 'change:shop/card-tests', 'change:shop/chore']);
  assert.deepEqual(web.projects, ['project:api', 'project:web']);
});

test('milestone lens: parent changes nested all the way down, changes without a milestone close the list', () => {
  const s = scope(store, loadStore(store), { lens: 'milestone', node: 'product:shop' });
  assert.deepEqual(keys(s.tree), ['change:shop/cards', 'unassigned']);
  assert.deepEqual(keys(s.tree[0].children), ['change:shop/card-form', 'change:shop/card-endpoint']);
  assert.deepEqual(keys(s.tree[0].children[0].children), ['change:shop/card-tests']);
  assert.deepEqual(keys(s.tree[1].children), ['change:shop/chore']);
  const m = scope(store, loadStore(store), { lens: 'milestone', node: 'change:shop/cards' });
  assert.equal(m.container, 'change:shop/cards');
  assert.deepEqual(keys(m.tree), ['change:shop/card-form', 'change:shop/card-endpoint']);
  assert.ok(m.change);
  assert.deepEqual(m.change.progress, { done: 0, total: 2 });
});

test('a leaf change stands in its container for the lens; the crumbs climb that chain; the root holds every product', () => {
  const loaded = loadStore(store);
  const f = scope(store, loaded, { lens: 'feature', node: 'change:shop/card-tests' });
  assert.equal(f.container, 'feature:shop/saved-cards'); // it names nothing; its parent's first feature files it
  assert.deepEqual(f.crumbs.map((c) => c.key), ['product:shop', 'feature:shop/checkout', 'feature:shop/saved-cards', 'change:shop/cards', 'change:shop/card-form']);
  assert.equal(f.crumbs[2].name, 'Saved cards'); // crumbs carry the short name
  const p = scope(store, loaded, { lens: 'project', node: 'change:shop/card-tests' });
  assert.equal(p.container, 'project:web');
  assert.deepEqual(p.crumbs.map((c) => c.key), ['product:shop', 'project:web', 'change:shop/cards', 'change:shop/card-form']);
  const m = scope(store, loaded, { lens: 'milestone', node: 'change:shop/card-tests' });
  assert.equal(m.container, 'change:shop/card-form');
  assert.equal(m.change?.change.key, 'change:shop/card-tests');
  const root = scope(store, loaded, { lens: 'feature' });
  assert.equal(root.node, null);
  assert.deepEqual(keys(root.tree), ['product:shop', 'unassigned']);
  assert.equal(root.tree[0].type, 'product');
  assert.deepEqual(root.products.map((r) => r.key), ['product:shop']);
  assert.throws(() => scope(store, loaded, { lens: 'colour' }), /lens must be one of/);
  assert.throws(() => scope(store, loaded, { node: 'change:shop/nope' }), /has no record/);
  assert.throws(() => scope(store, loaded, { node: 'session:live-1' }), /not a node of the tree/);
});

test('health reads the window: a change done today counts, blocked counts as it stands, last moved tints past the window', () => {
  set(store, 'change:shop/chore', ['status=done'], {});
  set(store, 'change:shop/card-endpoint', ['status=blocked'], {});
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', days: 7 });
  assert.equal(s.health.done, 1);
  assert.equal(s.health.blocked, 1);
  assert.equal(s.health.days, 7);
  const checkout = find(s.tree, 'feature:shop/checkout')!;
  assert.equal(checkout.health?.blocked, 1);
  assert.equal(find(s.tree, 'feature:shop/search')!.health?.blocked, 0);
  // a window that ended long ago: nothing moved inside it, last stays
  const stale = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', now: Date.now() + 30 * 86_400_000 });
  assert.equal(stale.health.moved, 0);
  assert.equal(stale.health.staleDays, 30);
  assert.deepEqual(stale.sessions, []);
});

test('bugs: one home at the severity level, counts roll up with the worst named, the queue worst first; the roadmap: the sequence, later, the checks', () => {
  // a capability bug with feature severity is listed at the feature; a product one at the root; a nuisance where named
  change(store, 'cards-crash', { title: 'Saving a card crashes', summary: 'b', project: 'project:web', kind: 'bug', severity: 'feature', features: ['feature:shop/saved-cards'] });
  change(store, 'down', { title: 'Nothing loads', summary: 'b', project: 'project:web', kind: 'bug', severity: 'product', features: ['feature:shop/search'] });
  change(store, 'typo', { title: 'Typo in search', summary: 'b', project: 'project:web', kind: 'bug', severity: 'cosmetic', features: ['feature:shop/search'], created: '2026-01-01' });
  change(store, 'slow-search', { title: 'Search is slow', summary: 'b', project: 'project:web', kind: 'bug', severity: 'nuisance', features: ['feature:shop/search'] });
  set(store, 'product:shop', ['sequence=change:cards,change:old'], {});
  set(store, 'change:shop/cards', ['target=2026-12-01'], {});
  set(store, 'change:shop/chore', ['status=open', 'depends_on=change:cards'], {});
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop' });
  const byKey = Object.fromEntries(s.changes.map((c) => [c.key, c]));
  assert.equal(byKey['change:shop/cards-crash'].home, 'feature:shop/checkout');
  assert.equal(byKey['change:shop/down'].home, 'product:shop');
  assert.equal(byKey['change:shop/typo'].home, 'feature:shop/search');
  assert.equal(byKey['change:shop/slow-search'].home, 'feature:shop/search');
  const checkout = find(s.tree, 'feature:shop/checkout')!;
  assert.deepEqual(checkout.bugs, { here: 1, beneath: 1, worst: 'feature' });
  assert.deepEqual(find(s.tree, 'feature:shop/saved-cards')!.bugs, { here: 0, beneath: 0, worst: undefined });
  assert.deepEqual(find(s.tree, 'feature:shop/search')!.bugs, { here: 2, beneath: 2, worst: 'nuisance' });
  // the queue beneath the product: product, feature, nuisance, cosmetic
  assert.deepEqual(s.bugs.map((b) => b.key), ['change:shop/down', 'change:shop/cards-crash', 'change:shop/slow-search', 'change:shop/typo']);
  const search = scope(store, loadStore(store), { lens: 'feature', node: 'feature:shop/search' });
  assert.deepEqual(search.bugs.map((b) => b.key), ['change:shop/down', 'change:shop/slow-search', 'change:shop/typo']);
  // the roadmap: what is ahead in the sequence in scope (old is done), children take their milestone's place, the
  // loose come after, bugs never
  assert.equal(s.roadmap.product, 'product:shop');
  assert.deepEqual(s.roadmap.sequence, ['change:shop/cards']);
  assert.equal(byKey['change:shop/card-form'].position, 0);
  assert.equal(byKey['change:shop/card-tests'].position, 0);
  assert.equal(byKey['change:shop/chore'].position, undefined);
  assert.deepEqual(s.roadmap.later, ['change:shop/chore']);
  assert.equal(byKey['change:shop/cards'].target, '2026-12-01');
  assert.deepEqual(byKey['change:shop/chore'].dependsOn, ['change:shop/cards']);
  assert.deepEqual(s.roadmap.violations, []);
  // a dependant placed before what it depends on; an overdue target
  set(store, 'product:shop', ['sequence=change:chore,change:cards,change:old'], {});
  set(store, 'change:shop/card-form', ['target=2020-01-01'], {});
  const v = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop' }).roadmap.violations;
  assert.deepEqual(v, [
    { kind: 'overdue', change: 'change:shop/card-form' },
    { kind: 'order', change: 'change:shop/chore', against: 'change:shop/cards' },
  ]);
  // began and finished come from the status events
  assert.ok(byKey['change:shop/card-endpoint'].began);
  assert.equal(byKey['change:shop/card-endpoint'].finished, undefined);
  const done = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', done: true }).changes.find((c) => c.key === 'change:shop/chore')!;
  assert.equal(done.finished, undefined);
  set(store, 'change:shop/chore', ['status=done'], {});
  const fin = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop', done: true }).changes.find((c) => c.key === 'change:shop/chore')!;
  assert.ok(fin.finished && fin.began && fin.began <= fin.finished);
});

test('the order reads what is ahead: done entries drop out and stay stored, a done milestone keeps its place for open children, a reopened change is back in its place', () => {
  change(store, 'phase', { title: 'Phase', summary: 's', project: 'project:web', status: 'done' });
  change(store, 'phase-kid', { title: 'Phase kid', summary: 's', project: 'project:web', parent: 'change:shop/phase' });
  change(store, 'shipped', { title: 'Shipped', summary: 's', project: 'project:web', status: 'done' });
  change(store, 'upcoming', { title: 'Upcoming', summary: 's', project: 'project:web' });
  set(store, 'product:shop', ['sequence=change:phase,change:shipped,change:upcoming'], {});
  const product = () => loadStore(store).byKey.get('product:shop')![0];
  const aheadNow = () => ahead(loadStore(store), product());
  assert.deepEqual(aheadNow(), ['change:shop/phase', 'change:shop/upcoming']);
  const s = scope(store, loadStore(store), { lens: 'feature', node: 'product:shop' });
  assert.deepEqual(s.roadmap.sequence, ['change:shop/phase', 'change:shop/upcoming']);
  assert.equal(s.changes.find((c) => c.key === 'change:shop/phase-kid')!.position, 0);
  // the milestone's last open child done: nothing open beneath it, so it drops out too
  set(store, 'change:shop/phase-kid', ['status=done'], {});
  assert.deepEqual(aheadNow(), ['change:shop/upcoming']);
  // a write moves only the entry named; the done entries stay as the person wrote them
  const r = order(store, 'change:shop/upcoming', { first: true });
  assert.deepEqual(r.sequence, ['change:shop/upcoming']);
  assert.deepEqual(product().data.sequence, ['change:shop/upcoming', 'change:shop/phase', 'change:shop/shipped']);
  // what is no longer ahead is no anchor
  assert.throws(() => order(store, 'change:shop/chore', { after: 'change:shop/shipped' }), /no longer ahead/);
  // reopened, it is back where it was
  set(store, 'change:shop/shipped', ['status=open'], {});
  assert.deepEqual(aheadNow(), ['change:shop/upcoming', 'change:shop/shipped']);
});
