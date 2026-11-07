// The rail at every scope (change:activity-timeline): on a tree node the lanes are the units beneath it and a row
// drills to its session; on a session the lanes are the changes it touched, its lines the trunk, a focus move a
// switch; lanes beyond a handful fold into one; events older than the window bucket by day with their health.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionFocus, sessionLog, sessionObserve } from '../commands/session.js';
import { set } from '../commands/set.js';
import { step } from '../commands/step.js';
import { findStore, type Store } from '../config.js';
import { loadStore } from '../records.js';
import { rail } from '../rail.js';
import { accept, change, decisionRec } from './shape.js';

const DAY = 86_400_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-rail-'));
const dir = path.join(tmp, 'web');
let store: Store;

before(() => {
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
  change(store, 'auth', { title: 'Auth', summary: 's', project: 'project:web' });
  change(store, 'billing', { title: 'Billing', summary: 's', project: 'project:web' });
  change(store, 'platform', { title: 'Platform', summary: 's', project: 'project:web' });
  change(store, 'child-a', { title: 'Child A', summary: 's', project: 'project:web', parent: 'change:platform' });
  change(store, 'child-b', { title: 'Child B', summary: 's', project: 'project:web', parent: 'change:platform' });
  for (const n of [1, 2, 3]) change(store, `extra-${n}`, { title: `Extra ${n}`, summary: 's', project: 'project:web' });
  newRecord(store, 'session', 'me', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 'me', 'change:auth', 'prompt');
  set(store, 'change:auth', ['status=active'], { session: 'session:me' });
  decisionRec(store, 'auth/tokens', { title: 'Tokens', decision: 'd', why: 'w', session: 'session:me' });
  decisionRec(store, 'auth/cookies', { title: 'Cookies', decision: 'd', why: 'w', session: 'session:me' });
  accept(store, 'decision:auth/tokens', 'person:tester');
  step(store, 'change:child-a', 'add', undefined, { text: 'first', session: 'session:me' });
  sessionLog(store, 'me', 'looked at billing');
  sessionFocus(store, 'me', 'change:billing');
});

test('a change: its decisions are the lanes, its own events the trunk, every row drills to the session that wrote it', () => {
  const r = rail(store, loadStore(store), 'change:auth');
  assert.equal(r.axis, 'tree');
  assert.equal(r.lanes.length, 2);
  assert.ok(r.lanes.every((l) => l.kind === 'decision'));
  assert.ok(r.lanes.some((l) => l.id === 'decision:web/auth/tokens' && l.status === 'decided'));
  assert.ok(r.lanes.some((l) => l.id === 'decision:web/auth/cookies' && l.status === 'proposed'));
  const own = r.rows.filter((row) => row.key === 'change:web/auth');
  assert.ok(own.length >= 2);
  assert.ok(own.every((row) => row.lane === null));
  const status = own.find((row) => row.op === 'set' && row.fields?.includes('status'))!;
  assert.equal(status.value, 'active');
  assert.equal(status.drill, 'session:me');
  const accepted = r.rows.find((row) => row.key === 'decision:web/auth/tokens' && row.value === 'decided')!;
  assert.equal(accepted.kind, 'decision');
  assert.equal(accepted.lane, 'decision:web/auth/tokens');
  assert.deepEqual(r.buckets, []);
  assert.equal(r.total, r.rows.length);
});

test('a milestone: its children are the lanes, and a write beneath a child falls in that lane', () => {
  const r = rail(store, loadStore(store), 'change:platform');
  assert.deepEqual(r.lanes.map((l) => l.id).sort(), ['change:web/child-a', 'change:web/child-b']);
  assert.ok(r.lanes.every((l) => l.kind === 'change'));
  const stepRow = r.rows.find((row) => row.key === 'change:web/child-a' && row.fields?.includes('plan'))!;
  assert.equal(stepRow.lane, 'change:web/child-a');
  assert.equal(stepRow.drill, 'session:me');
  // the step lifted the child's status in the same write, so the lane's last touch is at or after the step
  assert.ok(r.lanes.find((l) => l.id === 'change:web/child-a')!.last! >= stepRow.at);
});

test("a session: the changes it touched are the lanes, its lines the trunk, a bind and a focus name their change, a write drills to its change", () => {
  const r = rail(store, loadStore(store), 'session:me');
  assert.equal(r.axis, 'session');
  // last touch first: the focus on billing, the step on child-a, the writes on auth
  assert.deepEqual(r.lanes.map((l) => l.id), ['change:web/billing', 'change:web/child-a', 'change:web/auth']);
  const bind = r.rows.find((row) => row.kind === 'bind')!;
  assert.equal(bind.value, 'change:web/auth');
  assert.equal(bind.lane, 'change:web/auth');
  const sw = r.rows.find((row) => row.kind === 'switch')!;
  assert.equal(sw.value, 'change:web/billing');
  assert.equal(sw.lane, 'change:web/billing');
  const line = r.rows.find((row) => row.kind === 'line')!;
  assert.equal(line.lane, null);
  const write = r.rows.find((row) => row.key === 'change:web/auth' && row.op === 'set')!;
  assert.equal(write.drill, 'change:web/auth');
  const decided = r.rows.find((row) => row.key === 'decision:web/auth/tokens' && row.kind === 'decision')!;
  assert.equal(decided.lane, 'change:web/auth');
});

test('a file a session touched is a file row in the lane of the change it was on, naming the path', () => {
  sessionObserve(store, 'me', 'binds', 'change:auth', 'file:ui/src/auth.ts');
  const r = rail(store, loadStore(store), 'session:me');
  const file = r.rows.find((row) => row.kind === 'file')!;
  assert.deepEqual(file.files, ['ui/src/auth.ts']);
  assert.equal(file.lane, 'change:web/auth');
  assert.equal(file.drill, 'change:web/auth');
});

test('the product: every change beneath it is a lane, and beyond the handful the rest fold into one', () => {
  const r = rail(store, loadStore(store), 'product:web', { lanes: 3 });
  assert.equal(r.lanes.length, 4);
  const more = r.lanes.at(-1)!;
  assert.equal(more.id, 'more');
  assert.equal(more.kind, 'more');
  assert.ok(more.folded! >= 3);
  assert.equal(r.rows.filter((row) => row.lane === 'more').length, more.count);
  assert.ok(r.rows.every((row) => row.lane === null || row.lane === 'more' || r.lanes.some((l) => l.id === row.lane)));
  const wide = rail(store, loadStore(store), 'product:web', { lanes: 50 });
  assert.ok(!wide.lanes.some((l) => l.id === 'more'));
});

test('events older than the window bucket by day, carrying the health the day moved', () => {
  const r = rail(store, loadStore(store), 'change:auth', { now: Date.now() + 30 * DAY, days: 14 });
  assert.deepEqual(r.rows, []);
  assert.equal(r.buckets.length, 1);
  const b = r.buckets[0]!;
  assert.match(b.day, /^\d{4}-\d\d-\d\d$/);
  assert.equal(b.count, r.total);
  assert.equal(b.health.created, 1);
  assert.ok(b.health.moved >= 1);
  assert.equal(b.health.waiting, 2);
  assert.equal(b.health.done, 0);
  assert.ok(b.lanes['trunk']! >= 2);
  assert.ok(b.lanes['decision:web/auth/tokens']! >= 2);
});
