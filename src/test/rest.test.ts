import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { formatRest, restOf } from '../model/rest.js';
import { accept, change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-rest-'));
let store: Store;
const rest = (slug: string) => restOf(loadStore(store), `change:${slug}`);

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
});

test('a change with steps open and nothing waiting does not rest, and the open steps are named', () => {
  change(store, 'build', { project: 'project:web' });
  step(store, 'change:build', 'add', undefined, { text: 'first' });
  step(store, 'change:build', 'add', undefined, { text: 'second' });
  step(store, 'change:build', 'add', undefined, { text: 'third' });
  step(store, 'change:build', 'start', 1);
  const r = rest('build');
  assert.equal(r.rests, false);
  assert.deepEqual(
    r.open.map((s) => [s.n, s.step.state]),
    [
      [1, 'active'],
      [2, 'open'],
      [3, 'open'],
    ],
  );
  assert.equal(
    formatRest(r),
    'change:web/build does not rest: 3 steps are open\n- 1. first (in progress)\n- 2. second\n- 3. third',
  );
  // a step dropped is not open; the plan still has work
  step(store, 'change:build', 'drop', 3);
  assert.deepEqual(
    rest('build').open.map((s) => s.n),
    [1, 2],
  );
});

test('a proposed decision on the change is a resting point; accepted, it no longer is', () => {
  decisionRec(store, 'build/shape', { title: 'Which shape' });
  const r = rest('build');
  assert.equal(r.rests, true);
  assert.deepEqual(r.waiting, ['decision:web/build/shape']);
  assert.match(r.because!, /decision:web\/build\/shape is proposed and waits on the person/);
  accept(store, 'decision:build/shape', 'person:tester');
  assert.equal(rest('build').rests, false);
});

test('a blocker recorded is a resting point: blocked-on, or a dependency not done', () => {
  set(store, 'change:build', ['blocked-on=the API key from ops'], {});
  assert.match(rest('build').because!, /blocked on: the API key from ops/);
  set(store, 'change:build', ['blocked-on='], {});
  assert.equal(rest('build').rests, false);
  change(store, 'first-this', { project: 'project:web' });
  set(store, 'change:build', ['depends_on=change:first-this'], {});
  const r = rest('build');
  assert.equal(r.rests, true);
  assert.deepEqual(r.dependsOn, ['change:web/first-this']);
  set(store, 'change:first-this', ['status=done'], {});
  assert.equal(rest('build').rests, false);
});

test('a status a person set holds the change: blocked, review, done, dropped', () => {
  for (const status of ['blocked', 'review', 'done', 'dropped']) {
    change(store, `held-${status}`, { project: 'project:web' });
    step(store, `change:held-${status}`, 'add', undefined, { text: 'first' });
    step(store, `change:held-${status}`, 'start', 1);
    assert.equal(rest(`held-${status}`).rests, false);
    set(store, `change:held-${status}`, [`status=${status}`], {});
    assert.equal(rest(`held-${status}`).because, `its status is ${status}`);
  }
});

test('a plan run to its end rests, and a change with no plan has nothing to run', () => {
  step(store, 'change:build', 'done', 1);
  step(store, 'change:build', 'done', 2);
  // the last step done lifted it to review, which holds it; moved back by hand, the plan itself says it rests
  assert.equal(rest('build').because, 'its status is review');
  set(store, 'change:build', ['status=active'], {});
  const r = rest('build');
  assert.equal(r.rests, true);
  assert.equal(r.because, 'its plan has run to its end');
  assert.deepEqual(r.open, []);
  change(store, 'unplanned', { project: 'project:web' });
  assert.equal(rest('unplanned').because, 'it has no plan to run');
});

test('a key that names no change is refused', () => {
  assert.throws(() => rest('nothing-here'), /is not a change/);
});
