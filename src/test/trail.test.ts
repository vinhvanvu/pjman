// A change's Trail follows the change (change:trail-lifecycle): in a project that opted in to Entire it is created
// when work starts, kept to the change's words, marked ready at review, closed at done or dropped, and what Entire
// holds of it (phase, gates, findings, the merge) is read back onto the record. Entire here is a fake binary that keeps
// its Trails in a file and answers as the real CLI does.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { decision } from '../ops/decision.js';
import { notesOf } from '../ops/note.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { syncEntire } from '../sync/entire.js';
import { reconcileTrail, trailLines, trailOf } from '../sync/trail.js';
import { render } from '../ops/write.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-trail-')));
const dir = path.join(tmp, 'web');
const stateFile = path.join(tmp, 'entire-state.json');
const callsFile = path.join(tmp, 'calls.jsonl');
let store: Store;
let bin: string;

interface FakeTrail {
  number: number;
  id: string;
  title: string;
  body: string;
  status: string;
  phase: string;
  branch: string;
  change: string;
  ready: boolean;
  gates: { gate_key: string; status: string; blocking: boolean; state: string }[];
  open: number;
}
const trails = (): FakeTrail[] => JSON.parse(fs.readFileSync(stateFile, 'utf8')) as FakeTrail[];
const edit = (n: number, f: (t: FakeTrail) => void) => {
  const all = trails();
  f(all.find((t) => t.number === n)!);
  fs.writeFileSync(stateFile, JSON.stringify(all));
};
const calls = (): string[][] =>
  fs.existsSync(callsFile)
    ? fs
        .readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[])
    : [];
const verbs = () => calls().map((c) => c.slice(0, c[1] === 'finding' ? 3 : 2).join(' '));
const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const rec = (slug: string) => loadStore(store).byKey.get(`change:web/${slug}`)![0];

