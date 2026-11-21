// A change's branch line names the branch that is its own (change:branch-line-own-branch): among the branches sessions
// were seen on, one whose last segment resolves to the change wins over a newer one that does not; one named for
// another change never stands for this one (decision branch-line-own-branch/foreign-fallback); and a branch named for
// the change in the project's repository is shown, with its worktree, before a name is recommended. The commands that
// merge, review and close a change take their branch by the same rule.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionObserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { changeContext, formatChangeContext, ls } from '../model/view.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { localHeads } from '../store/merged.js';
import { syncGit } from '../sync/git.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-branch-own-')));
const dir = path.join(tmp, 'web');
let store: Store;
let n = 0;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env }).trim();
const commit = (subject: string): void => {
  fs.writeFileSync(path.join(dir, `f${++n}.txt`), `${n}\n`);
  g('add', '-A');
  g('commit', '-q', '-m', subject);
};
/** A branch cut from main with a commit on it, main checked out again. */
const branch = (name: string, slug: string): void => {
  g('switch', '-q', '-c', name, 'main');
  commit(`feat: ${slug} (change:${slug})`);
  g('switch', '-q', 'main');
};
const make = (slug: string) => change(store, slug, { title: slug, summary: 's', project: 'project:web' });
const seenOn = (slug: string, name: string) =>
  sessionObserve(store, 'sess-1', 'links', `change:web/${slug}`, `branch:${name}`);
const branchOfChange = (slug: string) => changeContext(store, `change:web/${slug}`).branch;
const listed = (slug: string) => ls(store, { type: 'change' }).find((r) => r.key === `change:web/${slug}`)?.branch;
const line = (slug: string) =>
  /^branch: .*$/m.exec(formatChangeContext(changeContext(store, `change:web/${slug}`)))?.[0];

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  delete process.env.PJMAN_STORE;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  commit('chore: start');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  newRecord(store, 'session', 'sess-1', { agent: 'agent:claude-code' });
  make('first-thing');
});

test("a change worked on its own branch and seen later on another change's shows its own", () => {
  make('second-thing');
  seenOn('second-thing', 'TICK-2/second-thing');
  seenOn('second-thing', 'TICK-1/first-thing');
  const own = { name: 'TICK-2/second-thing', worktree: 'second-thing', observed: true };
  assert.deepEqual(branchOfChange('second-thing'), own);
  assert.deepEqual(listed('second-thing'), own);
  assert.equal(line('second-thing'), 'branch: TICK-2/second-thing');
});

test("a change seen only on another change's branch is not given it; a branch that names no change stands", () => {
  make('stray');
  seenOn('stray', 'TICK-1/first-thing');
  assert.equal(line('stray'), 'branch: stray (recommended; worktree stray)');
  assert.equal(listed('stray')?.observed, false);
  seenOn('stray', 'fix/misc');
  assert.equal(line('stray'), 'branch: fix/misc');
  // seen on its own at last, then elsewhere again: its own stays
  seenOn('stray', 'worktree-stray');
  seenOn('stray', 'fix/misc');
  assert.equal(line('stray'), 'branch: worktree-stray');
});

test('a branch named for the change in the repository is shown with its worktree, not a name to create', () => {
  make('third-thing');
  assert.equal(line('third-thing'), 'branch: third-thing (recommended; worktree third-thing)');
  g('branch', 'TICK-3/third-thing', 'main');
  assert.equal(
    line('third-thing'),
    'branch: TICK-3/third-thing (exists, no worktree; recommended worktree third-thing)',
  );
  g('worktree', 'add', '-q', path.join(tmp, 'trees', 'third'), 'TICK-3/third-thing');
  assert.equal(line('third-thing'), 'branch: TICK-3/third-thing (exists; worktree third)');
  const found = { name: 'TICK-3/third-thing', worktree: 'third', observed: false, exists: true, checkedOut: true };
  assert.deepEqual(branchOfChange('third-thing'), found);
  assert.deepEqual(listed('third-thing'), found);
  // a newer branch of the same name's end is passed over for the one a worktree holds
  g('branch', 'other/third-thing', 'main');
  assert.equal(branchOfChange('third-thing')?.name, 'TICK-3/third-thing');
  // the repository is asked only before a name is recommended: a branch a session worked on, naming no change, stands
  seenOn('third-thing', 'fix/misc');
  assert.equal(line('third-thing'), 'branch: fix/misc');
  seenOn('third-thing', 'TICK-3/third-thing');
  assert.equal(line('third-thing'), 'branch: TICK-3/third-thing');
});

