// A change's key decision (change:key-decisions): derived from the tree its decisions form (depends_on), the one the
// most others rest on, the earliest on a tie; a lone decision that plainly decides the change marked key by hand, one
// per change, the mark moving when another is marked, and the tree overriding a hand mark it leaves out, said.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { decision } from '../ops/decision.js';
import { set } from '../ops/set.js';
import { changeContext, formatChangeContext, show } from '../model/view.js';
import { keyDecisionOf } from '../model/key-decision.js';
import { proposedDecisions } from '../model/scope.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-key-decision-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'agent:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const errors = (store: Store) => validate(loadStore(store)).filter((p) => p.level === 'error');
let store: Store;

const open = (ref: string, extra: Partial<Parameters<typeof decision>[2]> = {}) =>
  decision(store, ref, {
    name: 'A choice',
    gist: 'What is chosen',
    entries: [
      { type: 'question', text: 'Which?' },
      { type: 'option', id: 'a', text: 'A' },
      { type: 'option', id: 'b', text: 'B' },
    ],
    ...extra,
  });
const key = (c: string) => keyDecisionOf(loadStore(store), `change:project/${c}`);
const thread = (k: string) => loadStore(store).byKey.get(k)![0].data.thread as { type: string; text?: string }[];

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
  init({ cwd: project });
  store = findStore(project)!;
  change(store, 'ids', { title: 'Normalize ids' });
  change(store, 'lone', { title: 'Lone' });
  change(store, 'none', { title: 'None' });
});

test('a change whose decisions name nothing they rest on has no key decision', () => {
  open('ids/naming');
  assert.equal(key('ids'), undefined);
  open('none/minor');
  assert.equal(key('none'), undefined);
});

