// A change that has had a plan becomes a milestone where it stands (change:promote-to-milestone): each open step is
// filed as a child change, the work on its branch goes with one of them, and the whole promotion backs out as one write.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { undo } from '../ops/apply.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findStore, writeStoreConfig, type Store } from '../store/config.js';
import { readEvents } from '../store/events.js';
import { loadStore } from '../store/records.js';
import { needsOf, stepsOf } from '../model/foundation.js';
import { validate } from '../model/validate.js';
import { branchOf, changeContext, observedBranches } from '../model/view.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-promote-'));
const project = path.join(tmp, 'app');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
const rec = (key: string) => loadStore(store).byKey.get(key)?.[0];
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
/** A branch off main with one commit of its own. */
const branchWithWork = (name: string) => {
  git('checkout', '-q', '-b', name, 'main');
  fs.writeFileSync(path.join(project, `${name}.txt`), 'work\n');
  git('add', '-A');
  git('commit', '-q', '-m', `work on ${name}`);
  git('checkout', '-q', 'main');
};

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Tester');
  git('config', 'user.email', 't@example.com');
  git('commit', '-q', '--allow-empty', '-m', 'start');
  fs.mkdirSync(process.env.PJMAN_HOME!, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME!, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  init({ cwd: project, name: 'app' });
  store = findStore(project)!;
});

test('kind=milestone files a child per open step; the steps it finished stay as history; undo backs the whole write out', () => {
  change(store, 'goal', {
    title: 'Goal',
    summary: 'g',
    steps: ['Lay the groundwork', 'Build the importer, tickets first', 'Write the guide', 'An idea given up'],
  });
  step(store, 'change:app/goal', 'done', 1, { note: 'landed' });
  step(store, 'change:app/goal', 'note', 2, { text: 'half the tickets read' });
  step(store, 'change:app/goal', 'drop', 4, {});
  assert.equal(rec('change:app/goal')!.data.status, 'active');
  const planBefore = rec('change:app/goal')!.data.plan;
  const seq = readEvents(store).at(-1)!.seq;

  const r = set(store, 'change:app/goal', ['kind=milestone'], {});
  assert.deepEqual(r.changed, ['kind', 'plan', 'status']);
  const goal = rec('change:app/goal')!;
  assert.equal(goal.data.kind, 'milestone');
  assert.equal(goal.data.status, 'open', 'a status that followed the plan goes back to open');
  assert.deepEqual(
    stepsOf(goal.data).map((s) => [s.state, s.note]),
    [
      ['done', 'landed'],
      ['dropped', 'became change:app/build-the-importer-tickets-first'],
      ['dropped', 'became change:app/write-the-guide'],
      ['dropped', undefined],
    ],
  );
  const importer = rec('change:app/build-the-importer-tickets-first')!;
  assert.equal(importer.data.parent, 'change:app/goal');
  assert.equal(importer.data.gist, 'Build the importer, tickets first');
  assert.equal(importer.data.status, 'open');
  assert.equal(importer.data.project, 'project:app');
  assert.equal(importer.data.features, undefined, 'the features stay on the milestone: a child names its own');
  assert.match(
    importer.sections.get('Origin')!,
    /^from change:app\/goal, step 2 of its plan when it became a milestone/,
  );
  assert.match(importer.sections.get('Notes')!, /half the tickets read/);
  assert.deepEqual(needsOf(importer), ['name', 'intent', 'done when']);
  assert.equal(importer.data.links, undefined, 'no branch in the repository: none to carry');
  assert.equal(rec('change:app/write-the-guide')!.sections.get('Notes'), undefined);
  assert.deepEqual(errors(), []);
  assert.match(
    r.notes.join('\n'),
    /step 2 filed as change:app\/build-the-importer-tickets-first; it needs its name, intent and done-when/,
  );
  assert.match(r.notes.join('\n'), /status back to open from active/);
  // one write: the set and a created event per child
  const events = readEvents(store).filter((e) => e.seq > seq);
  assert.deepEqual(
    events.map((e) => `${e.op} ${e.key}`),
    [
      'set change:app/goal',
      'created change:app/build-the-importer-tickets-first',
      'created change:app/write-the-guide',
    ],
  );
  // the milestone reads its children as its plan and its own steps as history
  const ctx = changeContext(store, 'change:app/goal');
  assert.deepEqual(ctx.plan, []);
  assert.equal(ctx.earlier?.length, 4);

  undo(store, { commit: r.commit! });
  assert.equal(rec('change:app/goal')!.data.kind, undefined);
  assert.equal(rec('change:app/goal')!.data.status, 'active');
  assert.deepEqual(rec('change:app/goal')!.data.plan, planBefore);
  assert.equal(rec('change:app/build-the-importer-tickets-first'), undefined);
  assert.equal(rec('change:app/write-the-guide'), undefined);
  assert.deepEqual(errors(), []);
});

