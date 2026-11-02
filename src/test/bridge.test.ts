import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { bridge, sessionState } from '../bridge.js';
import { timeline } from '../timeline.js';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionLog } from '../commands/session.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { loadStore } from '../records.js';
import { accept, change, decisionRec, next } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-bridge-'));
let store: Store;

/** Let the clock move, so the next write is stamped after the last. */
const tick = () => {
  const until = Date.now() + 5;
  while (Date.now() < until) { /* wait */ }
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
  newRecord(store, 'product', 'shop', { title: 'Shop', owners: ['person:tester'], summary: 'A shop.' });
  set(store, 'project:web', ['product=product:shop'], {});
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Saved cards for faster checkout', name: 'Saved cards', parent: 'feature:shop/checkout' });
  change(store, 'card-form', { title: 'Card form', summary: 's', project: 'project:web', features: ['adds feature:shop/saved-cards'], status: 'active', next: 'Wire the form.' });
  change(store, 'chore', { title: 'Chore', summary: 's', project: 'project:web', status: 'review', next: 'Review it.' });
  decisionRec(store, 'card-form/later', { title: 'Later', decision: 'd2', why: 'w' });
  decisionRec(store, 'card-form/why', { title: 'Why', decision: 'd', why: 'w' });
  // waiting: bound, then stopped with a line, and a decision proposed on its change
  newRecord(store, 'session', 's-wait', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 's-wait', 'change:shop/card-form');
  tick();
  sessionLog(store, 's-wait', 'Opened a decision; it is yours.');
  // working: its last act came after its last line
  newRecord(store, 'session', 's-work', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionLog(store, 's-work', 'session started');
  tick();
  sessionBind(store, 's-work', 'change:shop/chore');
  // stopped: a line last, nothing proposed on its change
  newRecord(store, 'session', 's-stop', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 's-stop', 'change:shop/chore');
  tick();
  sessionLog(store, 's-stop', 'Done for now.');
  // ended on a change in review
  newRecord(store, 'session', 's-end', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 's-end', 'change:shop/chore');
  tick();
  sessionLog(store, 's-end', 'Shipped it; left for review.');
  tick();
  sessionLog(store, 's-end', 'session ended (prompt_input_exit)');
  // a subagent of s-work: carried under it, never a row
  newRecord(store, 'session', 's-kid', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', parent: 'session:s-work' });
  sessionLog(store, 's-kid', 'spawned by session:s-work (fork)');
  tick();
  sessionLog(store, 's-kid', 'Built the thing.');
  // no change yet: only its project names its product
  newRecord(store, 'session', 's-fresh', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionLog(store, 's-fresh', 'session started');
});

test('sessionState: ended beats everything; working while the last act is recent and not a stop line; a stopped session waits when a decision is proposed', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const t = (m: number) => new Date(now - m * 60_000).toISOString();
  assert.equal(sessionState({ ended: true, line: t(1), act: t(0), proposed: true }, now), 'ended');
  assert.equal(sessionState({ ended: false, line: t(5), act: t(1), proposed: true }, now), 'working'); // acted after its line
  assert.equal(sessionState({ ended: false, act: t(1), proposed: false }, now), 'working'); // no line yet
  assert.equal(sessionState({ ended: false, line: t(1), act: t(5), proposed: true }, now), 'waiting'); // the line is its latest act
  assert.equal(sessionState({ ended: false, line: t(1), act: t(5), proposed: false }, now), 'stopped');
  assert.equal(sessionState({ ended: false, line: t(1), proposed: false }, now), 'stopped'); // a line, no write at all
  assert.equal(sessionState({ ended: false, line: t(90), act: t(40), proposed: false }, now), 'stopped'); // quiet mid-turn
  assert.equal(sessionState({ ended: false, line: t(90), act: t(40), proposed: true }, now), 'waiting');
});

test('bridge: the product\'s sessions in the window, each with its state, its change and feature path, the decision that waits or the next', () => {
  const b = bridge(store, loadStore(store), { product: 'product:shop' });
  assert.equal(b.product, 'product:shop');
  const by = Object.fromEntries(b.sessions.map((s) => [s.key, s]));
  assert.deepEqual(Object.keys(by).sort(), ['session:s-end', 'session:s-fresh', 'session:s-stop', 'session:s-wait', 'session:s-work']);
  assert.equal(by['session:s-wait'].state, 'waiting');
  assert.equal(by['session:s-wait'].decision?.key, 'decision:shop/card-form/later'); // the oldest proposed, by key on the same day
  assert.equal(by['session:s-wait'].change?.key, 'change:shop/card-form');
  assert.deepEqual(by['session:s-wait'].change?.path, [
    { key: 'feature:shop/checkout', name: 'Checkout' },
    { key: 'feature:shop/saved-cards', name: 'Saved cards' },
  ]);
  assert.equal(by['session:s-wait'].line?.text, 'Opened a decision; it is yours.');
  assert.equal(by['session:s-work'].state, 'working');
  assert.equal(by['session:s-work'].decision, undefined);
  assert.equal(by['session:s-stop'].state, 'stopped');
  assert.equal(by['session:s-stop'].change?.next, '1. Review it.');
  assert.deepEqual(by['session:s-stop'].change?.path, []);
  assert.equal(by['session:s-end'].state, 'ended');
  assert.equal(by['session:s-end'].inReview, true);
  assert.equal(by['session:s-end'].line?.text, 'Shipped it; left for review.'); // the closing line is the reason, not the line
  assert.equal(by['session:s-end'].ended?.reason, 'prompt_input_exit');
  assert.equal(by['session:s-work'].ended, undefined);
  assert.equal(by['session:s-kid'], undefined); // a subagent's session is no row of its own
  assert.deepEqual(by['session:s-work'].children.map((c) => [c.key, c.state, c.line?.text]), [['session:s-kid', 'stopped', 'Built the thing.']]);
  assert.equal(by['session:s-fresh'].state, 'stopped');
  assert.equal(by['session:s-fresh'].change, undefined);
  assert.equal(b.waiting, 2); // decisions, not sessions
  assert.deepEqual(b.waitingOn.map((w) => [w.change.key, w.proposed.map((d) => d.key)]), [
    ['change:shop/card-form', ['decision:shop/card-form/why', 'decision:shop/card-form/later']], // newest proposed first
  ]);
  assert.deepEqual(b.waitingOn[0].change.path.map((f) => f.name), ['Checkout', 'Saved cards']);
  assert.equal(b.waitingOn[0].proposed[0].recommended?.text, 'd');
  // most recent first
  const lasts = b.sessions.map((s) => s.last ?? '');
  assert.deepEqual(lasts, [...lasts].sort().reverse());
});

test('bridge: another product sees none of them; a window that has passed sees none either', () => {
  const other = bridge(store, loadStore(store), { product: 'product:other' });
  assert.equal(other.sessions.length, 0);
  assert.equal(other.waiting, 0);
  assert.equal(bridge(store, loadStore(store), { now: Date.now() + 3 * 24 * 60 * 60_000 }).sessions.length, 0);
  assert.equal(bridge(store, loadStore(store), { now: Date.now() + 3 * 24 * 60 * 60_000, days: 7 }).sessions.length, 5); // the subagent's is under its parent
});

test('timeline: the product\'s events in the window, decisions marked, titles as they read now, the store\'s last event beside them', () => {
  newRecord(store, 'product', 'other', { title: 'Other', owners: ['person:tester'], summary: 'Another.' });
  const t = timeline(store, loadStore(store), { product: 'product:shop' });
  assert.equal(t.product, 'product:shop');
  const keys = new Set(t.events.map((e) => e.key));
  for (const k of ['product:shop', 'feature:shop/checkout', 'change:shop/card-form', 'decision:shop/card-form/why', 'session:s-wait', 'session:s-fresh'])
    assert.ok(keys.has(k), `${k} is the product's`);
  assert.ok(!keys.has('product:other'), 'another product\'s write is not');
  const opened = t.events.find((e) => e.key === 'decision:shop/card-form/why' && e.op === 'created')!;
  assert.equal(opened.decision, true);
  assert.equal(opened.status, 'proposed', 'opened, read from its commit');
  assert.equal(opened.title, 'Why');
  assert.equal(t.events.find((e) => e.key === 'session:s-wait' && e.op === 'bind')!.title, 'Card form', 'a session reads by its change');
  assert.ok(t.events.every((e) => e.key.startsWith('decision:') || !e.decision));
  assert.deepEqual(t.events.map((e) => e.seq), [...t.events.map((e) => e.seq)].sort((a, b) => a - b), 'in stream order');
  assert.equal(t.last?.seq, Math.max(...t.events.map((e) => e.seq)) + 1, 'the other product\'s write is the store\'s last');
  assert.equal(timeline(store, loadStore(store), { product: 'product:shop', to: '2000-01-01T00:00:00Z' }).events.length, 0);
  // the count after a moment reaches now whatever the window
  const third = t.events[2].seq;
  const early = timeline(store, loadStore(store), { product: 'product:shop', to: '2000-01-01T00:00:00Z', after: third });
  assert.equal(early.arrivedAfter, t.events.filter((e) => e.seq > third).length);
});

test('timeline: a decision tick carries the status its write left, and every decision event the status now', () => {
  accept(store, 'decision:shop/card-form/later', 'person:tester', '2026-10-28');
  const t = timeline(store, loadStore(store), { product: 'product:shop' });
  const of = (op: string) => t.events.find((e) => e.key === 'decision:shop/card-form/later' && e.op === op)!;
  assert.equal(of('created').status, 'proposed');
  assert.equal(of('set').status, 'decided');
  assert.equal(of('created').statusNow, 'decided', 'opened then, decided now');
});