test('the decision the most others rest on is key, through any path; the tree is read by context and the API', () => {
  open('ids/uid-type', { created: '2026-01-01' });
  open('ids/backfill', { dependsOn: ['ids/uid-type'] });
  set(store, 'decision:project/ids/naming', ['depends_on+=decision:ids/backfill'], {});
  const k = key('ids')!;
  assert.equal(k.key, 'decision:project/ids/uid-type');
  assert.equal(k.how, 'tree');
  assert.deepEqual(k.dependents, ['decision:project/ids/backfill', 'decision:project/ids/naming']);
  const c = changeContext(store, 'change:project/ids');
  assert.equal(c.keyDecision?.key, 'decision:project/ids/uid-type');
  assert.equal(c.decisions[0].key, 'decision:project/ids/uid-type');
  assert.equal(c.decisions[0].keyed?.dependents, 2);
  assert.ok(!c.decisions[1].keyed);
  const text = formatChangeContext(c);
  assert.match(text, /## Key decision\n\ndecision:project\/ids\/uid-type/);
  assert.match(text, /2 decisions on the change rest on it/);
  assert.ok(text.indexOf('## Key decision') > text.indexOf('## Intent') || !text.includes('## Intent'));
  assert.ok(proposedDecisions(loadStore(store)).find((d) => d.key === 'decision:project/ids/uid-type')?.keyed);
  assert.equal(errors(store).length, 0);
});

test('depends_on refuses itself, a non-decision and a cycle', () => {
  assert.throws(() => decision(store, 'ids/uid-type', { entries: [], dependsOn: ['ids/uid-type'] }), /itself/);
  assert.throws(() => decision(store, 'ids/uid-type', { entries: [], dependsOn: ['change:ids'] }), /not a decision/);
  assert.throws(() => decision(store, 'ids/uid-type', { entries: [], dependsOn: ['ids/naming'] }), /cycles/);
  assert.equal(errors(store).length, 0);
});

test('a hand mark is refused while the tree names another decision key', () => {
  assert.throws(
    () => decision(store, 'ids/naming', { entries: [{ type: 'key', text: 'it matters' }] }),
    /the tree names decision:project\/ids\/uid-type key/,
  );
});

test('a lone decision is marked key by hand with its reason, and unmarked', () => {
  open('lone/storage');
  open('lone/flag-name');
  decision(store, 'lone/storage', { entries: [{ type: 'key', text: 'decided otherwise, a different change' }] });
  const k = key('lone')!;
  assert.equal(k.key, 'decision:project/lone/storage');
  assert.equal(k.how, 'mark');
  assert.equal(k.why, 'decided otherwise, a different change');
  assert.throws(() => decision(store, 'lone/storage', { entries: [{ type: 'key', text: 'again' }] }), /already marked/);
  assert.throws(() => decision(store, 'lone/flag-name', { entries: [{ type: 'unkey', text: 'no' }] }), /not marked/);
  assert.equal(errors(store).length, 0);
});

test('marking another decision on the change moves the mark, recorded on both threads in one commit', () => {
  decision(store, 'lone/flag-name', { entries: [{ type: 'key', text: 'this is what it rests on' }] });
  assert.equal(key('lone')!.key, 'decision:project/lone/flag-name');
  const unkey = thread('decision:project/lone/storage').at(-1)!;
  assert.equal(unkey.type, 'unkey');
  assert.match(unkey.text!, /moved to decision:project\/lone\/flag-name: this is what it rests on/);
  const files = git(store.root, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.equal(files.length, 2);
  assert.equal(errors(store).length, 0);
  decision(store, 'lone/flag-name', { entries: [{ type: 'unkey', text: 'it was not' }] });
  assert.equal(key('lone'), undefined);
});

test('a tree that forms past a hand mark decides, and the conflict is said', () => {
  decision(store, 'lone/storage', { entries: [{ type: 'key', text: 'pivotal' }] });
  open('lone/third', { dependsOn: ['lone/flag-name'] });
  const k = key('lone')!;
  assert.equal(k.key, 'decision:project/lone/flag-name');
  assert.equal(k.conflict?.key, 'decision:project/lone/storage');
  const text = formatChangeContext(changeContext(store, 'change:project/lone'));
  assert.match(text, /note: decision:project\/lone\/storage is marked key by hand, but the tree names/);
});

test('a superseded decision is never key', () => {
  open('none/replacement', { supersedes: 'decision:none/minor' });
  open('none/after', { dependsOn: ['decision:none/minor'] });
  assert.equal(key('none'), undefined);
});

test('a decision that supersedes the hand-marked one takes the mark in one write; the superseded is left as superseded', () => {
  change(store, 'swap', { title: 'Swap' });
  open('swap/first');
  decision(store, 'swap/first', { entries: [{ type: 'key', text: 'pivotal' }] });
  decision(store, 'swap/second', {
    name: 'Second',
    gist: 'What replaces the first',
    entries: [
      { type: 'question', text: 'Which?' },
      { type: 'option', id: 'a', text: 'A' },
      { type: 'key', text: 'it replaces the pivotal one' },
    ],
    supersedes: 'decision:swap/first',
  });
  const loaded = loadStore(store);
  assert.equal(loaded.byKey.get('decision:project/swap/first')![0].data.status, 'superseded');
  assert.equal(thread('decision:project/swap/first').at(-1)!.type, 'key');
  assert.equal(key('swap')!.key, 'decision:project/swap/second');
  assert.equal(errors(store).length, 0);
});

test('a mark given and taken back in one call moves nothing', () => {
  change(store, 'both', { title: 'Both' });
  open('both/one');
  open('both/two');
  decision(store, 'both/one', { entries: [{ type: 'key', text: 'pivotal' }] });
  decision(store, 'both/two', {
    entries: [
      { type: 'key', text: 'maybe' },
      { type: 'unkey', text: 'no' },
    ],
  });
  assert.equal(key('both')!.key, 'decision:project/both/one');
  assert.equal(thread('decision:project/both/one').at(-1)!.type, 'key');
});

test('show names the key decision on its change and on the decision itself', () => {
  assert.match(
    show(store, 'change:ids').text,
    /## Key decision\n\ndecision:project\/ids\/uid-type\n2 decisions on the change rest on it/,
  );
  assert.match(show(store, 'decision:ids/uid-type').text, /the key decision of change:project\/ids/);
  assert.doesNotMatch(show(store, 'decision:ids/naming').text, /Key decision/);
  assert.equal(show(store, 'change:ids').keyDecision?.key, 'decision:project/ids/uid-type');
  assert.equal(show(store, 'decision:ids/naming').keyDecision, undefined);
});
