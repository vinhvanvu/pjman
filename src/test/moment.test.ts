import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { bridge } from '../model/bridge.js';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionLog } from '../ops/session.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents } from '../store/events.js';
import { eventsBetween, gitSource, loadAt, momentCache, resolveMoment } from '../model/moment.js';
import { loadStore } from '../store/records.js';
import { live } from '../model/tree.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-moment-'));
let store: Store;
/** The event that set the first title, and the one that set the second. */
let firstTitle = 0;
let secondTitle = 0;
let firstLine = 0;

const tick = () => {
  const until = Date.now() + 5;
  while (Date.now() < until) { /* wait */ }
};
const lastSeqNow = () => readEvents(store).at(-1)!.seq;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  set(store, 'project:web', ['product=product:shop'], {});
  change(store, 'login', { title: 'Login', summary: 's', project: 'project:web', status: 'open', next: 'n' });
  firstTitle = lastSeqNow();
  tick();
  set(store, 'change:login', ['gist=Login with magic links'], {});
  secondTitle = lastSeqNow();
  tick();
  newRecord(store, 'session', 's-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 's-1', 'change:shop/login');
  tick();
  sessionLog(store, 's-1', 'First stop.');
  firstLine = lastSeqNow();
  tick();
  sessionLog(store, 's-1', 'Second stop.');
});

test('a moment by sequence number: the event itself; past the end, the last event; before the first, refused', () => {
  const m = resolveMoment(store, firstTitle);
  assert.equal(m.seq, firstTitle);
  assert.ok(m.commit, 'a commit stands behind the write');
  assert.equal(resolveMoment(store, 10_000).seq, lastSeqNow());
  assert.equal(resolveMoment(store, String(secondTitle)).seq, secondTitle);
  assert.throws(() => resolveMoment(store, 0), /sequence number/);
  assert.throws(() => resolveMoment(store, 'yesterday'), /not an event/);
});

test('a moment by instant: the last event at or before it', () => {
  const events = readEvents(store);
  const second = events.find((e) => e.seq === secondTitle)!;
  assert.equal(resolveMoment(store, second.at).seq, secondTitle);
  // one millisecond before the second title was set: the stream stood at the event before it
  const before = new Date(Date.parse(second.at) - 1).toISOString();
  assert.equal(resolveMoment(store, before).seq, secondTitle - 1);
  assert.throws(() => resolveMoment(store, '2000-01-01T00:00:00Z'), /before the first event/);
});

test('the store at a moment reads the records as they stood, from the commit, with the working tree untouched', () => {
  const then = loadAt(store, firstTitle);
  assert.equal(live(then.loaded, 'change:shop/login')?.data.gist, 'Login');
  const later = loadAt(store, secondTitle);
  assert.equal(live(later.loaded, 'change:shop/login')?.data.gist, 'Login with magic links');
  // the session's record did not exist yet at the first title
  assert.equal(live(then.loaded, 'session:s-1'), undefined);
  assert.ok(live(loadAt(store, firstLine).loaded, 'session:s-1'));
  // the working tree is what it is now
  assert.equal(live(loadStore(store), 'change:shop/login')?.data.gist, 'Login with magic links');
  assert.equal(then.loaded.problems.filter((p) => p.level === 'error').length, 0);
});

test('a moment is cached by commit; the copy handed back may take a scope without touching the cache', () => {
  const a = loadAt(store, secondTitle);
  const before = momentCache().hits;
  const b = loadAt(store, secondTitle);
  assert.equal(momentCache().hits, before + 1);
  b.loaded.scope = 'other';
  assert.notEqual(a.loaded.scope, 'other');
  assert.equal(loadAt(store, secondTitle).loaded.scope, a.loaded.scope);
});

test('a git source lists and reads what the loader needs, and refuses a commit the store never had', () => {
  const src = gitSource(store.root, resolveMoment(store, secondTitle).commit);
  assert.ok(src.isDir('products'));
  assert.ok(src.list('products').includes('shop'));
  assert.ok(src.exists('products/shop/product.md'));
  assert.match(src.read('products/shop/changes/login/change.md'), /Login with magic links/);
  assert.throws(() => gitSource(store.root, 'deadbeef'), /not in the store's history/);
});

test('events between two points: since < seq <= until', () => {
  const between = eventsBetween(store, firstTitle, secondTitle);
  assert.ok(between.length >= 1);
  assert.ok(between.every((e) => e.seq > firstTitle && e.seq <= secondTitle));
  assert.equal(between.at(-1)!.seq, secondTitle);
  assert.deepEqual(eventsBetween(store, secondTitle, secondTitle), []);
});

test('the bridge at a moment: the session as it stood, its stream cut after the event', () => {
  const { moment, loaded } = loadAt(store, firstLine);
  const b = bridge(store, loaded, { product: 'product:shop', now: Date.parse(moment.at), until: moment.seq });
  const s = b.sessions.find((x) => x.key === 'session:s-1')!;
  assert.equal(s.line?.text, 'First stop.');
  const now = bridge(store, loadStore(store), { product: 'product:shop' });
  assert.equal(now.sessions.find((x) => x.key === 'session:s-1')!.line?.text, 'Second stop.');
});
