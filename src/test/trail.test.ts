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
import { readEvents } from '../store/events.js';
import { git } from '../store/git.js';
import { repoOf } from '../model/refs.js';
import { loadStore } from '../store/records.js';
import { syncEntire } from '../sync/entire.js';
import { gatesPast, reconcileTrail, trailLines, trailMoves, trailOf } from '../sync/trail.js';
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

/** The command itself, as a person runs it in the project's folder. */
const cli = (...args: string[]) => {
  try {
    const out = execFileSync(process.execPath, [path.join(import.meta.dirname, '../../bin/pjman.js'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PJMAN_ENTIRE_BIN: bin },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: err.stdout + err.stderr };
  }
};

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
  changes: t.branch === '' && t.change === 'draft' ? [] : [{ repository: 'web', number: t.number, branch: t.change === 'merged' ? '' : t.branch, status: t.change,
    url: 'https://entire.com/gh/acme/-/trails/' + t.number + '/changes/web/' + t.number,
    ...(gates ? { mergeability: { mergeable: t.gates.every((x) => x.status === 'passed'), gates: t.gates } } : {}) }],
});
const pick = () => {
  const b = flag('--branch');
  const n = args.slice(2).find((a) => /^\\d+$/.test(a));
  if (!b && flag('--project') && flag('--project') !== 'gh/acme') return undefined;
  return state.find((t) => (b ? t.branch === b : String(t.number) === n));
};
if (args[0] !== 'trail') fail('unknown command');
if (args[1] === 'show') {
  const t = pick();
  if (!t) fail('branch "' + flag('--branch') + '" has no discoverable project trail; pass a project trail ID with --project');
  console.log(JSON.stringify(show(t, true)));
} else if (args[1] === 'list') {
  if (!args.includes('--mine') && !flag('--project')) fail('--project is required');
  if (fs.existsSync(${JSON.stringify(path.join(tmp, 'nolist'))})) fail('the server did not answer (503)');
  const item = (t) => ({ id: t.id, number: t.number, title: t.title, body: t.body, status: t.status });
  const asked = state.filter((t) => !flag('--status') || t.status === flag('--status'));
  if (args.includes('--mine')) {
    if (flag('--page-token')) fail('--mine takes no --page-token');
    // (a person with a full page of open Trails elsewhere: this project's are past it)
    const full = fs.existsSync(${JSON.stringify(path.join(tmp, 'fullpage'))});
    const items = full
      ? Array.from({ length: Number(flag('--limit')) }, (_, i) => ({ id: 'ELSE' + i, number: 1000 + i, title: 'Elsewhere', body: '', status: 'open',
          project: { reference: { forge: 'gh', project: 'other' } } }))
      : asked.map((t) => ({ ...item(t), project: { reference: { forge: 'gh', project: 'acme' } } }));
    console.log(JSON.stringify({ items, partial: fs.existsSync(${JSON.stringify(path.join(tmp, 'partial'))}) ? ['eu'] : [] }));
  } else {
    // the project's own list, a page of two at a time
    const at = Number(flag('--page-token') ?? 0);
    console.log(JSON.stringify({ items: asked.slice(at, at + 2).map(item), nextPageToken: at + 2 < asked.length ? String(at + 2) : null }));
  }
} else if (args[1] === 'link') {
  const t = state.find((x) => String(x.number) === args[2]);
  if (!t) fail('no trail ' + args[2]);
  if (fs.existsSync(${JSON.stringify(path.join(tmp, 'nolink'))})) fail('branch "' + flag('--branch') + '" is not on the remote');
  if (fs.existsSync(${JSON.stringify(path.join(tmp, 'badlink'))})) { console.log('linked, perhaps'); process.exit(0); }
  t.branch = flag('--branch'); save();
  console.log(JSON.stringify(show(t, false)));
} else if (args[1] === 'create') {
  if (flag('--branch').startsWith('refused')) fail('trails are not enabled for gh/acme/web; an admin can turn them on');
  if (flag('--branch') === 'half' && !state.some((t) => t.title === flag('--title'))) {
    // the Trail is made, its branch is not linked, and the answer never comes
    state.push({ number: state.length + 1, id: '01TRAIL' + (state.length + 1), title: flag('--title'), body: flag('--body'),
      status: 'open', phase: 'planning', branch: '', change: 'draft', ready: false, gates: [], open: 0 });
    save();
    // (held past the caller's patience: the caller gives up, as it did on the real Entire)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
    process.exit(0);
  }
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
  for (const b of ['cart', 'search', 'gone', 'adopted', 'refused', 'half']) g('branch', b);
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
  // the opt-in is said first, before anything about the change named to start
  assert.throws(() => syncEntire(store, { entire: { bin }, start: 'change:nowhere' }), /has not opted in to Entire/);
  const off = cli('sync', 'entire', '--start', 'nowhere');
  assert.equal(off.code, 1);
  assert.match(off.out, /has not opted in to Entire/);
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
  // (its gates had passed when they were last read: a merge through them)
  assert.deepEqual(r.moved, ['its branch was merged']);
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

test('--start takes a change by any form that names it: the slug, the short key, the full key', () => {
  const forms: [string, (slug: string) => string][] = [
    ['by-slug', (slug) => slug],
    ['by-short', (slug) => `change:${slug}`],
    ['by-full', (slug) => `change:web/${slug}`],
  ];
  for (const [slug, named] of forms) {
    g('branch', slug);
    change(store, slug, { name: slug, project: 'project:web', next: 'build it' });
    step(store, `change:${slug}`, 'start', 1, {});
    const started = syncEntire(store, { entire: { bin }, start: named(slug) }).trails.find(
      (t) => t.change === `change:web/${slug}`,
    )!;
    assert.deepEqual(started.acts, ['created'], slug);
    assert.equal(started.pushed, slug);
    assert.ok(trailOf(loadStore(store), rec(slug)), slug);
  }
});

test('the command starts a Trail by the short key its own hint prints, and refuses an empty or unknown name', () => {
  g('branch', 'by-command');
  change(store, 'by-command', { name: 'By command', project: 'project:web', next: 'build it' });
  step(store, 'change:by-command', 'start', 1, {});
  const hint = cli('sync', 'entire')
    .out.split('\n')
    .find((l) => l.includes('by-command has no Trail'))!;
  assert.match(hint, /\(pjman sync entire --start change:by-command\)$/);
  const started = cli('sync', 'entire', '--start', 'change:by-command');
  assert.equal(started.code, 0, started.out);
  assert.match(started.out, /entire: change:by-command created · /);
  assert.match(started.out, /entire: pushed by-command to origin/);
  assert.ok(trailOf(loadStore(store), rec('by-command')));
  const made = calls().filter((c) => c[1] === 'create').length;
  const empty = cli('sync', 'entire', '--start=');
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.out, /--start was given no change/);
  const unknown = cli('sync', 'entire', '--start', 'nowhere');
  assert.equal(unknown.code, 1, unknown.out);
  assert.match(unknown.out, /nowhere resolves to no change/);
  assert.equal(calls().filter((c) => c[1] === 'create').length, made);
});

