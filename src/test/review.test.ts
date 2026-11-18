// pjman review is pjman's own review (change:pjman-review): the brief a reviewer judges a change's branch by, findings
// kept as data on the change, and, in a project that opted in to Entire, each finding filed onto the change's Trail
// and settled there when it is settled here. With no Entire the review is local.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { decision } from '../ops/decision.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findingsOf } from '../model/findings.js';
import { validate } from '../model/validate.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { syncEntire } from '../sync/entire.js';
import { addFinding, formatReviewBrief, readFindings, reviewBrief, runReview, settleFinding } from '../sync/review.js';
import { reconcileTrail } from '../sync/trail.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-review-')));
const dir = path.join(tmp, 'web');
const stateFile = path.join(tmp, 'state.json');
const callsFile = path.join(tmp, 'calls.jsonl');
let store: Store;
let bin: string;

const g = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
const calls = (): string[][] =>
  fs.existsSync(callsFile)
    ? fs
        .readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
    : [];
const findings = () => findingsOf(loadStore(store).byKey.get('change:web/cart')![0].data);
const onEntire = (): { id: string; body: string; severity: string; file?: string; line?: string; status: string }[] =>
  (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { findings: never[] }).findings;

/** The fake: one Trail per branch, and its findings. `ENTIRE_DOWN=1` makes every finding write fail. */
function fake(): string {
  const file = path.join(tmp, 'entire');
  fs.writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
const state = fs.existsSync(${JSON.stringify(stateFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')) : { trail: null, findings: [] };
const save = () => fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const fail = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const show = () => ({ id: '01T', number: 1, url: 'https://entire.com/gh/acme/-/trails/1', status: state.trail.status, phase: 'building',
  changes: [{ repository: 'web', number: 1, branch: state.trail.branch, status: fs.existsSync(${JSON.stringify(path.join(tmp, 'merged'))}) ? 'merged' : 'open', mergeability: { mergeable: true, gates: [] } }] });
if (args[0] === 'review') {
  if (args.includes('--list')) console.log(fs.existsSync(${JSON.stringify(path.join(tmp, 'profile'))}) ? 'Profiles:\\n  general  (default)\\n    output:     trail' : 'No review profiles configured. Create one with entire review --configure.');
  else { state.findings.push({ id: 'R' + (state.findings.length + 1), body: '[intent] the total ignores discounts, which the done-when asks for', severity: 'high', file: 'cart.ts', line: '1', status: 'open' }); save(); console.log('Review complete.'); }
}
else if (args[1] === 'show') { if (!state.trail) fail('branch "x" has no discoverable project trail'); console.log(JSON.stringify(show())); }
else if (args[1] === 'create') { state.trail = { branch: flag('--branch'), status: 'open' }; save(); console.log(JSON.stringify(show())); }
else if (args[1] === 'update') { if (flag('--status')) state.trail.status = flag('--status'); save(); console.log(JSON.stringify(show())); }
else if (args[1] === 'ready') console.log('Marked ready');
else if (args[1] === 'finding') {
  if (args[2] === 'list') { const open = state.findings.filter((f) => f.status === 'open').length; console.log(JSON.stringify({ counts: { Open: open, OpenHigh: 0, OpenMedium: open, OpenLow: 0 }, findings: state.findings.map((f) => ({ id: f.id, body: f.body, severity: f.severity, status: f.status, location: f.file ? { filePath: f.file, startLine: f.line ? Number(f.line) : null } : {} })) })); }
  else if (fs.existsSync(${JSON.stringify(path.join(tmp, 'down'))})) fail('the server did not answer (503)');
  else if (args[2] === 'add') {
    const known = state.findings.find((f) => f.clientId === flag('--client-id'));
    const f = known || { id: 'F' + (state.findings.length + 1), body: flag('--body'), severity: flag('--severity'), file: flag('--file'), line: flag('--line'), clientId: flag('--client-id'), status: 'open' };
    if (!known) state.findings.push(f); save(); console.log(JSON.stringify({ id: f.id, status: f.status }));
  } else {
    const id = args.slice(3).find((a, i, all) => !a.startsWith('-') && !['--branch', '-m'].includes(all[i - 1]));
    const f = state.findings.find((x) => x.id === id); if (!f) fail('no finding ' + id);
    f.status = { resolve: 'resolved', dismiss: 'dismissed', reopen: 'open' }[args[2]]; f.reason = flag('-m'); save();
    console.log('Updated finding ' + id);
  }
} else fail('unknown');
`,
    { mode: 0o755 },
  );
  return file;
}

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'start');
  g('switch', '-q', '-c', 'cart');
  fs.writeFileSync(path.join(dir, 'cart.ts'), 'export const total = (items) => items.length;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: the cart totals (change:cart)');
  g('switch', '-q', 'main');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  set(store, 'project:web', ['ext.github.repo=acme/web'], {});
  bin = fake();
  change(store, 'cart', {
    name: 'Cart',
    gist: 'The cart totals what a shopper picked',
    intent: 'A shopper sees what they owe.',
    doneWhen: 'The total is the sum of the prices, discounts applied.',
    project: 'project:web',
    next: 'build it',
  });
  decision(store, 'cart/rounding', {
    name: 'Rounding',
    gist: 'How the total rounds',
    entries: [
      { type: 'question', text: 'How does the total round?' },
      { type: 'option', id: 'half-even', text: 'Half to even, per line' },
      { type: 'option', id: 'floor', text: 'Always down' },
      { type: 'accept', option: 'half-even', by: 'person:tester' },
    ],
  });
  step(store, 'change:cart', 'start', 1, {});
});

test('the brief is what a reviewer judges by: the done-when, the decisions with what was turned down, and the branch', () => {
  const b = reviewBrief(store, 'change:web/cart');
  assert.equal(b.doneWhen, 'The total is the sum of the prices, discounts applied.');
  assert.deepEqual(
    b.decisions.map((d) => [d.accepted, d.rejected]),
    [['half-even: Half to even, per line', ['floor: Always down']]],
  );
  assert.equal(b.branch, 'cart');
  assert.equal(b.diff, 'git diff main...cart');
  assert.equal(b.commits.length, 1);
  assert.match(b.files.join('\n'), /cart\.ts/);
  assert.equal(b.entire, false);
  const text = formatReviewBrief(b);
  assert.match(text, /^# Review change:web\/cart — Cart\n/);
  assert.match(text, /## Done when\n\nThe total is the sum/);
  assert.match(text, /- accepted half-even: Half to even, per line\n- turned down floor: Always down/);
  assert.match(text, /pjman review change:web\/cart --finding/);
  assert.doesNotMatch(text, /Entire/, 'a local review says nothing of Entire');
});

test('with no Entire the review is local: findings are data on the change, settled by number', () => {
  const r = addFinding(
    store,
    'change:web/cart',
    {
      text: 'The total counts items; the done-when says the sum of the prices',
      severity: 'high',
      file: 'cart.ts',
      line: 1,
    },
    { entire: { bin } },
  );
  assert.equal(r.n, 1);
  assert.deepEqual([r.filed, r.pending], [[], []]);
  assert.deepEqual(calls(), [], 'nothing of Entire ran');
  addFinding(store, 'change:web/cart', { text: 'No test covers a discount' }, { entire: { bin } });
  assert.deepEqual(
    findings().map((f) => [f.severity, f.state, f.file, f.line]),
    [
      ['high', 'open', 'cart.ts', 1],
      ['medium', 'open', undefined, undefined],
    ],
  );
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error'),
    [],
  );
  assert.match(
    formatChangeContext(changeContext(store, 'change:web/cart')),
    /## Findings \(2 open findings \(1 high\)\)\n\n1\. \[open\] high cart\.ts:1 — The total counts items.*\n2\. \[open\] medium — No test covers a discount/,
  );
  assert.throws(() => settleFinding(store, 'change:web/cart', 2, 'dismissed', undefined), /says why it does not hold/);
  assert.throws(() => settleFinding(store, 'change:web/cart', 9, 'resolved', undefined), /has no finding 9 \(1 to 2\)/);
  assert.throws(
    () => addFinding(store, 'change:web/cart', { text: 'x y', severity: 'urgent' }),
    /not one of high, medium, low/,
  );
  assert.throws(() => addFinding(store, 'change:web/cart', { text: 'x y', line: 3 }), /--line names a line of a file/);
});

test('opted in, each finding is filed onto the Trail, and settling one here settles it there', () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  // no Trail yet: said as pending, nothing lost
  const early = settleFinding(store, 'change:web/cart', 2, 'dismissed', 'covered by the pricing suite', {
    entire: { bin },
  });
  assert.deepEqual(early.pending, ['change:web/cart has no Trail yet: its findings are filed once it has one']);
  reconcileTrail(store, 'change:web/cart', { entire: { bin } });
  // the sync files what waits: the open one; the dismissed one was never on Entire and stays off it
  const s = syncEntire(store, { entire: { bin } });
  assert.deepEqual(s.pending, []);
  assert.deepEqual(
    onEntire().map((f) => [f.id, f.severity, f.file, f.line, f.status]),
    [['F1', 'high', 'cart.ts', '1', 'open']],
  );
  assert.deepEqual(
    findings().map((f) => [f.entire, f.filed]),
    [
      ['F1', 'open'],
      [undefined, undefined],
    ],
  );
  const add = calls().find((c) => c[2] === 'add')!;
  // by the finding's own id, which stays its own whatever lands before it: a retry files nothing twice
  assert.match(findings()[0].id!, /^[0-9a-f]{8}$/);
  assert.equal(add[add.indexOf('--client-id') + 1], `pjman:web/cart#${findings()[0].id}`);
  assert.match(
    formatReviewBrief(reviewBrief(store, 'change:web/cart')),
    /also filed onto the change's Trail on Entire/,
  );

  const r = settleFinding(store, 'change:web/cart', 1, 'resolved', 'sums the prices now', { entire: { bin } });
  assert.deepEqual(r.filed, ['resolved #1']);
  assert.equal(onEntire()[0].status, 'resolved');
  assert.equal(findings()[0].filed, 'resolved');
  const third = addFinding(
    store,
    'change:web/cart',
    { text: 'Rounds down; the decision says half to even', severity: 'low' },
    { entire: { bin } },
  );
  assert.deepEqual(third.filed, ['filed #3']);
  assert.equal(onEntire().length, 2);
});

test('when Entire does not answer the finding stands on the change, pending, and the next sync files it', () => {
  fs.writeFileSync(path.join(tmp, 'down'), '');
  const r = addFinding(store, 'change:web/cart', { text: 'An empty cart throws' }, { entire: { bin } });
  assert.equal(r.n, 4);
  assert.match(r.pending[0], /^entire trail finding add .* failed: the server did not answer \(503\)$/);
  assert.equal(findings()[3].entire, undefined);
  assert.equal(onEntire().length, 2);
  fs.rmSync(path.join(tmp, 'down'));
  syncEntire(store, { entire: { bin } });
  assert.equal(findings()[3].entire, 'F3');
  assert.equal(onEntire().length, 3);
});

test("opted in, the review is handed to Entire's own with the brief, and what it posts on the Trail is read onto the change", () => {
  fs.rmSync(path.join(tmp, 'down'), { force: true });
  // no profile: nothing runs, and the command that is the person's is named
  const none = runReview(store, 'change:web/cart', { entire: { bin } });
  assert.equal(none.ran, false);
  assert.match(none.pending[0], /no review profile .*entire review --configure/);
  assert.ok(!calls().some((c) => c[0] === 'review' && c.includes('--prompt')));
  fs.writeFileSync(path.join(tmp, 'profile'), '');
  const held = findings().length;
  const r = runReview(store, 'change:web/cart', { entire: { bin } });
  assert.equal(r.ran, true);
  assert.deepEqual(r.pending, []);
  const run = calls().find((c) => c[0] === 'review' && c.includes('--prompt'))!;
  assert.match(run[run.indexOf('--prompt') + 1], /Done when[\s\S]*discounts applied/);
  assert.equal(run[run.indexOf('--base') + 1], 'main');
  const got = findings();
  assert.equal(got.length, held + 1);
  assert.deepEqual(
    { ...got.at(-1), at: undefined },
    {
      id: got.at(-1)!.id,
      text: '[intent] the total ignores discounts, which the done-when asks for',
      severity: 'high',
      state: 'open',
      file: 'cart.ts',
      line: 1,
      by: 'entire',
      at: undefined,
      entire: got.at(-1)!.entire,
      filed: 'open',
    },
  );
  // read again: nothing new, nothing written; settled on Entire, it is settled here
  assert.equal(readFindings(store, 'change:web/cart', { entire: { bin } }).commit, null);
  execFileSync(bin, ['trail', 'finding', 'resolve', '--branch', 'cart', got.at(-1)!.entire!, '-m', 'fixed']);
  const back = readFindings(store, 'change:web/cart', { entire: { bin } });
  assert.deepEqual(back.read, [`resolved #${got.length}`]);
  assert.equal(findings().at(-1)!.state, 'resolved');
});

test('settling a finding again after Entire did not answer tells Entire then', () => {
  fs.writeFileSync(path.join(tmp, 'down'), '');
  const first = settleFinding(store, 'change:web/cart', 3, 'resolved', 'rounds half to even now', { entire: { bin } });
  assert.deepEqual(first.filed, []);
  assert.match(first.pending[0], /the server did not answer/);
  assert.deepEqual([findings()[2].state, findings()[2].filed], ['resolved', 'open']);
  fs.rmSync(path.join(tmp, 'down'));
  const again = settleFinding(store, 'change:web/cart', 3, 'resolved', 'rounds half to even now', { entire: { bin } });
  assert.equal(again.commit, null, 'already resolved here');
  assert.deepEqual(again.filed, ['resolved #3']);
  assert.equal(onEntire().find((f) => f.id === findings()[2].entire)!.status, 'resolved');
  assert.equal(findings()[2].filed, 'resolved');
});

test('a sync reads what was posted on the Trail onto the change while its branch is open; a merged Trail is not asked', () => {
  // a reviewer posts on the Trail, with pjman not in the room
  execFileSync(bin, ['review']);
  const held = findings().length;
  const s = syncEntire(store, { entire: { bin } });
  assert.deepEqual(s.read, [{ change: 'change:web/cart', read: [`read #${held + 1}`] }]);
  assert.equal(findings().length, held + 1);
  assert.deepEqual(syncEntire(store, { entire: { bin } }).read, [], 'read once');
  // merged: Entire lists a Trail's findings no more, and is not asked; what was read stays
  fs.writeFileSync(path.join(tmp, 'merged'), '');
  reconcileTrail(store, 'change:web/cart', { entire: { bin } });
  const lists = () => calls().filter((c) => c[1] === 'finding' && c[2] === 'list' && c.includes('any')).length;
  const before = lists();
  const r = readFindings(store, 'change:web/cart', { entire: { bin } });
  assert.match(
    r.pending[0],
    /^Trail #1 is merged: Entire no longer lists its findings; the change keeps what was read before$/,
  );
  assert.equal(lists(), before);
  assert.equal(r.findings.length, held + 1);
});
