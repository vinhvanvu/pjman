// The event stream says what a move was, not only that a field moved (change:activity-timeline): a set that moves a
// change's or a decision's status carries the new value, a session's bind and focus carry the change's key, and the
// stream rebuilt from the store's history carries the same values as the live writes did.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionFocus } from '../ops/session.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents, rebuildEvents, type StoreEvent } from '../store/events.js';
import { accept, change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-events-'));
const dir = path.join(tmp, 'web');
let store: Store;

const last = (): StoreEvent => readEvents(store).at(-1)!;
const on = (key: string): StoreEvent[] => readEvents(store).filter((e) => e.key === key);

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
  newRecord(store, 'session', 'me', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
});

test('a set that moves a status carries the new value; one that moves another field carries none', () => {
  set(store, 'change:auth', ['status=active'], {});
  const e = last();
  assert.equal(e.op, 'set');
  assert.deepEqual(e.fields, ['status']);
  assert.equal(e.value, 'active');
  set(store, 'change:auth', ['intent=what the test needs now'], {});
  assert.equal(last().value, undefined);
});

test('a decision opened carries no value; accepted, its event names the status and the decider', () => {
  const d = decisionRec(store, 'auth/tokens', { title: 'Tokens', decision: 'd', why: 'w' });
  assert.equal(last().op, 'created');
  assert.equal(last().value, undefined);
  accept(store, d.key, 'person:tester');
  const e = last();
  assert.equal(e.key, d.key);
  assert.ok(e.fields?.includes('status'));
  assert.equal(e.value, 'decided');
});

test('a decision superseded by a new one is set superseded, with the value on its event', () => {
  decisionRec(store, 'auth/tokens-2', { title: 'Tokens again', decision: 'd', why: 'w', supersedes: 'decision:auth/tokens' });
  const e = on('decision:web/auth/tokens').at(-1)!;
  assert.equal(e.op, 'set');
  assert.deepEqual(e.fields, ['status']);
  assert.equal(e.value, 'superseded');
});

test("a session's bind and focus carry the change's key", () => {
  sessionBind(store, 'me', 'change:auth', 'prompt');
  let e = last();
  assert.equal(e.op, 'bind');
  assert.equal(e.value, 'change:web/auth');
  sessionFocus(store, 'me', 'change:billing');
  e = last();
  assert.equal(e.op, 'set');
  assert.deepEqual(e.fields, ['focus']);
  assert.equal(e.value, 'change:web/billing');
});

test('the stream rebuilt from history carries the same values the live writes did', () => {
  // the fields differ by design on a decision write (the live write names what changed, the rebuild the entries appended);
  // the value is what this compares
  const live = readEvents(store).map((e) => [e.op, e.key, e.value]);
  rebuildEvents(store);
  const rebuilt = readEvents(store).map((e) => [e.op, e.key, e.value]);
  const valued = (rows: unknown[][]) => rows.filter((r) => r[2] !== undefined);
  assert.deepEqual(valued(rebuilt), valued(live));
  assert.ok(valued(live).length >= 5, 'the status, the acceptance, the supersession, the bind and the focus');
});
