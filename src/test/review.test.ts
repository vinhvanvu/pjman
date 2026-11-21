// pjman review is pjman's own review (change:pjman-review): the brief a reviewer judges a change's branch by, findings
// kept as data on the change, and, in a project that opted in to Entire, each finding filed onto the change's Trail
// and settled there when it is settled here. With no Entire the review is local.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { decision } from '../ops/decision.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findingsOf, holdsMerge } from '../model/findings.js';
import { lensesAsked, roundsOf } from '../model/review.js';
import { validate } from '../model/validate.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { syncEntire } from '../sync/entire.js';
import {
  addFinding,
  closeRound,
  formatReviewBrief,
  handLens,
  readFindings,
  reviewBrief,
  reviewLoop,
  profilesOf,
  sameFolder,
  runReview,
  settleFinding,
} from '../sync/review.js';
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
/** The command's exit status, run as a process against the stand-in. */
const status = (...args: string[]): number | null =>
  spawnSync(process.execPath, [path.resolve(import.meta.dirname, '..', '..', 'bin', 'pjman.js'), ...args], {
    cwd: dir,
    env: { ...process.env, PJMAN_ENTIRE_BIN: bin },
    encoding: 'utf8',
  }).status;
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

/** The fake: one Trail per branch, and its findings. A `down` file makes every finding write fail, a `nolist` file
 *  the listing of them; a `paged` file lists them one a page, and a `nocursor` file says there are more and names no
 *  next page; a `number` file holds the Trail's number where it is not 1. */
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
const num = fs.existsSync(${JSON.stringify(path.join(tmp, 'number'))}) ? Number(fs.readFileSync(${JSON.stringify(path.join(tmp, 'number'))}, 'utf8')) : 1;
const show = () => ({ id: '01T' + num, number: num, url: 'https://entire.com/gh/acme/-/trails/' + num, status: state.trail.status, phase: 'building',
  changes: [{ repository: 'web', number: 1, branch: state.trail.branch, status: fs.existsSync(${JSON.stringify(path.join(tmp, 'merged'))}) ? 'merged' : 'open', mergeability: { mergeable: true, gates: [] } }] });