test('--start refuses a name that reaches no change, and a change that gets no Trail, each with its reason', () => {
  g('branch', 'unnamed');
  change(store, 'unnamed', { name: 'Unnamed', project: 'project:web', next: 'build it' });
  step(store, 'change:unnamed', 'start', 1, {});
  const made = () => calls().filter((c) => c[1] === 'create').length;
  const before = made();
  const refused = (start: string, why: RegExp) =>
    assert.throws(() => syncEntire(store, { entire: { bin }, start }), why, start);
  refused('change:nowhere', /change:nowhere is not a change: --start takes the change whose Trail to start/);
  refused(' ', /--start takes the change whose Trail to start: it was given no name/);
  refused('nowhere', /nowhere resolves to no change/);
  // a name two changes answer to is refused naming both; a store with no kind for a Trail says that
  for (const twin of ['twin-a', 'twin-b']) {
    change(store, twin, { name: twin, project: 'project:web', next: 'build it' });
    const at = rec(twin);
    fs.writeFileSync(at.abs, fs.readFileSync(at.abs, 'utf8').replace(/^name: /m, 'aliases:\n  - twin\nname: '));
  }
  refused('change:twin', /change:web\/twin-a.*change:web\/twin-b/);
  for (const twin of ['twin-a', 'twin-b']) {
    const at = rec(twin);
    fs.writeFileSync(at.abs, fs.readFileSync(at.abs, 'utf8').replace('aliases:\n  - twin\n', ''));
  }
  const kindless = {
    ...store,
    config: { ...store.config, source_kinds: store.config.source_kinds.filter((k) => k !== 'entire-trail') },
  };
  assert.throws(
    () => syncEntire(kindless, { entire: { bin }, start: 'change:unnamed' }),
    /change:web\/unnamed gets no Trail from --start: the store has no entire-trail source kind/,
  );
  refused('project:web', /project:web is a project; --start takes a change/);
  // work not started, a milestone, a change that has ended, another project's, a record that does not validate
  change(store, 'idle', { name: 'Idle', project: 'project:web', next: 'build it' });
  refused('change:idle', /change:web\/idle gets no Trail from --start: work has not started on it \(status planning\)/);
  change(store, 'goal', { name: 'Goal', project: 'project:web', kind: 'milestone' });
  refused('change:goal', /change:web\/goal gets no Trail from --start: it is a milestone/);
  change(store, 'over', { name: 'Over', project: 'project:web', next: 'build it' });
  set(store, 'change:over', ['status=done'], {});
  refused('change:over', /change:web\/over gets no Trail from --start: the change has ended \(status done\)$/);
  const idle = rec('idle');
  const text = fs.readFileSync(idle.abs, 'utf8');
  fs.writeFileSync(idle.abs, text.replace('project: project:web', 'project: project:elsewhere'));
  refused(
    'change:idle',
    /change:web\/idle gets no Trail from --start: it belongs to project:elsewhere, not project:web/,
  );
  fs.writeFileSync(idle.abs, text.replace(/^name: .*$/m, 'name: [unclosed'));
  assert.equal(rec('idle').valid, false);
  refused('change:idle', /change:web\/idle gets no Trail from --start: its record does not validate/);
  fs.writeFileSync(idle.abs, text);
  assert.equal(made(), before);
  assert.equal(trailOf(loadStore(store), rec('unnamed')), undefined);
  // one at work with no branch of its own is said, where the sweep alone would pass it over
  change(store, 'branchless', { name: 'Branchless', project: 'project:web', next: 'build it' });
  step(store, 'change:branchless', 'start', 1, {});
  assert.deepEqual(
    syncEntire(store, { entire: { bin }, start: 'change:branchless' }).pending.filter((p) => p.includes('branchless')),
    [
      'change:web/branchless was not started: no branch of its own was found in this repository; create a branch named for it and run this again',
    ],
  );
  // git not listing the branches is said as that, never as a branch to create
  const gitless = { ...store, projectDir: path.join(tmp, 'not-a-repo') };
  fs.mkdirSync(gitless.projectDir, { recursive: true });
  let why = '';
  assert.equal(reconcileTrail(gitless, 'change:web/branchless', { entire: { bin }, whyNot: (r) => (why = r) }), null);
  assert.match(why, /^git did not list this repository's branches \(.+\), so its branch was not looked for$/);
  set(store, 'change:branchless', ['status=dropped'], {});
  // with --wake the change named is still read, and it is read first: nothing ahead of it uses up the run's time
  const at = calls().length;
  const woken = syncEntire(store, { entire: { bin }, start: 'change:unnamed', wake: true });
  assert.deepEqual(woken.trails[0].change, 'change:web/unnamed');
  assert.deepEqual(woken.trails[0].acts, ['created']);
  assert.deepEqual(calls()[at].slice(0, 4), ['trail', 'show', '--branch', 'unnamed']);
  assert.equal(made(), before + 1);
});

test('--start on a change whose own Trail was closed reads it again: still closed is said with the way on', () => {
  const n = trailOf(loadStore(store), rec('unnamed'))!.state!.number;
  edit(n, (t) => (t.status = 'closed'));
  reconcileTrail(store, 'change:web/unnamed', { entire: { bin } });
  assert.equal(trailOf(loadStore(store), rec('unnamed'))!.state!.status, 'closed');
  const closed = syncEntire(store, { entire: { bin }, start: 'change:unnamed' });
  assert.ok(
    closed.pending.includes(
      `change:web/unnamed was not started: its Trail #${n} is closed; reopen it on Entire (entire trail update ${n} --status open) and run this again`,
    ),
    closed.pending.join('\n'),
  );
  // reopened on Entire, it is taken up again by the same command
  edit(n, (t) => (t.status = 'open'));
  const reopened = syncEntire(store, { entire: { bin }, start: 'change:unnamed' });
  assert.deepEqual(
    reopened.pending.filter((p) => p.includes('unnamed')),
    [],
  );
  assert.equal(trailOf(loadStore(store), rec('unnamed'))!.state!.status, 'open');
  set(store, 'change:unnamed', ['status=dropped'], {});
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

test('a create that made the Trail and never answered is not followed by a second: the branch is linked to that Trail', () => {
  change(store, 'half', { title: 'Half made', summary: 's', project: 'project:web', next: 'build it' });
  step(store, 'change:half', 'start', 1, {});
  const half = () => trails().filter((t) => t.title === 'Half made');
  const mark = () => (rec('half').data.ext as { entire?: { create_unanswered?: string } } | undefined)?.entire;
  // Entire makes the Trail and does not answer in time: the change remembers that it asked
  // (the budget is spent in full, waiting on the create: wide enough that a loaded machine has sent it, and the
  // stand-in has saved the Trail, well before it runs out)
  const first = reconcileTrail(store, 'change:web/half', { entire: { bin }, budget: 4000 })!;
  assert.match(first.pending[0], /did not answer in time/);
  assert.deepEqual([first.acts, first.trail, first.down], [[], undefined, undefined]);
  assert.deepEqual([half().length, half()[0].branch], [1, '']);
  assert.ok(mark()?.create_unanswered);
  // while the list cannot be read, nothing is created on a guess
  fs.writeFileSync(path.join(tmp, 'nolist'), '');
  const blind = reconcileTrail(store, 'change:web/half', { entire: { bin } })!;
  assert.deepEqual([blind.acts, blind.trail], [[], undefined]);
  assert.match(blind.pending[0], /the server did not answer/);
  fs.rmSync(path.join(tmp, 'nolist'));
  // nor while a region was not reached: the Trail may be in it
  fs.writeFileSync(path.join(tmp, 'partial'), '');
  const partial = reconcileTrail(store, 'change:web/half', { entire: { bin } })!;
  assert.deepEqual([partial.acts, partial.trail], [[], undefined]);
  assert.deepEqual(partial.pending, [
    'entire trail list --mine did not reach every region (eu): the Trail made for change:web/half may be in one',
  ]);
  fs.rmSync(path.join(tmp, 'partial'));
  // a link that is refused says the way out, and still creates no second Trail
  fs.writeFileSync(path.join(tmp, 'nolink'), '');
  const refused = reconcileTrail(store, 'change:web/half', { entire: { bin } })!;
  assert.match(
    refused.pending[0],
    /^Trail #\d+ was made for change:web\/half without its branch, and linking half to it failed \(.*not on the remote\): push the branch \(git push origin half\) .* or close that Trail/,
  );
  assert.match(refused.pending[0], /entire trail update \d+ --project gh\/acme --status closed/);
  fs.rmSync(path.join(tmp, 'nolink'));
  // a link whose answer cannot be read may have landed: what Entire said is passed on, with no advice to push or close
  fs.writeFileSync(path.join(tmp, 'badlink'), '');
  const unread = reconcileTrail(store, 'change:web/half', { entire: { bin } })!;
  assert.deepEqual(unread.pending, [
    `entire trail link ${half()[0].number} --branch half --base main --project gh/acme answered something that is not JSON`,
  ]);
  fs.rmSync(path.join(tmp, 'badlink'));
  assert.equal(half().length, 1);
  // only open Trails are asked for, and the Trail is shown and linked in the project it was listed in
  const asked = calls().slice(-3);
  assert.deepEqual(asked[0], ['trail', 'list', '--mine', '--status', 'open', '--limit', '100', '--json']);
  assert.deepEqual(asked[1].slice(0, 2).concat(asked[1].slice(-3)), [
    'trail',
    'show',
    '--project',
    'gh/acme',
    '--json',
  ]);
  assert.deepEqual(asked[2].slice(-3), ['--project', 'gh/acme', '--json']);
  // the next run finds the Trail by the change's key, sees it has no branch, and links this one to it
  const r = reconcileTrail(store, 'change:web/half', { entire: { bin } })!;
  assert.deepEqual(r.acts.slice(0, 1), ['linked']);
  assert.equal(r.pushed, undefined, 'a link pushes nothing');
  assert.equal(r.trail, `entire-trail:gh/acme/${half()[0].number}`);
  assert.deepEqual([half().length, half()[0].branch], [1, 'half']);
  // one create was ever asked for this change, and the mark has done its work
  assert.equal(calls().filter((c) => c[1] === 'create' && c.includes('Half made')).length, 1);
  assert.equal(mark(), undefined);
  // (taken off in the write that bound the Trail, and said so: the event names both fields)
  assert.deepEqual(
    readEvents(store)
      .filter((e) => e.key === 'change:web/half' && e.fields?.includes('binds'))
      .map((e) => e.fields),
    [['binds', 'ext']],
  );
  // a Trail of the change that already holds another branch is not the half-made one: it is left alone
  g('branch', 'half-two');
  change(store, 'half-two', { title: 'Half two', summary: 's', project: 'project:web', next: 'build it' });
  step(store, 'change:half-two', 'start', 1, {});
  set(store, 'change:half-two', [`ext.entire.create_unanswered=${new Date().toISOString()}`], {});
  const other = trails();
  other.push({
    ...other[0],
    number: other.length + 1,
    id: 'OTHER',
    title: 'Elsewhere',
    body: 'x\n\npjman: change:web/half-two',
    branch: 'elsewhere',
    change: 'open',
    status: 'open',
  });
  // nor is one whose branch was merged, though Entire shows its change with no branch
  other.push({
    ...other[0],
    number: other.length + 1,
    id: 'MERGED',
    title: 'Merged before',
    body: 'x\n\npjman: change:web/half-two',
    branch: 'before',
    change: 'merged',
    status: 'open',
  });
  fs.writeFileSync(stateFile, JSON.stringify(other));
  const two = reconcileTrail(store, 'change:web/half-two', { entire: { bin } })!;
  assert.deepEqual(two.acts.slice(0, 1), ['created']);
  assert.equal(trails().find((t) => t.id === 'OTHER')!.branch, 'elsewhere');
  assert.equal(trails().find((t) => t.id === 'MERGED')!.branch, 'before');
  assert.ok(!calls().some((c) => c[1] === 'link' && c.includes('half-two')), 'nothing was linked');
});

test('with a full page of open Trails, the half-made one is looked for through the project’s own list to its end', () => {
  g('branch', 'paged');
  change(store, 'paged', { name: 'Paged', project: 'project:web', next: 'build it' });
  step(store, 'change:paged', 'start', 1, {});
  set(store, 'change:paged', [`ext.entire.create_unanswered=${new Date().toISOString()}`], {});
  const all = trails();
  const n = all.length + 1;
  all.push({
    ...all[0],
    number: n,
    id: 'PAGED',
    title: 'Paged',
    body: 'x\n\npjman: change:web/paged',
    branch: '',
    change: 'draft',
    status: 'open',
    phase: 'planning',
  });
  fs.writeFileSync(stateFile, JSON.stringify(all));
  fs.writeFileSync(path.join(tmp, 'fullpage'), '');
  const from = calls().length;
  try {
    // (the project records no repository here: its own list is asked for by the project its earlier Trails are in)
    assert.equal(repoOf(loadStore(store), store.project), undefined);
    const r = reconcileTrail(store, 'change:web/paged', { entire: { bin } })!;
    assert.deepEqual(r.acts.slice(0, 1), ['linked']);
    assert.equal(trails().find((t) => t.id === 'PAGED')!.branch, 'paged');
    assert.equal(calls().filter((c) => c[1] === 'create' && c.includes('Paged')).length, 0);
    const lists = calls()
      .slice(from)
      .filter((c) => c[1] === 'list' && c.includes('--project'));
    assert.ok(lists.length > 1, 'more than one page was read');
    assert.ok(lists.every((c) => c[c.indexOf('--project') + 1] === 'gh/acme' && c.includes('open')));
    assert.deepEqual(
      lists.map((c) => (c.includes('--page-token') ? c[c.indexOf('--page-token') + 1] : null)).slice(0, 2),
      [null, '2'],
    );
  } finally {
    fs.rmSync(path.join(tmp, 'fullpage'));
  }
});

test('a mark that cannot be written is said: the next run would not look for the Trail a create may have made', () => {
  g('branch', 'refused-two');
  change(store, 'refused-two', { name: 'Refused', project: 'project:web', next: 'build it' });
  step(store, 'change:refused-two', 'start', 1, {});
  // the store cannot be committed to while the create is refused: the write of the mark fails
  const held = path.join(git(store.root, ['rev-parse', '--absolute-git-dir']), 'index.lock');
  fs.writeFileSync(held, '');
  try {
    const r = reconcileTrail(store, 'change:web/refused-two', { entire: { bin } })!;
    assert.equal(r.pending.length, 2, r.pending.join('\n'));
    assert.match(r.pending[0], /^entire trail create .* failed: trails are not enabled/);
    assert.match(
      r.pending[1],
      /^the mark that change:web\/refused-two asked Entire for a Trail may not have been kept \(.+\): Entire may have made one without its branch, and a run that finds no mark would make another\. Look first \(entire trail list --mine --status open\) and link it \(entire trail link <n> --branch refused-two --base main\)$/s,
    );
  } finally {
    fs.rmSync(held, { force: true });
  }
});

test('a merge that went past a gate is said as that: a merge made on GitHub does not wait for the Trail', () => {
  const open = {
    id: '01T',
    number: 9,
    status: 'open',
    change: { number: 9, status: 'open' },
    gates: [
      { key: 'approvals', status: 'pending', blocking: true },
      { key: 'findings', status: 'failed', blocking: true },
      { key: 'checks', status: 'passed', blocking: true },
      { key: 'advice', status: 'pending', blocking: false },
    ],
  };
  const merged = { ...open, change: { number: 9, status: 'merged' }, gates: [] };
  const said =
    "its branch was merged, and the approvals, findings gates were not passed when last read: a merge made on GitHub does not wait for the Trail's gates, one made on Entire does";
  assert.deepEqual(trailMoves(open, merged), [said]);
  const passed = { ...open, gates: open.gates.map((g) => ({ ...g, status: 'passed' })) };
  assert.deepEqual(trailMoves(passed, merged), ['its branch was merged']);
  // said once: a Trail already read as merged does not say it again
  assert.deepEqual(trailMoves(merged, merged), []);
  // only a status known to hold a merge is named: not one skipped (the gate did not apply), nor one that could not
  // be read, nor one pjman does not know
  const other = {
    ...open,
    gates: [
      { key: 'checks', status: 'skipped', blocking: true },
      { key: 'base_checks', status: '?', blocking: true },
      { key: 'later', status: 'not_applicable', blocking: true },
    ],
  };
  assert.deepEqual(trailMoves(other, merged), ['its branch was merged']);
  const one = { ...open, gates: [...other.gates, { key: 'findings', status: 'error', blocking: true }] };
  assert.deepEqual(gatesPast(one, merged), ['findings']);
  // a merge the command itself made through the Trail went past no gate, whatever an earlier read kept
  assert.deepEqual(trailMoves(open, merged, true), ['its branch was merged']);
  assert.deepEqual(gatesPast(open, merged, true), []);
});

test('a merge read with a gate still held is noted on the change by whoever read it; pjman merge through the Trail is not', () => {
  const notes = (slug: string) => rec(slug).sections.get('Notes') ?? '';
  const start = (slug: string) => {
    g('branch', slug);
    change(store, slug, { name: slug, project: 'project:web', next: 'build it' });
    step(store, `change:${slug}`, 'start', 1, {});
    const r = reconcileTrail(store, `change:web/${slug}`, { entire: { bin } })!;
    assert.deepEqual(r.acts, ['created']);
    step(store, `change:${slug}`, 'done', 1, {});
    reconcileTrail(store, `change:web/${slug}`, { entire: { bin } });
    return r.state!.number;
  };
  // merged on GitHub while approvals was pending: a plain reconcile (pjman set, pjman step, pjman sync entire) notes it
  const n = start('past');
  edit(n, (t) => (t.change = 'merged'));
  const r = reconcileTrail(store, 'change:web/past', { entire: { bin } })!;
  const line =
    "its branch was merged, and the approvals gate was not passed when last read: a merge made on GitHub does not wait for the Trail's gates, one made on Entire does";
  assert.deepEqual(r.moved, [line]);
  assert.equal(r.noted, line);
  assert.ok(notes('past').includes(`Entire, Trail #${n}: ${line}`), 'on the record');
  assert.equal(reconcileTrail(store, 'change:web/past', { entire: { bin } })!.noted, undefined, 'noted once');
  assert.equal(notes('past').split(line).length, 2);

  // the follower notes what else moved and does not write that line twice
  const w = start('woken');
  edit(w, (t) => (t.change = 'merged'));
  const swept = syncEntire(store, { entire: { bin }, wake: true }).trails.find((t) => t.change === 'change:web/woken')!;
  assert.equal(swept.noted, line);
  assert.equal(notes('woken').split(line).length, 2, 'one note, not two');

  // a stale read: the gate passed after it and pjman merge went through the Trail, so nothing is said to be past
  const s = start('stale');
  edit(s, (t) => (t.change = 'merged'));
  const through = reconcileTrail(store, 'change:web/stale', { entire: { bin }, through: true })!;
  assert.deepEqual(through.moved, ['its branch was merged']);
  assert.equal(through.noted, undefined);
  assert.ok(!notes('stale').includes('not passed when last read'));
});

test('pjman sync git prints what the Trail of a change it ended says, and carries it in its JSON', () => {
  const start = (slug: string) => {
    g('switch', '-q', '-c', slug, 'main');
    g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', `feat: ${slug}`);
    g('switch', '-q', 'main');
    change(store, slug, { name: slug, project: 'project:web', next: 'build it' });
    step(store, `change:${slug}`, 'start', 1, {});
    const number = reconcileTrail(store, `change:web/${slug}`, { entire: { bin } })!.state!.number;
    step(store, `change:${slug}`, 'done', 1, {});
    reconcileTrail(store, `change:web/${slug}`, { entire: { bin } });
    // the pull request is merged on GitHub, which does not wait for the Trail
    g('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', slug, '-m', `Merge ${slug}`);
    edit(number, (t) => (t.change = 'merged'));
    return number;
  };
  const n = start('forge');
  const r = cli('sync', 'git');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 change merged into main and set done/);
  assert.match(
    r.out,
    new RegExp(
      `entire: change:forge closed · Trail #${n} closed[^\\n]*\\nentire: its branch was merged, and the approvals gate was not passed when last read`,
    ),
  );
  assert.ok((rec('forge').sections.get('Notes') ?? '').includes('the approvals gate was not passed when last read'));
  const m = start('forge-json');
  const j = JSON.parse(cli('sync', 'git', '--json').out) as { trails: { change: string; noted?: string }[] };
  assert.equal(j.trails.length, 1);
  assert.equal(j.trails[0].change, 'change:web/forge-json');
  assert.match(j.trails[0].noted ?? '', /the approvals gate was not passed when last read/);
  assert.equal(trails().find((t) => t.number === m)!.status, 'closed');
});
