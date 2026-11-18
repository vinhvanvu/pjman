// The review loop (change:review-loop): how a project's changes are reviewed is a line on its record; a finding says
// whether it holds the merge; a change reaching review in a project that reviews every change does not rest until one
// full review and one re-review of the fix have been made; what does not hold the merge goes to one follow-up change.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { init } from '../cli/init.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findingsLine, findingsOf, formatFinding } from '../model/findings.js';
import { formatRest, heldByReview, restOf } from '../model/rest.js';
import { lensesAsked, reviewMode, roundsOf } from '../model/review.js';
import { stepsOf } from '../model/foundation.js';
import { validate } from '../model/validate.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { mergeChange } from '../sync/merge.js';
import {
  addFinding,
  closeRound,
  followUp,
  formatLoop,
  handLens,
  lensBrief,
  reviewBrief,
  reviewLoop,
  settleFinding,
} from '../sync/review.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-review-loop-')));
const dir = path.join(tmp, 'web');
let store: Store;
const KEY = 'change:web/cart';

const g = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
const data = (key = KEY) => loadStore(store).byKey.get(key)![0].data;
const findings = () => findingsOf(data());
const rest = () => {
  const loaded = loadStore(store);
  return heldByReview(restOf(loaded, KEY), reviewLoop(store, KEY));
};
/** Three reviewers were handed their lenses. */
const handed = (key = KEY) => {
  for (const lens of ['intent', 'drift', 'correctness']) handLens(store, key, lens);
};
const commit = (file: string, text: string, message: string) => {
  g('switch', '-q', 'cart');
  fs.writeFileSync(path.join(dir, file), text);
  g('add', '-A');
  g('commit', '-q', '-m', message);
  g('switch', '-q', 'main');
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'start');
  g('branch', 'cart');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  commit('cart.ts', 'export const total = (items) => items.length;\n', 'feat: the cart totals (change:cart)');
  change(store, 'cart', {
    name: 'Cart',
    gist: 'The cart totals what a shopper picked',
    intent: 'A shopper sees what they owe.',
    doneWhen: 'The total is the sum of the prices, discounts applied.',
    project: 'project:web',
    next: 'build it',
  });
});

test('how a project is reviewed is a line on its record: on request by default, and only one of the three', () => {
  assert.equal(reviewMode(loadStore(store), 'project:web'), 'request');
  assert.throws(() => set(store, 'project:web', ['ext.review.mode=sometimes'], {}), /not one of off, request, auto/);
  set(store, 'project:web', ['ext.review.mode=off'], {});
  assert.equal(reviewMode(loadStore(store), 'project:web'), 'off');
  // off: no brief, no finding, no round; the line that turns it on is named
  assert.throws(() => reviewBrief(store, KEY), /has review off .*ext\.review\.mode=request/);
  assert.throws(() => addFinding(store, KEY, { text: 'x' }), /has review off/);
  assert.throws(() => closeRound(store, KEY), /has review off/);
  assert.equal(reviewLoop(store, KEY).due, false);
  assert.match(formatChangeContext(changeContext(store, KEY)), /\nreview: off for this project\n/);
  set(store, 'project:web', ['ext.review.mode=request'], {});
  assert.doesNotMatch(formatChangeContext(changeContext(store, KEY)), /\nreview: /);
});