test('a status the person set stays, and one given with the kind is the one written', () => {
  change(store, 'held', { title: 'Held', summary: 'h', steps: ['one thing'] });
  set(store, 'change:app/held', ['status=blocked'], {});
  set(store, 'change:app/held', ['kind=milestone'], {});
  assert.equal(rec('change:app/held')!.data.status, 'blocked');
  // a status that followed no step (a session's file write lifts a change to active) goes back to open as well
  change(store, 'stepless', { title: 'Stepless', summary: 's' });
  set(store, 'change:app/stepless', ['status=active'], {});
  set(store, 'change:app/stepless', ['kind=milestone'], {});
  assert.equal(rec('change:app/stepless')!.data.status, 'open');
  change(store, 'said', { title: 'Said', summary: 's', steps: ['another thing'] });
  step(store, 'change:app/said', 'start', 1, {});
  set(store, 'change:app/said', ['kind=milestone', 'status=active'], {});
  assert.equal(rec('change:app/said')!.data.status, 'active');
  assert.deepEqual(errors(), []);
});

test('two steps that would take one slug, and a step whose words make none, each get a slug of their own', () => {
  change(store, 'twins', { title: 'Twins', summary: 't', steps: ['Ship it', 'Ship it!', '…'] });
  set(store, 'change:app/twins', ['kind=milestone'], {});
  assert.ok(rec('change:app/ship-it'));
  assert.ok(rec('change:app/ship-it-2'));
  assert.ok(rec('change:app/twins-step-3'));
  assert.deepEqual(errors(), []);
});

test('work on the branch goes with the child of the step in work, which links the branch', () => {
  change(store, 'carried', { title: 'Carried', summary: 'c', steps: ['Done part', 'Later part', 'Part in work'] });
  step(store, 'change:app/carried', 'done', 1, {});
  step(store, 'change:app/carried', 'start', 3, {});
  branchWithWork('carried');
  const r = set(store, 'change:app/carried', ['kind=milestone'], {});
  const inWork = rec('change:app/part-in-work')!;
  assert.deepEqual(inWork.data.links, ['branch:carried']);
  assert.equal(rec('change:app/later-part')!.data.links, undefined, 'only one child takes the branch');
  assert.equal(
    branchOf(inWork, observedBranches(loadStore(store))).name,
    'carried',
    'so pjman merge on the child lands it',
  );
  assert.match(r.notes.join('\n'), /change:app\/part-in-work takes the branch carried: the work on it goes on there/);
  assert.deepEqual(errors(), []);
});

test('with no step in work the first open step takes the branch', () => {
  change(store, 'queued', { title: 'Queued', summary: 'q', steps: ['Done part', 'Next up', 'After that'] });
  step(store, 'change:app/queued', 'done', 1, {});
  branchWithWork('queued');
  set(store, 'change:app/queued', ['kind=milestone'], {});
  assert.deepEqual(rec('change:app/next-up')!.data.links, ['branch:queued']);
  assert.equal(rec('change:app/after-that')!.data.links, undefined);
});

test('with no open step, unmerged work on the branch refuses the promotion and names the merge; merged, it goes through', () => {
  change(store, 'finished', { title: 'Finished', summary: 'f', steps: ['All of it'] });
  step(store, 'change:app/finished', 'done', 1, {});
  branchWithWork('finished');
  assert.throws(
    () => set(store, 'change:app/finished', ['kind=milestone'], {}),
    /its branch finished holds work that is not merged, a milestone merges nothing.*merge it first \(pjman merge change:app\/finished\), then set kind=milestone/,
  );
  assert.equal(rec('change:app/finished')!.data.kind, undefined, 'refused whole');
  git('merge', '-q', '--no-ff', 'finished', '-m', "Merge branch 'finished'");
  set(store, 'change:app/finished', ['kind=milestone'], {});
  assert.equal(rec('change:app/finished')!.data.kind, 'milestone');
  assert.deepEqual(errors(), []);
});