test('a branch the change links stands whatever it names, after its own', () => {
  make('linked');
  set(store, 'change:web/linked', ['links+=branch:TICK-1/first-thing'], {});
  assert.equal(line('linked'), 'branch: TICK-1/first-thing', "a link is the change's own word");
  set(store, 'change:web/linked', ['links+=branch:TICK-9/linked'], {});
  assert.equal(line('linked'), 'branch: TICK-9/linked', 'a linked branch of its own name comes first');
  seenOn('linked', 'fix/misc');
  assert.equal(line('linked'), 'branch: TICK-9/linked');
});

test("a change of another project is not read from this repository's branches", () => {
  newRecord(store, 'project', 'other', { title: 'Other', product: 'product:web' });
  change(store, 'elsewhere', { title: 'elsewhere', summary: 's', project: 'project:other' });
  g('branch', 'elsewhere', 'main');
  assert.equal(line('elsewhere'), 'branch: elsewhere (recommended; worktree elsewhere)');
  set(store, 'change:web/elsewhere', ['project=project:web'], {});
  assert.equal(line('elsewhere'), 'branch: elsewhere (exists, no worktree; recommended worktree elsewhere)');
});

test("one change's merged branch does not set another done", () => {
  for (const slug of ['fourth-thing', 'fifth-thing']) {
    change(store, slug, { title: slug, summary: 's', project: 'project:web', next: 'build it' });
    step(store, `change:${slug}`, 'done', 1, {});
  }
  branch('TICK-4/fourth-thing', 'fourth-thing');
  seenOn('fifth-thing', 'TICK-4/fourth-thing');
  g('merge', '-q', '--no-ff', 'TICK-4/fourth-thing', '-m', "Merge branch 'TICK-4/fourth-thing'");
  const r = syncGit(store);
  const status = (slug: string) => loadStore(store).byKey.get(`change:web/${slug}`)![0].data.status;
  assert.deepEqual(
    r.done.map((d) => [d.change, d.branch]),
    [['change:web/fourth-thing', 'TICK-4/fourth-thing']],
    'the branch is found by its name, under a prefix no session was seen on',
  );
  assert.equal(status('fourth-thing'), 'done');
  assert.equal(status('fifth-thing'), 'review');
});

test('a change shown on a branch that is not in this repository is still merged by its own', () => {
  change(store, 'sixth-thing', { title: 'sixth-thing', summary: 's', project: 'project:web', next: 'build it' });
  step(store, 'change:sixth-thing', 'done', 1, {});
  seenOn('sixth-thing', 'fix/nowhere');
  branch('TICK-6/sixth-thing', 'sixth-thing');
  assert.equal(line('sixth-thing'), 'branch: fix/nowhere', 'the views keep the branch a session worked on');
  g('merge', '-q', '--no-ff', 'TICK-6/sixth-thing', '-m', "Merge branch 'TICK-6/sixth-thing'");
  assert.deepEqual(
    syncGit(store).done.map((d) => [d.change, d.branch]),
    [['change:web/sixth-thing', 'TICK-6/sixth-thing']],
  );
});

test("a project in a subfolder of its repository reads the checkout's own branch as held by no worktree", () => {
  const sub = path.join(dir, 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  const heads = localHeads(sub);
  assert.equal(heads.find((h) => h.name === 'main')?.worktree, undefined);
  assert.equal(heads.find((h) => h.name === 'TICK-3/third-thing')?.worktree, 'third');
});

test('filing a change whose branch is already cut names that branch, not one to create', () => {
  g('branch', 'TICK-7/filed-here', 'main');
  const out = execFileSync(
    process.execPath,
    [
      path.resolve(import.meta.dirname, '..', '..', 'bin', 'pjman.js'),
      ...['new', 'change', 'filed-here', '--name', 'Filed here', '--gist', 'Filed from its branch'],
      ...['--origin', 'asked for in a test', '--intent', 'what the test needs', '--done-when', 'the test passes'],
    ],
    { cwd: dir, env: { ...env, PJMAN_HOME: process.env.PJMAN_HOME }, encoding: 'utf8' },
  );
  assert.match(out, /^branch: TICK-7\/filed-here \(exists, no worktree; recommended worktree filed-here\)$/m);
});
