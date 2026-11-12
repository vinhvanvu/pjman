// A decision made later retires the proposals it overtook: supersedes is settable on a decision, only grows, and each
// target is marked superseded in the same commit (change:retire-a-decision).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { set } from '../ops/set.js';
import { changeContext, decisionLine } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents } from '../store/events.js';
import { loadStore } from '../store/records.js';
import { supersededBy, supersedesOf } from '../model/supersede.js';
import { validate } from '../model/validate.js';
import { change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-supersede-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const errors = (store: Store) => validate(loadStore(store)).filter((p) => p.level === 'error');
const status = (store: Store, key: string) => loadStore(store).byKey.get(key)![0].data.status;

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
  init({ checkers: [], cwd: project });
  store = findStore(project)!;
  change(store, 'sup', { title: 'Supersession' });
  decisionRec(store, 'sup/old-one', { title: 'Old one', decision: 'a', why: 'b' });
  decisionRec(store, 'sup/old-two', { title: 'Old two', decision: 'a', why: 'b' });
  decisionRec(store, 'sup/newer', { title: 'Newer', decision: 'a', why: 'b', decidedBy: 'person:tester' });
  decisionRec(store, 'sup/third', { title: 'Third', decision: 'a', why: 'b' });
});

test('set supersedes marks the proposed target superseded in the same commit and records both events', () => {
  const r = set(store, 'decision:project/sup/newer', ['supersedes=decision:sup/old-one'], {});
  assert.deepEqual(r.changed, ['supersedes']);
  assert.deepEqual(r.notes, ['decision:project/sup/old-one is now superseded']);
  assert.ok(r.commit);
  const loaded = loadStore(store);
  assert.deepEqual(supersedesOf(loaded.byKey.get('decision:project/sup/newer')![0].data), [
    'decision:project/sup/old-one',
  ]);
  assert.equal(status(store, 'decision:project/sup/old-one'), 'superseded');
  assert.equal(errors(store).length, 0);
  // one commit touched both files
  const shown = git(store.root, 'show', '--stat', '--format=%s', 'HEAD');
  assert.match(shown, /pjman: set decision:project\/sup\/newer supersedes/);
  assert.match(shown, /old-one\.md/);
  assert.match(shown, /newer\.md/);
  const events = readEvents(store).slice(-2);
  assert.deepEqual(
    events.map((e) => [e.op, e.key, e.fields?.join(',')]),
    [
      ['set', 'decision:project/sup/newer', 'supersedes'],
      ['set', 'decision:project/sup/old-one', 'status'],
    ],
  );
  assert.deepEqual(
    supersededBy(loaded, 'decision:project/sup/old-one').map((x) => x.key),
    ['decision:project/sup/newer'],
  );
});

test('a second set appends: the list grows and the new target is marked; a key already there is a no-op', () => {
  set(store, 'decision:project/sup/newer', ['supersedes=decision:sup/old-two,decision:sup/old-one'], {});
  const loaded = loadStore(store);
  assert.deepEqual(supersedesOf(loaded.byKey.get('decision:project/sup/newer')![0].data), [
    'decision:project/sup/old-one',
    'decision:project/sup/old-two',
  ]);
  assert.equal(status(store, 'decision:project/sup/old-two'), 'superseded');
  assert.equal(errors(store).length, 0);
  const ctx = changeContext(store, 'change:project/sup');
  const newer = ctx.decisions.find((d) => d.key === 'decision:project/sup/newer')!;
  assert.match(decisionLine(newer), /supersedes decision:project\/sup\/old-one, decision:project\/sup\/old-two/);
  const oldOne = ctx.decisions.find((d) => d.key === 'decision:project/sup/old-one')!;
  assert.match(decisionLine(oldOne), /superseded by decision:project\/sup\/newer/);
});

test('a key that does not resolve, the decision itself, and a target another decision already supersedes are refused', () => {
  assert.throws(() => set(store, 'decision:project/sup/newer', ['supersedes=decision:sup/nope'], {}), /supersedes: /);
  assert.throws(
    () => set(store, 'decision:project/sup/newer', ['supersedes=decision:sup/newer'], {}),
    /cannot supersede itself/,
  );
  assert.throws(
    () => set(store, 'decision:project/sup/third', ['supersedes=decision:sup/old-one'], {}),
    /already superseded by decision:project\/sup\/newer/,
  );
  assert.throws(() => set(store, 'decision:project/sup/third', ['supersedes='], {}), /never emptied/);
  assert.equal(status(store, 'decision:project/sup/third'), 'proposed');
  assert.equal(errors(store).length, 0);
});

test('a refused write leaves the target as it was', () => {
  // a change, not a decision, as the target
  assert.throws(
    () => set(store, 'decision:project/sup/third', ['supersedes=change:project/sup'], {}),
    /not a decision/,
  );
  assert.equal(status(store, 'decision:project/sup/third'), 'proposed');
  assert.equal(supersedesOf(loadStore(store).byKey.get('decision:project/sup/third')![0].data).length, 0);
});

test('creating with --supersedes still marks its target, through the same path', () => {
  const r = decisionRec(store, 'sup/fourth', {
    title: 'Fourth',
    decision: 'a',
    why: 'b',
    supersedes: 'decision:sup/third',
  });
  assert.deepEqual(r.notes, ['decision:project/sup/third is now superseded']);
  assert.equal(status(store, 'decision:project/sup/third'), 'superseded');
  assert.throws(
    () =>
      decisionRec(store, 'sup/fifth', { title: 'Fifth', decision: 'a', why: 'b', supersedes: 'decision:sup/third' }),
    /already superseded by decision:project\/sup\/fourth/,
  );
  assert.equal(errors(store).length, 0);
});
