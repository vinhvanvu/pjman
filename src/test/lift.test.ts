import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionObserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents } from '../store/events.js';
import { liftsOfStore } from '../ops/lift.js';
import { loadStore, resolve } from '../store/records.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-lift-'));
let store: Store;

const statusOf = (slug: string): unknown => {
  const res = resolve(loadStore(store), `change:${slug}`);
  assert.ok(res.status === 'ok' || res.status === 'alias');
  return res.rec.data.status;
};

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

test('a step added makes an open change planning; a step started makes it active', () => {
  change(store, 'plain', { project: 'project:web' });
  assert.equal(statusOf('plain') ?? 'open', 'open');
  step(store, 'change:plain', 'add', undefined, { text: 'first' });
  assert.equal(statusOf('plain'), 'planning');
  const lifted = readEvents(store).at(-1)!;
  assert.equal(lifted.op, 'set');
  assert.deepEqual(lifted.fields, ['status']);
  step(store, 'change:plain', 'start', 1);
  assert.equal(statusOf('plain'), 'active');
});

test('a status a person set stays: blocked, review, done and dropped are never lifted', () => {
  for (const status of ['blocked', 'review', 'done', 'dropped']) {
    change(store, `held-${status}`, { project: 'project:web' });
    set(store, `change:held-${status}`, [`status=${status}`], {});
    step(store, `change:held-${status}`, 'add', undefined, { text: 'first' });
    step(store, `change:held-${status}`, 'start', 1);
    assert.equal(statusOf(`held-${status}`), status);
  }
});

test('nothing automatic moves a status backwards', () => {
  change(store, 'ahead', { project: 'project:web' });
  set(store, 'change:ahead', ['status=active'], {});
  step(store, 'change:ahead', 'add', undefined, { text: 'first' });
  assert.equal(statusOf('ahead'), 'active');
  // the only step done runs the plan to its end: review; the step reopened leaves the change there
  step(store, 'change:plain', 'done', 1);
  assert.equal(statusOf('plain'), 'review');
  step(store, 'change:plain', 'reopen', 1);
  assert.equal(statusOf('plain'), 'review');
});

test('a session bound to a change makes it active when it writes a file, not when it only binds or lands on a branch', () => {
  change(store, 'worked', { project: 'project:web' });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 's1', 'change:worked');
  sessionObserve(store, 's1', 'links', 'change:worked', 'branch:worked');
  assert.equal(statusOf('worked') ?? 'open', 'open');
  sessionObserve(store, 's1', 'links', 'change:worked', 'file:src/a.ts');
  assert.equal(statusOf('worked'), 'active');
  const lifted = readEvents(store).at(-1)!;
  assert.equal(lifted.session, 'session:s1');
});

test('the last step done makes a change review; a dropped step does not count; a step reopened leaves it there', () => {
  change(store, 'finished', { project: 'project:web' });
  step(store, 'change:finished', 'add', undefined, { text: 'first' });
  step(store, 'change:finished', 'add', undefined, { text: 'second' });
  step(store, 'change:finished', 'add', undefined, { text: 'third' });
  step(store, 'change:finished', 'done', 1);
  assert.equal(statusOf('finished'), 'active');
  step(store, 'change:finished', 'drop', 3);
  assert.equal(statusOf('finished'), 'active');
  step(store, 'change:finished', 'done', 2);
  assert.equal(statusOf('finished'), 'review');
  const lifted = readEvents(store).at(-1)!;
  assert.equal(lifted.op, 'set');
  assert.deepEqual(lifted.fields, ['status']);
  assert.equal(lifted.value, 'review');
  step(store, 'change:finished', 'reopen', 2);
  assert.equal(statusOf('finished'), 'review');
  // a plan of dropped steps only is no plan run to its end
  change(store, 'abandoned', { project: 'project:web' });
  step(store, 'change:abandoned', 'add', undefined, { text: 'first' });
  step(store, 'change:abandoned', 'drop', 1);
  assert.equal(statusOf('abandoned'), 'planning');
});

test('the backfill lists the changes whose status is behind their plan', () => {
  change(store, 'behind', { project: 'project:web' });
  step(store, 'change:behind', 'add', undefined, { text: 'first' });
  // a person moves it back by hand; the rule after writes leaves that, the backfill names it
  set(store, 'change:behind', ['status=open'], {});
  assert.equal(statusOf('behind'), 'open');
  const lifts = liftsOfStore(loadStore(store));
  assert.deepEqual(lifts.map((l) => [l.key.split('/').pop(), l.from, l.to]), [['behind', 'open', 'planning']]);
});
