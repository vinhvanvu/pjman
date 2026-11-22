// change:milestone-order: a milestone's children read in the order the work can run (decision order-rule, deps-first):
// a child after each sibling it depends on (a dependency on a sibling's child counting for the sibling), then the
// roadmap's position among those free to go, then creation. The scope's rows, the change context, the project context
// and ls all read the one derivation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { workOrder } from '../model/order.js';
import { order } from '../ops/order.js';
import { scope } from '../model/scope.js';
import { changeContext, formatLs, ls, siblingsInWorkOrder } from '../model/view.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-milestone-order-'));
let store: Store;

// created in an order that is not the work's, so creation alone reads it wrong
const CHAIN = ['walk', 'work', 'judge'];
const SECOND = ['shell', 'weather']; // both wait on judge only: free to go in either order
const ALL = [...CHAIN, ...SECOND, 'balance'];

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'game');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'game' });
  store = findStore(dir)!;
  const stage = (slug: string, created: string, dependsOn: string[] = []) =>
    change(store, slug, {
      title: `${slug} stage`,
      kind: 'milestone',
      status: 'open',
      parent: 'change:loop',
      created,
      dependsOn: dependsOn.map((d) => `change:${d}`),
    });
  change(store, 'loop', { title: 'the loop', kind: 'milestone', status: 'open', created: '2026-01-01' });
  // (filed in chain order, since a dependency must exist; dated the other way round)
  stage('walk', '2026-01-07');
  change(store, 'walk-one', { title: 'walk one', parent: 'change:walk', status: 'open', created: '2026-01-08' });
  stage('work', '2026-01-06', ['walk-one']); // on a child of walk: counts as on walk
  stage('judge', '2026-01-03', ['work']);
  stage('shell', '2026-01-05', ['judge']);
  stage('weather', '2026-01-04', ['judge']);
  stage('balance', '2026-01-02', ['shell', 'weather']);
});

const short = (k: string) => k.replace(/^change:(game\/)?/, '');
const ranked = () => {
  const o = workOrder(loadStore(store));
  return ALL.toSorted((a, b) => o.get(`change:game/${a}`)! - o.get(`change:game/${b}`)!);
};

test('dependencies first, creation among those free to go', () => {
  assert.deepEqual(ranked(), ['walk', 'work', 'judge', 'weather', 'shell', 'balance']);
});

test('every view of the children reads the order: scope rows, the change context, ls', () => {
  const loaded = loadStore(store);
  const s = scope(store, loaded, { lens: 'roadmap', node: 'product:game', done: true });
  const rows = s.changes
    .filter((c) => c.parent === 'change:game/loop')
    .toSorted((a, b) => a.childOrder! - b.childOrder!);
  assert.deepEqual(
    rows.map((r) => short(r.key)),
    ['walk', 'work', 'judge', 'weather', 'shell', 'balance'],
  );
  assert.deepEqual(
    changeContext(store, 'change:loop', loaded).children.map((c) => short(c.key)),
    ['walk', 'work', 'judge', 'weather', 'shell', 'balance'],
  );
  const listed = siblingsInWorkOrder(ls(store, { type: 'change', parent: 'change:game/loop' }), workOrder(loaded));
  assert.deepEqual(
    listed.map((r) => short(r.key)),
    ['walk', 'work', 'judge', 'weather', 'shell', 'balance'],
  );
  // nested beneath the listed parent, in the same order
  const text = formatLs(siblingsInWorkOrder(ls(store, { type: 'change', kind: 'milestone' }), workOrder(loaded)));
  const stages = text
    .split('\n')
    .map((l) => /\s{4}(change:\S+)/.exec(l)?.[1] ?? '') // indented: beneath the loop
    .filter(Boolean)
    .map(short);
  assert.deepEqual(stages, ['walk', 'work', 'judge', 'weather', 'shell', 'balance']);
});

test('the roadmap orders only what the dependencies leave free', () => {
  order(store, 'change:shell', { first: true }); // free beside weather: moves ahead of it
  order(store, 'change:balance', { first: true }); // waits on both: stays last
  assert.deepEqual(ranked(), ['walk', 'work', 'judge', 'shell', 'weather', 'balance']);
});

test('a dependency through a change outside the milestone still orders the siblings', () => {
  // late depends on bridge, outside the loop; bridge depends on early: late after early
  change(store, 'other', { title: 'other goal', kind: 'milestone', status: 'open', created: '2026-01-01' });
  change(store, 'early', { title: 'early', parent: 'change:other', status: 'open', created: '2026-02-02' });
  change(store, 'bridge', { title: 'bridge', status: 'open', created: '2026-02-01', dependsOn: ['change:early'] });
  change(store, 'late', {
    title: 'late',
    parent: 'change:other',
    status: 'open',
    created: '2026-01-15',
    dependsOn: ['change:bridge'],
  });
  const o = workOrder(loadStore(store));
  assert.ok(o.get('change:game/early')! < o.get('change:game/late')!);
});