test('the Trail on the branch goes with the child that takes the branch', () => {
  writeStoreConfig(store.root, { ...store.config, source_kinds: [...store.config.source_kinds, 'entire-trail'] });
  store = findStore(project)!;
  change(store, 'trailed', { title: 'Trailed', summary: 't', steps: ['Trailed part in work', 'Trailed later part'] });
  step(store, 'change:app/trailed', 'start', 1, {});
  set(store, 'change:app/trailed', ['binds+=entire-trail:gh/acme/7'], {});
  branchWithWork('trailed');
  const r = set(store, 'change:app/trailed', ['kind=milestone'], {});
  assert.deepEqual(r.changed, ['kind', 'plan', 'status', 'binds']);
  assert.equal(rec('change:app/trailed')!.data.binds, undefined, 'a milestone has no Trail of its own');
  const child = rec('change:app/trailed-part-in-work')!;
  assert.deepEqual(child.data.binds, ['entire-trail:gh/acme/7']);
  assert.deepEqual(child.data.links, ['branch:trailed']);
  assert.match(r.notes.join('\n'), /takes the branch trailed and its Trail/);
  assert.deepEqual(errors(), []);
  undo(store, { commit: r.commit! });
  assert.deepEqual(rec('change:app/trailed')!.data.binds, ['entire-trail:gh/acme/7']);
});

test('a branch whose work is already merged is not carried: no child links it and the Trail stays', () => {
  change(store, 'landed', { title: 'Landed', summary: 'l', steps: ['Landed part', 'What is left'] });
  step(store, 'change:app/landed', 'done', 1, {});
  set(store, 'change:app/landed', ['binds+=entire-trail:gh/acme/8'], {});
  branchWithWork('landed');
  git('merge', '-q', '--no-ff', 'landed', '-m', "Merge branch 'landed'");
  set(store, 'change:app/landed', ['kind=milestone'], {});
  assert.equal(rec('change:app/what-is-left')!.data.links, undefined);
  assert.equal(rec('change:app/what-is-left')!.data.binds, undefined);
  assert.deepEqual(rec('change:app/landed')!.data.binds, ['entire-trail:gh/acme/8']);
  assert.deepEqual(errors(), []);
});

test('the refusal that remains names an act that clears it: a milestone is filed without steps, and one holding an open step has them finished or dropped in one command', () => {
  assert.throws(
    () => change(store, 'born', { title: 'Born', summary: 'b', kind: 'milestone', steps: ['a step'] }),
    /file a milestone without steps and each piece of work as a child \(pjman new change <slug> --parent <milestone>\)/,
  );
  // a milestone left holding open steps by a write outside the tool
  change(store, 'edited', { title: 'Edited', summary: 'e', steps: ['one', 'two'] });
  const file = rec('change:app/edited')!.abs;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^status: /m, 'kind: milestone\nstatus: '));
  execFileSync('git', ['commit', '-q', '-am', 'by hand'], { cwd: store.root });
  assert.match(
    errors()
      .map((p) => p.message)
      .join('\n'),
    /carries 2 open steps of its own.*finish or drop them all in one command \(pjman step <change> done\|drop <n>\.\.\.\)/,
  );
  assert.throws(() => step(store, 'change:app/edited', 'drop', 1, {}), /carries 1 open step of its own/);
  assert.throws(() => step(store, 'change:app/edited', 'add', undefined, { text: 'no' }), /is a milestone/);
  step(store, 'change:app/edited', 'drop', 1, { more: [2] });
  assert.deepEqual(errors(), []);
  // only a step still open is settled: what a milestone finished or dropped is its history
  assert.throws(
    () => step(store, 'change:app/edited', 'done', 1, {}),
    /step 1 of change:app\/edited is dropped: a milestone's earlier steps are its history/,
  );
});