if (args[0] === 'review') {
  // the profiles: a listing written to the 'profile' file, the usual one where that file is empty; with 'personal'
  // there, only a checkout that has its own settings file lists any (the file's text is the listing), but for what a
  // 'shared' file lists for every checkout; with 'listfail' the listing fails in a checkout that has its own file
  const own = require('node:path').join(process.cwd(), '.entire', 'settings.local.json');
  const listing = fs.existsSync(${JSON.stringify(path.join(tmp, 'personal'))})
    ? (fs.existsSync(own) ? fs.readFileSync(own, 'utf8') : fs.existsSync(${JSON.stringify(path.join(tmp, 'shared'))}) ? fs.readFileSync(${JSON.stringify(path.join(tmp, 'shared'))}, 'utf8') : '')
    : fs.existsSync(${JSON.stringify(path.join(tmp, 'profile'))}) ? fs.readFileSync(${JSON.stringify(path.join(tmp, 'profile'))}, 'utf8') || 'Profiles:\\n  general  (default)\\n    reviewers: claude-code\\n    output:     trail\\n\\nRun one with entire review <name>.' : '';
  if (args.includes('--list') && fs.existsSync(${JSON.stringify(path.join(tmp, 'listfail'))}) && fs.existsSync(own)) fail('the server did not answer (503)');
  if (args.includes('--list')) console.log(listing || 'No review profiles configured. Create one with entire review --configure.');
  else if (fs.existsSync(${JSON.stringify(path.join(tmp, 'noreview'))})) fail('the review agents did not start');
  else { state.findings.push({ id: 'R' + (state.findings.length + 1), body: '[intent] the total ignores discounts, which the done-when asks for', severity: 'high', file: 'cart.ts', line: '1', status: 'open' }); save(); console.log('Review complete.'); }
}
else if (args[1] === 'show') { if (!state.trail) fail('branch "x" has no discoverable project trail'); console.log(JSON.stringify(show())); }
else if (args[1] === 'create') { state.trail = { branch: flag('--branch'), status: 'open' }; save(); console.log(JSON.stringify(show())); }
else if (args[1] === 'update') { if (flag('--status')) state.trail.status = flag('--status'); save(); console.log(JSON.stringify(show())); }
else if (args[1] === 'ready') console.log('Marked ready');
else if (args[1] === 'finding') {
  if (args[2] === 'list') { if (fs.existsSync(${JSON.stringify(path.join(tmp, 'nolist'))})) fail('the server did not answer (503)'); const open = state.findings.filter((f) => f.status === 'open').length;
    const paged = fs.existsSync(${JSON.stringify(path.join(tmp, 'paged'))}); const nocursor = fs.existsSync(${JSON.stringify(path.join(tmp, 'nocursor'))});
    const from = Number(flag('--cursor') || 0); const some = paged || nocursor ? state.findings.slice(from, from + 1) : state.findings; const more = (paged || nocursor) && from + 1 < state.findings.length;
    console.log(JSON.stringify({ counts: { Open: open, OpenHigh: 0, OpenMedium: open, OpenLow: 0 }, ...(more ? { has_more: true } : {}), ...(more && paged ? { next_cursor: String(from + 1) } : {}), findings: some.map((f) => ({ id: f.id, body: f.body, severity: f.severity, status: f.status, location: f.file ? { filePath: f.file, startLine: f.line ? Number(f.line) : null } : {} })) })); }
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
    /## Findings \(2 open findings \(1 holds the merge\)\)\n\n1\. \[open, holds the merge\] high cart\.ts:1 — The total counts items.*\n2\. \[open\] medium — No test covers a discount/,
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
  assert.deepEqual(early.pending, [
    'change:web/cart has no Trail yet: its findings are filed once it has one (`pjman sync entire --start change:web/cart` starts it, without asking)',
  ]);
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
  // Entire runs no review unnamed: the default profile is named
  assert.equal(run[1], 'general');
  assert.equal(r.profile, 'general');
  const got = findings();
  assert.equal(got.length, held + 1);
  assert.deepEqual(
    { ...got.at(-1), at: undefined },
    {
      id: got.at(-1)!.id,
      text: '[intent] the total ignores discounts, which the done-when asks for',
      severity: 'high',
      kind: 'intent',
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

test('the profile is named to Entire: the one asked for, the default, or the only one; several with no default are not guessed', () => {
  assert.deepEqual(
    profilesOf(
      'Profiles:\n  general  (default)\n    reviewers: claude-code · default\n    judge:      Claude Code\n    output:     trail\n  deep\n    reviewers: claude-code\n    output:     local\n\nRun one with `entire review <name>`.',
    ),
    { names: ['general', 'deep'], fallback: 'general', output: { general: 'trail', deep: 'local' } },
  );
  assert.deepEqual(profilesOf('No review profiles configured. Create one with `entire review --configure`.').names, []);
  // nothing below reaches the reviewers: the fake's review fails once the profile is chosen
  fs.writeFileSync(path.join(tmp, 'noreview'), '');
  const ran = (profile?: string) => {
    fs.writeFileSync(callsFile, '');
    const r = runReview(store, 'change:web/cart', { entire: { bin }, profile });
    return { pending: r.pending, named: calls().find((c) => c[0] === 'review' && c.includes('--prompt'))?.[1] };
  };
  fs.writeFileSync(
    path.join(tmp, 'profile'),
    'Profiles:\n  quick\n    output:     trail\n  deep\n    output:     local',
  );
  const two = ran();
  assert.equal(two.named, undefined);
  assert.match(
    two.pending[0],
    /^2 review profiles in .* and none is the default \(quick, deep\): name one with --profile$/,
  );
  assert.equal(ran('quick').named, 'quick');
  // where its verdict goes is read from the profile that runs, not from any profile listed
  const deep = ran('deep');
  assert.equal(deep.named, 'deep');
  assert.match(deep.pending[0], /^the review profile deep keeps its verdict local/);
  const wrong = ran('nope');
  assert.equal(wrong.named, undefined);
  assert.match(wrong.pending[0], /^no review profile named nope in .*: there are quick, deep$/);
  // the only one there is needs no default mark
  fs.writeFileSync(path.join(tmp, 'profile'), 'Profiles:\n  solo\n    output:     trail');
  assert.equal(ran().named, 'solo');
  // a listing in a layout pjman does not read is not taken for no profile: it is said, and a profile the person names
  // is still asked of Entire
  const odd = 'Review profiles\n- general (default)\n- deep';
  assert.deepEqual(profilesOf(odd), { names: [], fallback: undefined, output: {}, unread: true });
  assert.equal(profilesOf('').unread, undefined);
  fs.writeFileSync(path.join(tmp, 'profile'), odd);
  const unread = ran();
  assert.equal(unread.named, undefined);
  assert.match(
    unread.pending[0],
    /^entire review --list answered in .* with a listing pjman could not read, so the profile to run was not found: name it \(pjman review change:web\/cart --run --profile <name>\)$/,
  );
  const named = ran('general');
  assert.equal(named.named, 'general');
  assert.match(named.pending[0], /^Entire does not say where the review profile general sends its verdict/);
  fs.writeFileSync(path.join(tmp, 'profile'), '');
  fs.rmSync(path.join(tmp, 'noreview'));
});

test("a profile saved for the person alone is found from a worktree: copied in from the main checkout, never over the worktree's own", () => {
  const wt = path.join(tmp, 'wt-cart');
  g('worktree', 'add', '-q', wt, 'cart');
  const mine = path.join(dir, '.entire', 'settings.local.json');
  const here = path.join(wt, '.entire', 'settings.local.json');
  const copied = `your own review profile was copied into the worktree (${mine} to ${here})`;
  const general = 'Profiles:\n  general  (default)\n    output:     trail';
  fs.writeFileSync(path.join(tmp, 'personal'), '');
  fs.writeFileSync(path.join(tmp, 'noreview'), '');
  const run = (profile?: string) => {
    fs.writeFileSync(callsFile, '');
    const r = runReview(store, 'change:web/cart', { entire: { bin }, profile });
    return { ...r, named: calls().find((c) => c[0] === 'review' && c.includes('--prompt'))?.[1] };
  };
  try {
    // no profile anywhere: nothing is copied, and the worktree is named as the place without one
    const none = run();
    assert.match(none.pending[0], new RegExp(`^no review profile in ${wt}: set one up`));
    assert.equal(fs.existsSync(here), false);
    // the main checkout's own file names none: the copy is taken back, with the folder made for it
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, '');
    assert.match(run().pending[0], /^no review profile in /);
    assert.equal(fs.existsSync(here), false);
    assert.equal(fs.existsSync(path.dirname(here)), false, 'the worktree is left as it was');
    // the listing fails once the file is there: the copy is taken back, and the reason is pending
    fs.writeFileSync(mine, general);
    fs.writeFileSync(path.join(tmp, 'listfail'), '');
    const failed = run();
    fs.rmSync(path.join(tmp, 'listfail'));
    assert.equal(failed.named, undefined);
    assert.match(failed.pending[0], /the server did not answer \(503\)/);
    assert.equal(fs.existsSync(here), false, 'no copy is left where nothing was said of it');
    assert.equal(fs.existsSync(path.dirname(here)), false);
    // a file that cannot be read is a reason, never a raw error
    fs.chmodSync(mine, 0o000);
    const unreadable = run();
    fs.chmodSync(mine, 0o644);
    assert.match(unreadable.pending[0], /^your own review profile could not be copied into the worktree \(.+\): /);
    assert.equal(fs.existsSync(here), false);
    assert.equal(fs.existsSync(path.dirname(here)), false);
    // a branch that would show the file to git and cannot be made to ignore it gets no copy
    fs.mkdirSync(path.dirname(here), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(here), '.gitignore'), '!settings.local.json\n');
    const shown = run();
    assert.match(
      shown.pending[0],
      /^your own review profile was not copied into the worktree: .* does not ignore \.entire\/settings\.local\.json/,
    );
    assert.equal(fs.existsSync(here), false);
    // (the line tried in the repository's exclude list did not hide the file: it is not left there)
    const exclude = path.join(dir, '.git', 'info', 'exclude');
    const excluded = () => (fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '').split('\n');
    assert.ok(!excluded().includes('/.entire/settings.local.json'));
    fs.rmSync(path.dirname(here), { recursive: true });
    // it names one: copied in, said, and the review is run with it, in the worktree. The branch has no ignore rule
    // for the file (the line just tried is in the repository's exclude list, which now hides it): git does not show it
    const found = run();
    assert.equal(found.said.length, 2);
    assert.match(
      found.said[0],
      /^\.entire\/settings\.local\.json was added to this repository's exclude list \(.*info\/exclude\): the branch does not ignore it$/,
    );
    assert.equal(found.said[1], copied);
    assert.equal(excluded().filter((l) => l === '/.entire/settings.local.json').length, 1);
    assert.equal(found.named, 'general');
    assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(mine, 'utf8'));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }), '');
    // there already: used as it is, with nothing said
    const again = run();
    assert.deepEqual(again.said, []);
    assert.equal(again.named, 'general');
    // yours changed since (a profile added): pjman's own copy, untouched since, is copied again where the review
    // needs what it lacks
    fs.writeFileSync(mine, `${general}\n  deep\n    output:     trail`);
    const fresh = run('deep');
    assert.deepEqual(fresh.said, [
      `your own review profile changed since it was copied into the worktree, and was copied again (${mine} to ${here})`,
    ]);
    assert.equal(fresh.named, 'deep');
    assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(mine, 'utf8'));
    // and where the old copy still names a profile to run: yours was corrected (another default), and the corrected
    // one is what runs, never the copy gone stale
    fs.writeFileSync(mine, 'Profiles:\n  general\n    output:     trail\n  deep  (default)\n    output:     trail');
    const corrected = run();
    assert.equal(corrected.said.length, 1);
    assert.match(corrected.said[0], /changed since it was copied into the worktree, and was copied again/);
    assert.equal(corrected.named, 'deep');
    assert.equal(fs.readFileSync(here, 'utf8'), fs.readFileSync(mine, 'utf8'));
    // yours corrected to what resolves no profile is copied all the same and said: the review answers for your file
    // as it stands, and nothing runs from the copy gone stale
    const againCopied = /changed since it was copied into the worktree, and was copied again/;
    fs.writeFileSync(mine, 'Profiles:\n  general\n    output:     trail\n  deep\n    output:     trail');
    const undecided = run();
    assert.match(undecided.said[0], againCopied);
    assert.equal(undecided.named, undefined);
    assert.match(undecided.pending[0], /^2 review profiles in .* and none is the default/);
    fs.writeFileSync(mine, '');
    const emptied = run();
    assert.match(emptied.said[0], againCopied);
    assert.equal(emptied.named, undefined);
    assert.match(emptied.pending[0], /^no review profile in /);
    assert.equal(fs.readFileSync(here, 'utf8'), '');
    // yours deleted: pjman's copy of it goes too, said
    fs.writeFileSync(mine, general);
    assert.equal(run().named, 'general');
    fs.rmSync(mine);
    const gone = run();
    assert.match(
      gone.said[0],
      /^your own review profile is gone from the main checkout \(.*\), so the copy of it in the worktree was removed/,
    );
    assert.equal(gone.named, undefined);
    assert.equal(fs.existsSync(here), false);
    fs.writeFileSync(mine, general);
    assert.equal(run().named, 'general');
    // the worktree's own file is never written over, even where it names no profile; that it is not yours is said
    fs.writeFileSync(here, '');
    const kept = run();
    assert.equal(kept.named, undefined);
    assert.match(
      kept.pending[0],
      /settings\.local\.json is the worktree's own and was left as it is; it differs from yours in .*\): set one up/,
    );
    assert.equal(fs.readFileSync(here, 'utf8'), '');
    // profiles shared by the repository do not keep yours out: with the one asked for missing, or several and no
    // default, your file is brought in
    fs.rmSync(here);
    const shared = 'Profiles:\n  team\n    output:     trail\n  other\n    output:     trail';
    fs.writeFileSync(path.join(tmp, 'shared'), shared);
    fs.writeFileSync(mine, `${shared}\n  general  (default)\n    output:     trail`);
    const both = run();
    assert.deepEqual(both.said, [copied]);
    assert.equal(both.named, 'general');
    fs.rmSync(here);
    assert.equal(run('team').named, 'team', 'a shared profile asked for needs no copy');
    assert.equal(fs.existsSync(here), false);
  } finally {
    for (const f of ['personal', 'noreview', 'listfail', 'shared']) fs.rmSync(path.join(tmp, f), { force: true });
    fs.rmSync(mine, { force: true });
    g('worktree', 'remove', '--force', wt);
  }
});

