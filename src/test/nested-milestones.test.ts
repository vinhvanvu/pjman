// change:nested-milestones: a milestone under a milestone reads as a stage of its parent. Its progress is counted through
// the stages (decision progress-rollup: the work beneath, a stage with no child yet counting as one), intake lists the
// top level with the stages counted, and ls prints a stage beneath its parent (decision ls-nesting).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { formatIntake, intake } from '../model/intake.js';
import { scope } from '../model/scope.js';
import { changeContext, formatLs, ls, rollupOf } from '../model/view.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-nested-'));
let store: Store;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'game');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'game' });
  store = findStore(dir)!;
  const ms = (slug: string, flags: Record<string, unknown> = {}) =>
    change(store, slug, { title: `${slug} goal`, kind: 'milestone', status: 'open', ...flags });
  ms('loop'); // the goal in flight
  ms('stage-a', { parent: 'change:loop' }); // two pieces of work, one done
  change(store, 'a-one', { title: 'a one', parent: 'change:stage-a', status: 'done' });
  change(store, 'a-two', { title: 'a two', parent: 'change:stage-a', status: 'active' });
  ms('stage-b', { parent: 'change:loop', status: 'done' }); // no child: counts as one, done
  ms('stage-c', { parent: 'change:loop', status: 'dropped' }); // dropped: left out with what is beneath it
  change(store, 'c-one', { title: 'c one', parent: 'change:stage-c', status: 'done' });
  ms('stage-d', { parent: 'change:loop' }); // no child yet: counts as one, open
  ms('older'); // an unrelated milestone, top level
  change(store, 'older-work', { title: 'older work', parent: 'change:older', status: 'open' });
});

test('rollupOf: the work beneath, a milestone with no child counting as one, dropped left out, a loop safe', () => {
  const kids: Record<string, { key: string; status?: string; kind?: string }[]> = {
    top: [
      { key: 'a', kind: 'milestone', status: 'open' },
      { key: 'b', kind: 'milestone', status: 'done' },
      { key: 'x', status: 'dropped' },
    ],
    a: [
      { key: 'a1', status: 'done' },
      { key: 'top', kind: 'milestone', status: 'open' }, // a loop back to the top: never walked again
    ],
  };
  assert.deepEqual(
    rollupOf('top', (k) => kids[k] ?? []),
    { done: 2, total: 2 },
  );
  assert.equal(
    rollupOf('none', () => []),
    undefined,
  );
});

test('a milestone of stages counts its progress through them, in the context and the scope rows', () => {
  const loaded = loadStore(store);
  assert.deepEqual(changeContext(store, 'change:loop', loaded).progress, { done: 2, total: 4 });
  assert.deepEqual(changeContext(store, 'change:stage-a', loaded).progress, { done: 1, total: 2 });
  const s = scope(store, loaded, { lens: 'roadmap', node: 'product:game', done: true });
  const row = (k: string) => s.changes.find((c) => c.key === k);
  assert.deepEqual(row('change:game/loop')?.progress, { done: 2, total: 4 });
  assert.deepEqual(row('change:game/stage-d')?.progress, { done: 0, total: 0 }); // a milestone with no child yet
});

test('intake lists the top level, each with its stages counted', () => {
  const i = intake(store, loadStore(store), 'a request about nothing in particular');
  assert.deepEqual(
    i.milestones.map((m) => [m.key, m.progress, m.stages]),
    [
      ['change:game/loop', { done: 2, total: 4 }, { total: 3, inFlight: 2 }],
      ['change:game/older', { done: 0, total: 1 }, undefined],
    ],
  );
  assert.match(formatIntake(i), /- change:game\/loop \[open\] 2\/4 · 3 stages, 2 in flight —/);
});

test('ls prints a stage beneath its listed parent, indented; the JSON rows stay flat', () => {
  const rows = ls(store, { type: 'change', kind: 'milestone', status: 'open' });
  assert.deepEqual(rows.map((r) => r.key).toSorted(), [
    'change:game/loop',
    'change:game/older',
    'change:game/stage-a',
    'change:game/stage-d',
  ]);
  const text = formatLs(rows);
  const lines = text.split('\n');
  const at = (k: string) => lines.findIndex((l) => new RegExp(`\\s${k}\\s`).test(l));
  for (const k of ['change:game/stage-a', 'change:game/stage-d']) {
    assert.ok(at(k) > at('change:game/loop'), `${k} beneath its parent`);
    assert.ok(text.includes(`    ${k}`), `${k} indented`);
  }
  assert.ok(!text.includes('    change:game/loop'));
  assert.ok(!text.includes('    change:game/older'));
});