/** The fake: `trail show|create|update|ready` and `trail finding list`, over the state file. */
function fake(): string {
  const file = path.join(tmp, 'entire');
  fs.writeFileSync(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
const state = fs.existsSync(${JSON.stringify(stateFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8')) : [];
const save = () => fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const fail = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const show = (t, gates) => ({
  id: t.id, number: t.number, url: 'https://entire.com/gh/acme/-/trails/' + t.number, title: t.title, body: t.body,
  status: t.status, phase: t.phase,
  changes: [{ repository: 'web', number: t.number, branch: t.change === 'merged' ? '' : t.branch, status: t.change,
    url: 'https://entire.com/gh/acme/-/trails/' + t.number + '/changes/web/' + t.number,
    ...(gates ? { mergeability: { mergeable: t.gates.every((x) => x.status === 'passed'), gates: t.gates } } : {}) }],
});
const pick = () => {
  const b = flag('--branch');
  const n = args.slice(2).find((a) => /^\\d+$/.test(a));
  return state.find((t) => (b ? t.branch === b : String(t.number) === n));
};
if (args[0] !== 'trail') fail('unknown command');
if (args[1] === 'show') {
  const t = pick();
  if (!t) fail('branch "' + flag('--branch') + '" has no discoverable project trail; pass a project trail ID with --project');
  console.log(JSON.stringify(show(t, true)));
} else if (args[1] === 'create') {
  if (flag('--branch') === 'refused') fail('trails are not enabled for gh/acme/web; an admin can turn them on');
  const t = { number: state.length + 1, id: '01TRAIL' + (state.length + 1), title: flag('--title'), body: flag('--body'),
    status: 'open', phase: 'building', branch: flag('--branch'), change: 'draft', ready: false,
    gates: [{ gate_key: 'approvals', status: 'pending', blocking: true, state: 'evaluated' },
            { gate_key: 'old', status: 'failed', blocking: true, state: 'disabled' }], open: 0 };
  state.push(t); save();
  console.log(JSON.stringify(show(t, false)));
} else if (args[1] === 'update') {
  const t = pick();
  if (flag('--title')) t.title = flag('--title');
  if (flag('--body')) t.body = flag('--body');
  if (flag('--status')) { t.status = flag('--status'); if (t.status === 'closed') t.phase = 'closed'; }
  save();
  console.log(JSON.stringify(show(t, false)));
} else if (args[1] === 'ready') {
  if (args.includes('--json')) fail('unknown flag: --json');
  const t = pick(); t.ready = !args.includes('--undo'); t.change = t.ready ? 'open' : 'draft'; save();
  console.log('Marked trail #' + t.number + ' ready for review');
} else if (args[1] === 'finding' && args[2] === 'list') {
  const t = pick();
  console.log(JSON.stringify({ counts: { Open: t.open, OpenHigh: t.open, OpenMedium: 0, OpenLow: 0 }, findings: [] }));
} else fail('unknown trail command ' + args[1]);
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
  g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'start');
  for (const b of ['cart', 'search', 'gone', 'adopted', 'refused']) g('branch', b);
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  set(store, 'project:web', ['ext.github.repo=acme/web'], {});
  bin = fake();
  change(store, 'cart', {
    name: 'Cart',
    gist: 'The cart holds what a shopper picked',
    intent: 'A shopper keeps items between visits.',
    doneWhen: 'Items survive a reload.',
    project: 'project:web',
    next: 'build it',
  });
  decision(store, 'cart/storage', {
    name: 'Cart storage',
    gist: 'Where the cart is kept',
    entries: [
      { type: 'question', text: 'Where is the cart kept?' },
      { type: 'option', id: 'server', text: 'On the server, by account' },
      { type: 'option', id: 'local', text: 'In the browser' },
      { type: 'accept', option: 'server', by: 'person:tester' },
    ],
  });
});

test('off: a project that has not opted in gets no Trail, and nothing of Entire runs', () => {
  step(store, 'change:cart', 'start', 1, {});
  assert.equal(reconcileTrail(store, 'change:web/cart', { entire: { bin } }), null);
  assert.deepEqual(calls(), []);
});

test('work starting creates the Trail from the change and binds it', () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  const r = reconcileTrail(store, 'change:web/cart', { entire: { bin } })!;
  assert.deepEqual(r.acts, ['created']);
  assert.deepEqual(r.pending, []);
  assert.equal(r.trail, 'entire-trail:gh/acme/1');
  assert.deepEqual(verbs(), ['trail show', 'trail create', 'trail show', 'trail finding list']);
  const create = calls()[1];
  assert.deepEqual(create.slice(0, 4), ['trail', 'create', '--title', 'Cart']);
  assert.ok(create.includes('--branch') && create[create.indexOf('--branch') + 1] === 'cart');
  assert.equal(create[create.indexOf('--base') + 1], 'main');
  assert.equal(
    create[create.indexOf('--body') + 1],
    'The cart holds what a shopper picked\n\n## Intent\n\nA shopper keeps items between visits.\n\n## Done when\n\nItems survive a reload.\n\n## Decisions\n\n- **Cart storage**: On the server, by account\n\npjman: change:web/cart',
  );
  const loaded = loadStore(store);
  const t = trailOf(loaded, rec('cart'))!;
  assert.equal(t.key, 'entire-trail:gh/acme/1');
  assert.equal(t.src!.data.url, 'https://entire.com/gh/acme/-/trails/1');
  assert.equal(t.state!.phase, 'building');
  assert.deepEqual(
    t.state!.gates,
    [{ key: 'approvals', status: 'pending', blocking: true }],
    'a disabled gate is left out',
  );
  assert.match(
    formatChangeContext(changeContext(store, 'change:web/cart')),
    /## Trail\n\nTrail #1 building · branch draft · approvals pending \(https:\/\/entire\.com\/gh\/acme\/-\/trails\/1\)/,
  );
  // nothing moved: a second reconcile reads and writes nothing
  const again = reconcileTrail(store, 'change:web/cart', { entire: { bin } })!;
  assert.deepEqual(again.acts, []);
  assert.equal(again.commit, null);
});

test('the body follows the change, and the last step done marks the Trail ready', () => {
  set(store, 'change:cart', ['gist=The cart keeps what a shopper picked'], {});
  assert.deepEqual(reconcileTrail(store, 'change:web/cart', { entire: { bin } })!.acts, ['updated']);
  assert.match(trails()[0].body, /^The cart keeps what a shopper picked\n/);
  step(store, 'change:cart', 'done', 1, {});
  assert.equal(rec('cart').data.status, 'review');
  const r = reconcileTrail(store, 'change:web/cart', { entire: { bin } })!;
  assert.deepEqual(r.acts, ['readied']);
  assert.equal(trails()[0].ready, true);
  assert.ok(!calls().some((c) => c[1] === 'ready' && c.includes('--json')), 'ready prints text: no --json');
  assert.deepEqual(reconcileTrail(store, 'change:web/cart', { entire: { bin } })!.acts, [], 'readied once');
});

test('what moves on Entire is read back, and with --wake noted on the change for the session waiting on it', () => {
  edit(1, (t) => {
    t.gates[0].status = 'passed';
    t.open = 2;
  });
  const r = syncEntire(store, { entire: { bin }, wake: true });
  assert.deepEqual(
    r.trails.map((t) => t.moved),
    [['the approvals gate passed', '2 new findings (2 open)']],
  );
  const notes = notesOf(rec('cart').sections.get('Notes')).map((n) => n.text);
  assert.deepEqual(notes, ['Entire, Trail #1: the approvals gate passed; 2 new findings (2 open)']);
  assert.match(
    formatChangeContext(changeContext(store, 'change:web/cart')),
    /Trail #1 building · branch open · approvals passed · 2 open findings \(2 high\)/,
  );
  assert.deepEqual(syncEntire(store, { entire: { bin }, wake: true }).trails[0].moved, [], 'said once');
});

test('a branch merged on Entire sets the change done and closes its Trail', () => {
  edit(1, (t) => {
    t.change = 'merged';
    t.phase = 'complete';
    t.open = 0;
  });
  const r = syncEntire(store, { entire: { bin } }).trails[0];
  assert.equal(r.done, true);
  assert.ok(r.moved.includes('its branch was merged'));
  assert.ok(r.acts.includes('closed'));
  assert.equal(rec('cart').data.status, 'done');
  assert.equal(trails()[0].status, 'closed');
  assert.equal(trailOf(loadStore(store), rec('cart'))!.state!.status, 'closed');
  const before = calls().length;
  assert.deepEqual(syncEntire(store, { entire: { bin } }).trails, [], 'a closed Trail is left alone');
  assert.equal(calls().length, before);
});

test('a change reopened after its merge is not ended again by that merge; an Entire that hangs holds a command for its budget only', () => {
  set(store, 'change:web/cart', ['status=review'], {});
  reconcileTrail(store, 'change:web/cart', { entire: { bin } });
  assert.equal(rec('cart').data.status, 'review');
  set(store, 'change:web/cart', ['status=done'], {});
  const slowLog = path.join(tmp, 'slow.log');
  const slow = path.join(tmp, 'entire-slow');
  fs.writeFileSync(slow, `#!/bin/sh\necho x >> ${slowLog}\nexec sleep 6\n`, { mode: 0o755 });
  set(store, 'change:web/cart', ['status=review'], {});
  const t0 = Date.now();
  const r = reconcileTrail(store, 'change:web/cart', { entire: { bin: slow }, budget: 1000 });
  assert.ok(Date.now() - t0 < 4000, 'the budget bounds the wait');
  assert.equal(fs.readFileSync(slowLog, 'utf8').trim().split('\n').length, 1, 'one call, and no more after it hung');
  assert.ok(r!.pending.some((p) => /did not answer in time/.test(p)));
  set(store, 'change:web/cart', ['status=done'], {});
});

test('a dropped change closes its Trail; a Trail already on the branch is adopted, never doubled', () => {
  change(store, 'gone', { name: 'Gone', project: 'project:web', next: 'build it' });
  step(store, 'change:gone', 'start', 1, {});
  assert.deepEqual(reconcileTrail(store, 'change:web/gone', { entire: { bin } })!.acts, ['created']);
  set(store, 'change:gone', ['status=dropped'], {});
  assert.deepEqual(reconcileTrail(store, 'change:web/gone', { entire: { bin } })!.acts, ['closed']);
  assert.equal(trails()[1].status, 'closed');

  fs.writeFileSync(
    stateFile,
    JSON.stringify([
      ...trails(),
      {
        number: 3,
        id: '01HAND',
        title: 'By hand',
        body: '',
        status: 'open',
        phase: 'building',
        branch: 'adopted',
        change: 'open',
        ready: false,
        gates: [],
        open: 0,
      },
    ]),
  );
  change(store, 'adopted', { name: 'Adopted', project: 'project:web', next: 'build it' });
  step(store, 'change:adopted', 'start', 1, {});
  const r = reconcileTrail(store, 'change:web/adopted', { entire: { bin } })!;
  assert.deepEqual(r.acts, ['adopted', 'updated']);
  assert.equal(r.trail, 'entire-trail:gh/acme/3');
  assert.equal(trails().length, 3, 'no second Trail');
  assert.equal(trails()[2].title, 'Adopted');
});

test('what Entire refuses or does not answer is pending: the change is written all the same, and the next run takes it up', () => {
  change(store, 'refused', { name: 'Refused', project: 'project:web', next: 'build it' });
  step(store, 'change:refused', 'start', 1, {});
  const r = reconcileTrail(store, 'change:web/refused', { entire: { bin } })!;
  assert.deepEqual(r.acts, []);
  assert.match(
    r.pending[0],
    /^entire trail create --title Refused --body refused… --type task --branch refused --base main failed: trails are not enabled for gh\/acme\/web/,
  );
  assert.equal(trailOf(loadStore(store), rec('refused')), undefined);
  assert.equal(rec('refused').data.status, 'active');
  const none = reconcileTrail(store, 'change:web/refused', { entire: { bin: path.join(tmp, 'no-entire') } })!;
  assert.deepEqual(none.pending, [`no entire at ${path.join(tmp, 'no-entire')}`]);

  change(store, 'search', { name: 'Search', project: 'project:web', next: 'build it' });
  assert.equal(reconcileTrail(store, 'change:web/search', { entire: { bin } }), null, 'work has not started');
});

test('the sweep starts no Trail: it names the branch and the command, and --start starts that one and says it pushed', () => {
  step(store, 'change:search', 'start', 1, {});
  const made = () => calls().filter((c) => c[1] === 'create' && c[c.indexOf('--branch') + 1] === 'search').length;
  const swept = syncEntire(store, { entire: { bin } }).trails.find((t) => t.change === 'change:web/search')!;
  assert.equal(swept.unstarted, 'search');
  assert.equal(made(), 0, 'nothing created, so nothing pushed');
  assert.equal(trailOf(loadStore(store), rec('search')), undefined);
  assert.deepEqual(trailLines(swept), [
    'entire: change:web/search has no Trail: starting one pushes search to origin (pjman sync entire --start change:web/search)',
  ]);
  const started = syncEntire(store, { entire: { bin }, start: 'change:web/search' }).trails.find(
    (t) => t.change === 'change:web/search',
  )!;
  assert.deepEqual(started.acts, ['created']);
  assert.equal(started.pushed, 'search');
  assert.ok(trailLines(started).includes('entire: pushed search to origin (a Trail is created with its branch)'));
  assert.equal(made(), 1);
  assert.equal(reconcileTrail(store, 'change:web/search', { entire: { bin } })!.pushed, undefined, 'said once');
});

test('back at work the ready mark is taken back, and the next review marks the Trail again', () => {
  const n = trailOf(loadStore(store), rec('search'))!.state!.number;
  const fakeTrail = () => trails().find((t) => t.number === n)!;
  step(store, 'change:search', 'done', 1, {});
  assert.deepEqual(reconcileTrail(store, 'change:web/search', { entire: { bin } })!.acts, ['readied']);
  assert.equal(fakeTrail().ready, true);
  set(store, 'change:web/search', ['status=active'], {});
  assert.deepEqual(reconcileTrail(store, 'change:web/search', { entire: { bin } })!.acts, ['returned to draft']);
  assert.equal(fakeTrail().ready, false);
  assert.deepEqual(reconcileTrail(store, 'change:web/search', { entire: { bin } })!.acts, [], 'taken back once');
  set(store, 'change:web/search', ['status=review'], {});
  assert.deepEqual(reconcileTrail(store, 'change:web/search', { entire: { bin } })!.acts, ['readied']);
  assert.equal(fakeTrail().ready, true);
});

test("a Trail's key follows its own address where the project recorded no repository", () => {
  const web = loadStore(store).byKey.get('project:web')![0];
  const ext = { ...(web.data.ext as Record<string, unknown>) };
  delete ext.github;
  fs.writeFileSync(web.abs, render('project', { ...web.data, ext }, web.body));
  g('branch', 'norepo');
  change(store, 'norepo', { name: 'No repo', project: 'project:web', next: 'build it' });
  step(store, 'change:norepo', 'start', 1, {});
  const r = reconcileTrail(store, 'change:web/norepo', { entire: { bin } })!;
  assert.deepEqual(r.acts, ['created']);
  assert.equal(r.trail, `entire-trail:gh/acme/${r.state!.number}`);
});