test('the main checkout is known as itself through a link to its folder', () => {
  const link = path.join(tmp, 'web-link');
  fs.symlinkSync(dir, link);
  try {
    assert.equal(sameFolder(link, dir), true);
    assert.equal(sameFolder(path.join(tmp, 'elsewhere'), dir), false);
  } finally {
    fs.rmSync(link);
  }
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

test('opted in, the re-review is handed the fix alone, and what does not hold the merge leaves the Trail for the follow-up change', () => {
  const o = { entire: { bin } };
  // a review asked for before the change reached review filed what it found and closed no round
  const rounds = () => roundsOf(loadStore(store).byKey.get('change:web/cart')![0].data);
  assert.deepEqual(rounds(), []);
  // in review, the review Entire makes is the full round: its lenses are Entire's, and it closes the round itself
  step(store, 'change:cart', 'done', 1, {});
  // a review that does not run handed nothing out: no lens stays on the record, and no round is closed
  fs.writeFileSync(path.join(tmp, 'noreview'), '');
  const failed = runReview(store, 'change:web/cart', o);
  assert.equal(failed.ran, false);
  assert.match(failed.pending.at(-1)!, /failed: the review agents did not start$/);
  assert.deepEqual(lensesAsked(loadStore(store).byKey.get('change:web/cart')![0].data), []);
  assert.deepEqual(rounds(), []);
  fs.rmSync(path.join(tmp, 'noreview'));
  const first = runReview(store, 'change:web/cart', o);
  assert.equal(first.round?.round?.round, 'full');
  assert.deepEqual(
    lensesAsked(loadStore(store).byKey.get('change:web/cart')![0].data).map((a) => `${a.lens} ${a.by}`),
    ['intent entire', 'drift entire', 'correctness entire'],
  );
  // on request, what does not hold the merge stays where it is until asked
  assert.deepEqual(first.round?.moved, []);
  const full = rounds()[0];
  assert.equal(full.round, 'full');
  assert.equal(full.head, g('rev-parse', 'cart').trim());
  findings().forEach((f, i) => holdsMerge(f) && settleFinding(store, 'change:web/cart', i + 1, 'resolved', 'fixed', o));
  assert.equal(reviewLoop(store, 'change:web/cart').state, 'recheck');
  assert.match(reviewLoop(store, 'change:web/cart').next!, /^The fix is re-reviewed once.*Run `pjman review .* --run`/);
  const low = addFinding(store, 'change:web/cart', { text: 'A name could be clearer', severity: 'low' }, o);
  assert.deepEqual(low.filed, [`filed #${low.n}`]);
  set(store, 'project:web', ['ext.review.mode=auto'], {});
  // Entire reviews what came after the full review's head, told to judge the fix alone
  fs.writeFileSync(callsFile, '');
  const r = runReview(store, 'change:web/cart', o);
  const run = calls().find((c) => c[0] === 'review' && c.includes('--prompt'))!;
  assert.equal(run[run.indexOf('--base') + 1], full.head);
  assert.match(run[run.indexOf('--prompt') + 1], /^This branch had one full review at .* Judge only the fix/);
  assert.equal(r.round?.round?.round, 'fix');
  // its own review posts a high finding again (the fake's one answer): the loop ends with it standing
  assert.equal(r.round?.loop.state, 'ended');
  assert.match(r.round.loop.words!, /1 finding still holds the merge after the one re-review/);
  // what does not hold the merge is a step of the follow-up change, deferred here and dismissed on the Trail
  const moved = r.round.moved;
  assert.ok(moved.includes(low.n!));
  assert.equal(r.round?.followUp, 'change:web/cart-follow-ups');
  const mine = findings()[low.n! - 1];
  assert.deepEqual(
    [mine.state, mine.filed, mine.note],
    ['deferred', 'deferred', 'moved to change:web/cart-follow-ups'],
  );
  const there = onEntire().find((f) => f.id === mine.entire)! as { status: string; reason?: string };
  assert.deepEqual([there.status, there.reason], ['dismissed', 'moved to change:web/cart-follow-ups']);
  // read back, the dismissal on Entire is the move, not a new state
  assert.deepEqual(readFindings(store, 'change:web/cart', o).read, []);
  assert.equal(findings()[low.n! - 1].state, 'deferred');
  set(store, 'project:web', ['ext.review.mode=request'], {});
  // settle what the re-review left, so the tests after start clean
  findings().forEach(
    (f, i) => holdsMerge(f) && settleFinding(store, 'change:web/cart', i + 1, 'dismissed', 'a stand-in', o),
  );
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

test('a round whose findings could not be read is not closed: with no Trail nothing runs, and a read that fails leaves the review due', () => {
  const o = { entire: { bin } };
  const k = 'change:web/coupon';
  fs.rmSync(path.join(tmp, 'merged'), { force: true });
  g('switch', '-q', '-c', 'coupon');
  fs.writeFileSync(path.join(dir, 'coupon.ts'), 'export const off = (total) => total;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: a coupon takes its share off (change:coupon)');
  g('switch', '-q', 'main');
  change(store, 'coupon', {
    name: 'Coupon',
    gist: 'A coupon takes its share off the total',
    intent: 'A shopper with a coupon pays less.',
    doneWhen: 'The total is less by what the coupon says.',
    project: 'project:web',
    next: 'build it',
  });
  step(store, 'change:coupon', 'start', 1, {});
  step(store, 'change:coupon', 'done', 1, {});
  const data = () => loadStore(store).byKey.get(k)![0].data;
  const reviewers = () => calls().filter((c) => c[0] === 'review' && c.includes('--prompt')).length;
  assert.equal(reviewLoop(store, k).state, 'due');
  // no Trail, and none can be started (the stand-in's one Trail is closed): the reviewers are not started, nothing
  // is recorded, and what held the Trail is said, with nothing to ask anyone for (change:trail-without-asking)
  fs.writeFileSync(callsFile, '');
  const none = runReview(store, k, o);
  assert.equal(none.ran, false);
  assert.match(
    none.pending[0],
    /^change:web\/coupon has no Trail yet and one could not be started \(Trail #1 on coupon is closed: .*\): .* it was not run; the review is still due\. .*`pjman sync entire --start change:web\/coupon`\); neither needs asking for$/,
  );
  assert.equal(reviewers(), 0);
  // the command says so by its status too: a review that did not run is not a review made
  assert.equal(status('review', k, '--run'), 1);
  assert.equal(reviewers(), 0);
  assert.deepEqual(lensesAsked(data()), []);
  assert.deepEqual(roundsOf(data()), []);
  assert.equal(reviewLoop(store, k).state, 'due');
  // a change not yet in work gets no Trail, and the review says that is why
  g('branch', 'voucher');
  change(store, 'voucher', {
    name: 'Voucher',
    gist: 'A voucher is taken once',
    intent: 'A shopper uses a voucher once.',
    doneWhen: 'A voucher used is refused the second time.',
    project: 'project:web',
    next: 'build it',
  });
  assert.match(
    runReview(store, 'change:web/voucher', o).pending[0],
    /^change:web\/voucher has no Trail yet and one could not be started \(it is \w+, and a Trail follows a change in work: start a step first\): /,
  );
  assert.equal(reviewers(), 0);
  // a profile that keeps its verdict local posts nothing to read: not run either while the review is due
  fs.writeFileSync(path.join(tmp, 'profile'), 'Profiles:\n  deep\n    output:     local');
  const local = runReview(store, k, o);
  assert.equal(local.ran, false);
  assert.match(
    local.pending[0],
    /^the review profile deep keeps its verdict local: only findings posted to the Trail can be read back, so it was not run and the review is still due/,
  );
  // one whose listing does not say where its verdict goes is not taken for the Trail, and is not called local
  fs.writeFileSync(path.join(tmp, 'profile'), 'Profiles:\n  bare\n    reviewers: claude-code');
  assert.match(
    runReview(store, k, o).pending[0],
    /^Entire does not say where the review profile bare sends its verdict: .* it was not run/,
  );
  // a listing pjman cannot read does not run a due review either, with or without a profile named: the way on is the
  // session's own reviewers, never --profile a second time
  fs.writeFileSync(path.join(tmp, 'profile'), 'Review profiles\n- general (default)');
  for (const profile of [undefined, 'general'])
    assert.match(
      runReview(store, k, { ...o, profile }).pending[0],
      /^entire review --list answered in .* with a listing pjman could not read, so where a profile's verdict goes is not known: it was not run and the review is still due; hand the round to reviewers of the session's own, one fresh reviewer a lens \(`pjman review change:web\/coupon --lens <intent\|drift\|correctness>`\), then close it/,
    );
  assert.equal(reviewers(), 0);
  fs.writeFileSync(path.join(tmp, 'profile'), '');
  // with no Trail on the branch, the review starts one itself and says the branch was pushed, then the reviewers
  // run; Entire then does not list what they posted: the round stays open
  // (the stand-in holds one Trail, closed by the test before: it starts again with none, and numbers the next 2)
  fs.rmSync(stateFile);
  fs.writeFileSync(path.join(tmp, 'number'), '2');
  fs.writeFileSync(path.join(tmp, 'nolist'), '');
  const unread = runReview(store, k, o);
  assert.equal(unread.ran, true);
  assert.match(unread.said.join('\n'), /^entire: change:web\/coupon created, readied · Trail #2 /m);
  assert.match(unread.said.join('\n'), /^entire: pushed coupon to origin/m);
  assert.equal(reviewers(), 1);
  assert.equal(unread.round, undefined);
  assert.equal(unread.open, true);
  // the reviewers are back, so their lenses are on the record, by the time they went out
  assert.deepEqual(
    lensesAsked(data()).map((a) => `${a.lens} ${a.by}`),
    ['intent entire', 'drift entire', 'correctness entire'],
  );
  assert.deepEqual(unread.read, []);
  assert.match(unread.pending[0], /the server did not answer/);
  assert.match(unread.pending.at(-1)!, /the round is not closed and the review is still due/);
  assert.deepEqual(roundsOf(data()), []);
  const loop = reviewLoop(store, k);
  assert.equal(loop.state, 'due');
  assert.match(loop.next!, /what they posted on the Trail was not read\. `pjman review .* --reviewed` reads it/);
  // a listing that says there is more and names no next page is not a Trail read: nothing is taken from it
  execFileSync(bin, ['review']);
  fs.rmSync(path.join(tmp, 'nolist'));
  fs.writeFileSync(path.join(tmp, 'nocursor'), '');
  const part = readFindings(store, k, o);
  assert.deepEqual([part.listed, part.read, part.commit], [false, [], null]);
  assert.match(
    part.pending[0],
    /^the Trail holds more findings than could be read \(1 listed, and Entire names no next page\)/,
  );
  assert.throws(() => closeRound(store, k, o), /the round is not closed .*more findings than could be read/);
  fs.rmSync(path.join(tmp, 'nocursor'));
  fs.writeFileSync(path.join(tmp, 'nolist'), '');
  // closing it by hand meets the same gate
  assert.throws(
    () => closeRound(store, k, o),
    /the round is not closed and the review is still due: .*\(.*the server did not answer.*\)/,
  );
  assert.deepEqual(roundsOf(data()), []);
  // once Entire lists them, closing the round reads them first, every page: the round is closed on what was found
  fs.rmSync(path.join(tmp, 'nolist'));
  fs.writeFileSync(path.join(tmp, 'paged'), '');
  fs.writeFileSync(callsFile, '');
  const closed = closeRound(store, k, o);
  fs.rmSync(path.join(tmp, 'paged'));
  assert.equal(closed.round?.round, 'full');
  assert.equal(reviewers(), 0, 'the reviewers are not run again');
  assert.deepEqual(
    calls()
      .filter((c) => c[2] === 'list')
      .map((c) => (c.includes('--cursor') ? c[c.indexOf('--cursor') + 1] : '')),
    ['', '1'],
  );
  assert.equal(findingsOf(data()).filter((f) => f.by === 'entire' && f.state === 'open' && holdsMerge(f)).length, 2);
  assert.equal(closed.loop.state, 'fixing');
  // the re-review of the fix meets the same gate: handed to Entire and left unread, its round stays open
  findingsOf(data()).forEach((f, i) => holdsMerge(f) && settleFinding(store, k, i + 1, 'resolved', 'fixed', o));
  assert.equal(reviewLoop(store, k).state, 'recheck');
  fs.writeFileSync(path.join(tmp, 'nolist'), '');
  // (through the command: the reviewers ran, the round was due and is not closed, and the status says so)
  fs.writeFileSync(callsFile, '');
  assert.equal(status('review', k, '--run'), 1);
  assert.equal(reviewers(), 1);
  assert.equal(lensesAsked(data()).find((a) => a.lens === 'fix')?.by, 'entire');
  assert.equal(reviewLoop(store, k).state, 'recheck');
  assert.throws(() => closeRound(store, k, o), /the round is not closed and the review is still due/);
  assert.deepEqual(
    roundsOf(data()).map((r) => r.round),
    ['full'],
  );
  // the way out where Entire never lists it: the lens handed to a reviewer of the session's own takes Entire's place
  handLens(store, k, 'fix', o);
  assert.deepEqual(
    lensesAsked(data())
      .filter((a) => a.lens === 'fix')
      .map((a) => a.by === 'entire'),
    [false],
  );
  assert.equal(closeRound(store, k, o).round?.round, 'fix');
  fs.rmSync(path.join(tmp, 'nolist'));
  // a review run beside the loop, with nothing due, is a review made: status 0
  assert.equal(status('review', k, '--run'), 0);
  // a Trail that is merged is listed no more: the reviewers are not started on it
  fs.writeFileSync(path.join(tmp, 'merged'), '');
  reconcileTrail(store, k, o);
  fs.writeFileSync(callsFile, '');
  const gone = runReview(store, k, o);
  assert.equal(gone.ran, false);
  assert.match(
    gone.pending[0],
    /^Trail #2 is merged: Entire no longer lists its findings, so nothing its review found could be read and it was not run$/,
  );
  assert.equal(reviewers(), 0);
  // where a review is due on such a Trail, the refusal names the way on: the session's own reviewers
  set(store, k, ['status=review'], {});
  step(store, 'change:coupon', 'add', undefined, { text: 'one more thing' });
  g('switch', '-q', 'coupon');
  fs.writeFileSync(path.join(dir, 'coupon.ts'), 'export const off = (total) => total - 1;\n');
  g('commit', '-q', '-am', 'fix: the coupon takes one off (change:coupon)');
  g('switch', '-q', 'main');
  step(store, 'change:coupon', 'done', 2, {});
  assert.equal(reviewLoop(store, k).state, 'due');
  const dueGone = runReview(store, k, o);
  assert.equal(dueGone.ran, false);
  assert.match(
    dueGone.pending[0],
    /^Trail #2 is merged: .* it was not run; the review is still due: hand the round to reviewers of the session's own, .*--lens <intent\|drift\|correctness>.*--reviewed/,
  );
});