test('on request a change in review rests; in a project that reviews every change it does not, until reviewed', () => {
  step(store, KEY, 'done', 1, {});
  assert.equal(data().status, 'review');
  assert.equal(rest().rests, true);
  const asked = reviewLoop(store, KEY);
  assert.deepEqual([asked.mode, asked.state, asked.due], ['request', 'due', false]);
  set(store, 'project:web', ['ext.review.mode=auto'], {});
  const r = rest();
  assert.equal(r.rests, false);
  assert.equal(r.review?.state, 'due');
  // what moves it on: reviewers that did not write it, one per lens, then the round closed
  assert.match(r.review.next, /does not review it/);
  assert.match(r.review.next, /3 fresh agents .*--lens <intent\|drift\|correctness>/);
  assert.match(r.review.next, /pjman review change:web\/cart --reviewed/);
  assert.match(formatRest(r), /does not rest: the full review is due\n/);
  assert.match(formatChangeContext(changeContext(store, KEY)), /\nreview: auto \(reviewed without being asked/);
});

test('a reviewer is handed the brief and one question; the fix has none to read before a full review', () => {
  const intent = lensBrief(store, KEY, 'intent');
  assert.match(intent, /^You review this change as someone who did not write it/);
  assert.match(intent, /clause by clause[\s\S]*--kind intent[\s\S]*## Done when\n\nThe total is the sum/);
  assert.match(lensBrief(store, KEY, 'drift'), /turned down[\s\S]*--kind drift/);
  assert.match(lensBrief(store, KEY, 'correctness'), /--kind correctness/);
  assert.throws(() => lensBrief(store, KEY, 'taste'), /not one of intent, drift, correctness, fix/);
  assert.throws(() => lensBrief(store, KEY, 'fix'), /has had no full review/);
  // a round is closed only once a reviewer was handed each lens: the handout is on the record
  assert.throws(() => closeRound(store, KEY), /no reviewer was handed --lens intent, --lens drift, --lens correctness/);
  assert.equal(handLens(store, KEY, 'intent'), intent);
  handLens(store, KEY, 'intent');
  assert.deepEqual(
    lensesAsked(data()).map((a) => a.lens),
    ['intent'],
  );
  assert.throws(() => closeRound(store, KEY), /no reviewer was handed --lens drift, --lens correctness\./);
  assert.throws(() => handLens(store, KEY, 'fix'), /has had no full review/);
  handLens(store, KEY, 'drift');
  handLens(store, KEY, 'correctness');
});

test('a finding says whether it holds the merge: high severity, or the done-when not met', () => {
  addFinding(store, KEY, {
    text: 'The total counts items',
    severity: 'high',
    kind: 'correctness',
    file: 'cart.ts',
    line: 1,
  });
  addFinding(store, KEY, { text: 'Discounts are not applied', kind: 'intent' });
  addFinding(store, KEY, { text: 'The export is not typed', kind: 'drift' });
  addFinding(store, KEY, { text: 'A name could be clearer', severity: 'low' });
  assert.throws(() => addFinding(store, KEY, { text: 'x', kind: 'taste' }), /--kind taste is not one of/);
  const got = findings();
  assert.equal(
    formatFinding(1, got[0]),
    '1. [open, holds the merge] high correctness cart.ts:1 — The total counts items',
  );
  assert.equal(formatFinding(2, got[1]), '2. [open, holds the merge] medium intent — Discounts are not applied');
  assert.equal(formatFinding(3, got[2]), '3. [open] medium drift — The export is not typed');
  assert.equal(findingsLine(got), '4 open findings (2 hold the merge)');
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error'),
    [],
  );
});

test('the full review is closed once; what holds the merge is fixed before the fix is re-reviewed', () => {
  const head = g('rev-parse', '--short', 'cart').trim();
  const r = closeRound(store, KEY);
  assert.equal(r.round?.round, 'full');
  assert.equal(r.round?.head, head);
  assert.deepEqual([r.loop.state, r.loop.holding, r.loop.left], ['fixing', [1, 2], [3, 4]]);
  assert.deepEqual(r.moved, []);
  assert.match(
    r.loop.next!,
    /Fix what holds the merge[\s\S]*1\. \[open, holds the merge\] high[\s\S]*2\. \[open, holds/,
  );
  assert.equal(rest().rests, false);
  assert.throws(
    () => closeRound(store, KEY),
    /2 findings hold the merge; the fix is re-reviewed once they are settled/,
  );
  // the merge is held, with or without Entire
  assert.throws(() => handLens(store, KEY, 'fix'), /2 findings hold the merge; the fix is re-reviewed once/);
  assert.throws(() => handLens(store, KEY, 'intent'), /has had its full review/);
  assert.throws(() => mergeChange(store, KEY), /not merged: 2 findings hold the merge[\s\S]*--resolve <n>/);
  assert.match(formatChangeContext(changeContext(store, KEY)), /\nreview: auto · 2 findings hold the merge\n/);
});

test('the fix is re-reviewed once and alone; then the review has ended, and says why', () => {
  commit('cart.ts', 'export const total = (items) => items.reduce((a, b) => a + b.price, 0);\n', 'fix: sum the prices');
  settleFinding(store, KEY, 1, 'resolved', 'sums the prices');
  assert.equal(reviewLoop(store, KEY).state, 'fixing');
  settleFinding(store, KEY, 2, 'dismissed', 'discounts are another change');
  const due = reviewLoop(store, KEY);
  assert.equal(due.state, 'recheck');
  assert.match(due.next!, /one fresh agent .*--lens fix/);
  const full = roundsOf(data())[0];
  const fix = lensBrief(store, KEY, 'fix');
  assert.match(fix, new RegExp(`Read only what changed since that review: git diff ${full.head}\\.\\.cart`));
  assert.match(
    fix,
    /## Fixed since the full review\n\n1\. \[resolved\] high correctness cart\.ts:1 — The total counts items \(sums the prices\)\n/,
  );
  assert.doesNotMatch(fix.split('## Fixed since the full review')[1].split('# Review')[0], /Discounts/);
  // a finding that comes in late, before the fix is handed to its reviewer, is still to be fixed
  addFinding(store, KEY, { text: 'An empty cart throws', severity: 'high' });
  assert.equal(reviewLoop(store, KEY).state, 'fixing');
  settleFinding(store, KEY, 5, 'dismissed', 'it does not: reduce has a start value');
  assert.equal(reviewLoop(store, KEY).state, 'recheck');
  // in a project that reviews every change, the fix is re-reviewed before the merge
  assert.throws(() => closeRound(store, KEY), /no reviewer was handed --lens fix\. The fix is re-reviewed/);
  assert.throws(
    () => mergeChange(store, KEY),
    /not merged: change:web\/cart review \(auto\): the re-review of the fix is due/,
  );
  assert.match(handLens(store, KEY, 'fix'), /^You review this change[\s\S]*## Fixed since the full review/);
  // the re-reviewer finds the fix lacking in one small way: it does not hold the merge
  addFinding(store, KEY, { text: 'The sum is not rounded', kind: 'correctness' });
  const r = closeRound(store, KEY);
  assert.equal(r.round?.round, 'fix');
  assert.equal(r.loop.state, 'ended');
  assert.equal(r.loop.words, 'ended: the fixes were re-reviewed and nothing holds the merge');
  assert.equal(r.loop.next, undefined);
  // what does not hold the merge went to one follow-up change, a step each, and stays on the change as deferred
  assert.deepEqual(r.moved, [3, 4, 6]);
  assert.equal(r.followUp, 'change:web/cart-follow-ups');
  const follow = data('change:web/cart-follow-ups');
  assert.equal(follow.name, 'Cart follow-ups');
  assert.deepEqual(
    stepsOf(follow).map((s) => s.text),
    ['The export is not typed', 'A name could be clearer', 'The sum is not rounded'],
  );
  assert.deepEqual(
    findings().map((f) => f.state),
    ['resolved', 'dismissed', 'deferred', 'deferred', 'dismissed', 'deferred'],
  );
  assert.equal(findings()[2].note, 'moved to change:web/cart-follow-ups');
  assert.equal(rest().rests, true);
  assert.match(formatLoop(reviewLoop(store, KEY)), /review \(auto\): ended: the fixes were re-reviewed/);
  // a change is reviewed once and its fix once
  assert.throws(() => closeRound(store, KEY), /the review has ended: .*reviewed once and its fix once/);
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error'),
    [],
  );
  assert.equal(mergeChange(store, KEY).by, 'local');
});

test('a finding that still holds after the re-review ends the loop as the person’s to settle; later ones join the follow-up', () => {
  g('branch', 'tax', 'main');
  g('switch', '-q', 'tax');
  fs.writeFileSync(path.join(dir, 'tax.ts'), 'export const tax = 0;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: tax (change:tax)');
  g('switch', '-q', 'main');
  change(store, 'tax', { name: 'Tax', gist: 'Tax on the total', project: 'project:web', next: 'build it' });
  const T = 'change:web/tax';
  step(store, T, 'done', 1, {});
  handed(T);
  addFinding(store, T, { text: 'Tax is always zero', severity: 'high' });
  // fixed and resolved before the round is closed: the fix is re-reviewed all the same
  settleFinding(store, T, 1, 'resolved', 'reads the rate');
  assert.equal(closeRound(store, T).loop.state, 'recheck');
  assert.match(lensBrief(store, T, 'fix'), /Read only what changed since that review: git diff main\.\.\.tax/);
  handLens(store, T, 'fix');
  // the re-review finds it is not fixed, and that the fix broke something: neither sends the loop back to fixing
  settleFinding(store, T, 1, 'open', 'the rate is read from the wrong table');
  assert.equal(reviewLoop(store, T).state, 'recheck');
  addFinding(store, T, { text: 'A missing rate throws', severity: 'high' });
  assert.equal(reviewLoop(store, T).state, 'recheck');
  const r = closeRound(store, T);
  assert.equal(r.round?.round, 'fix');
  assert.equal(r.loop.state, 'ended');
  assert.match(
    r.loop.words!,
    /2 findings still hold the merge after the one re-review: they are the person's to settle/,
  );
  // the loop has ended, so the change rests; the merge is still held
  const loaded = loadStore(store);
  assert.equal(heldByReview(restOf(loaded, T), reviewLoop(store, T)).rests, true);
  assert.throws(() => mergeChange(store, T), /2 findings hold the merge/);
  // fixed again, it is settled, and no third round is taken
  settleFinding(store, T, 1, 'resolved', 'reads the right table');
  assert.equal(reviewLoop(store, T).state, 'ended');
  assert.throws(() => closeRound(store, T), /reviewed once and its fix once/);
  // a finding filed after the end is moved when asked
  addFinding(store, T, { text: 'A comment is stale', severity: 'low' });
  assert.equal(reviewLoop(store, T).state, 'closing');
  const moved = followUp(store, T);
  assert.deepEqual(moved.moved, [3]);
  assert.equal(moved.loop.state, 'ended');
  assert.deepEqual(followUp(store, T).moved, []);
});

test('a full review that finds nothing holding the merge ends there', () => {
  g('branch', 'ship', 'main');
  g('switch', '-q', 'ship');
  fs.writeFileSync(path.join(dir, 'ship.ts'), 'export const ship = 1;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: shipping (change:ship)');
  g('switch', '-q', 'main');
  change(store, 'ship', { name: 'Shipping', gist: 'Shipping cost', project: 'project:web', next: 'build it' });
  const S = 'change:web/ship';
  // not in review yet, or with no work on a branch: nothing is due
  assert.equal(reviewLoop(store, S).state, 'none');
  assert.throws(() => closeRound(store, S), /is not up for review: a round is closed once its plan has run to its end/);
  assert.throws(() => handLens(store, S, 'intent'), /is not up for review: a lens is handed out once/);
  step(store, S, 'done', 1, {});
  assert.equal(reviewLoop(store, S).due, true);
  // a project that reviews every change merges none unreviewed, hook or no hook
  assert.throws(() => mergeChange(store, S), /not merged: change:web\/ship review \(auto\): the full review is due\n/);
  // what waits on a person is a resting point in review as anywhere
  const held = () => heldByReview(restOf(loadStore(store), S), reviewLoop(store, S));
  assert.equal(held().rests, false);
  set(store, S, ['blocked-on=the carrier price list'], {});
  assert.equal(held().rests, true);
  set(store, S, ['blocked-on='], {});
  handed(S);
  const r = closeRound(store, S);
  assert.deepEqual([r.round?.round, r.loop.state, r.loop.due], ['full', 'ended', false]);
  assert.equal(r.loop.words, 'ended: one full review left nothing that holds the merge');
  // a change with no branch has nothing to review, whatever the project says
  change(store, 'notes', { name: 'Notes', gist: 'A record only', project: 'project:web', next: 'write it' });
  step(store, 'change:web/notes', 'done', 1, {});
  assert.equal(reviewLoop(store, 'change:web/notes').due, false);
});

test('on request nothing moves unasked, and what held the merge and was dismissed is said as that', () => {
  set(store, 'project:web', ['ext.review.mode=request'], {});
  g('branch', 'gift', 'main');
  g('switch', '-q', 'gift');
  fs.writeFileSync(path.join(dir, 'gift.ts'), 'export const gift = 1;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: gift wrap (change:gift)');
  g('switch', '-q', 'main');
  change(store, 'gift', { name: 'Gift wrap', gist: 'Wrap it', project: 'project:web', next: 'build it' });
  const G = 'change:web/gift';
  step(store, G, 'done', 1, {});
  handed(G);
  addFinding(store, G, { text: 'The wrap has no price', kind: 'intent' });
  addFinding(store, G, { text: 'A name could be clearer', severity: 'low' });
  assert.equal(closeRound(store, G).loop.state, 'fixing');
  settleFinding(store, G, 1, 'dismissed', 'the price is another change');
  const loop = reviewLoop(store, G);
  assert.deepEqual([loop.state, loop.due], ['closing', false]);
  assert.equal(
    loop.words,
    'ended: what held the merge was dismissed, the reason on each, so there is no fix to re-review',
  );
  assert.match(loop.next!, /pjman review change:web\/gift --follow-up/);
  assert.equal(findingsOf(data(G))[1].state, 'open');
  // on request the merge is the person's call: only a finding that holds it is in the way
  assert.equal(mergeChange(store, G).by, 'local');
});

test('three reviewers started together are each handed their lens, and each handout is on the record', async () => {
  set(store, 'project:web', ['ext.review.mode=auto'], {});
  g('branch', 'coupon', 'main');
  g('switch', '-q', 'coupon');
  fs.writeFileSync(path.join(dir, 'coupon.ts'), 'export const coupon = 1;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: coupons (change:coupon)');
  g('switch', '-q', 'main');
  change(store, 'coupon', { name: 'Coupons', gist: 'A coupon', project: 'project:web', next: 'build it' });
  const C = 'change:web/coupon';
  step(store, C, 'done', 1, {});
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pjman.js');
  const run = promisify(execFile);
  const briefs = await Promise.all(
    ['intent', 'drift', 'correctness'].map((lens) =>
      run(process.execPath, [bin, 'review', 'change:coupon', '--lens', lens], { cwd: dir, env: process.env }),
    ),
  );
  for (const b of briefs) assert.match(b.stdout, /^You review this change as someone who did not write it/);
  assert.deepEqual(
    lensesAsked(data(C))
      .map((a) => a.lens)
      .toSorted(),
    ['correctness', 'drift', 'intent'],
  );
  assert.equal(closeRound(store, C).loop.state, 'ended');
});

test('a change worked on again after its review ended is due again, and each pass keeps the stop rule', () => {
  set(store, 'project:web', ['ext.review.mode=auto'], {});
  const S = 'change:web/ship';
  const first = reviewLoop(store, S);
  assert.deepEqual([first.state, first.rounds.length], ['ended', 1]);
  // a step added: the plan is being worked, and nothing is due while it is
  step(store, S, 'add', undefined, { text: 'ship abroad' });
  assert.equal(reviewLoop(store, S).state, 'ended', 'no commit yet: the branch is where the round left it');
  g('switch', '-q', 'ship');
  fs.writeFileSync(path.join(dir, 'ship.ts'), 'export const ship = 2;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: ship abroad (change:ship)');
  g('switch', '-q', 'main');
  assert.equal(reviewLoop(store, S).state, 'none', 'the plan is not at its end');
  // run to its end again, with commits the round did not see: the full review is due again
  step(store, S, 'done', 2, {});
  const again = reviewLoop(store, S);
  assert.deepEqual([again.state, again.due, again.rounds.length], ['due', true, 0]);
  assert.equal(again.words, 'the full review is due again: the change was worked on after its review ended');
  assert.throws(() => mergeChange(store, S), /not merged: .*the full review is due again/);
  assert.equal(heldByReview(restOf(loadStore(store), S), again).rests, false);
  // the lenses of the first pass do not count for this one
  assert.throws(() => closeRound(store, S), /no reviewer was handed --lens intent, --lens drift, --lens correctness/);
  handed(S);
  addFinding(store, S, { text: 'Abroad has no rate', severity: 'high' });
  const full = closeRound(store, S);
  assert.deepEqual([full.round?.round, full.round?.pass, full.loop.state], ['full', 2, 'fixing']);
  // one re-review of the fix, then it has ended: no third round within the pass
  settleFinding(store, S, 1, 'resolved', 'a rate for abroad');
  handLens(store, S, 'fix');
  const fix = closeRound(store, S);
  assert.deepEqual([fix.round?.round, fix.round?.pass, fix.loop.state], ['fix', 2, 'ended']);
  assert.throws(() => closeRound(store, S), /reviewed once and its fix once/);
  assert.deepEqual(
    roundsOf(data(S)).map((r) => `${r.round} ${r.pass ?? 1}`),
    ['full 1', 'full 2', 'fix 2'],
  );
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error'),
    [],
  );
});
