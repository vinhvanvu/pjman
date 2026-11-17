// pjman follows merges it did not make and makes the ones it is asked for (change:merge-via-pr): a branch's work is
// found on the base however it got there (a merge commit, a squash, a rebase, a fast-forward; here or on the fetched
// remote), a change in review whose branch is merged is set done, and `pjman merge` lands a branch locally, or through
// the change's Trail on Entire, whose gates decide, when the project opted in.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { set } from '../ops/set.js';
import { step } from '../ops/step.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { mergedInto, syncGit } from '../sync/git.js';
import { mergeChange } from '../sync/merge.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-merge-')));
const dir = path.join(tmp, 'web');
const origin = path.join(tmp, 'origin.git');
let store: Store;
let n = 0;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
const g = (...args: string[]) => gitIn(dir, ...args);
const commit = (subject: string, cwd = dir): string => {
  fs.writeFileSync(path.join(cwd, `f${++n}.txt`), `${n}\n`);
  gitIn(cwd, 'add', '-A');
  gitIn(cwd, 'commit', '-q', '-m', subject);
  return gitIn(cwd, 'rev-parse', 'HEAD');
};
/** A branch cut from main with two commits on it, main checked out again. */
const branch = (name: string, slug = name): void => {
  g('switch', '-q', '-c', name, 'main');
  commit(`feat: ${slug} one (change:${slug})`);
  commit(`feat: ${slug} two (change:${slug})`);
  g('switch', '-q', 'main');
};
/** A change whose plan has run to its end: in review. */
const inReview = (slug: string): void => {
  change(store, slug, { title: slug, summary: 's', project: 'project:web', next: 'build it' });
  step(store, `change:${slug}`, 'done', 1, {});
};
const statusOf = (slug: string) => loadStore(store).byKey.get(`change:web/${slug}`)![0].data.status;
const fake = (name: string, body: string): string => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> ${path.join(tmp, 'calls.log')}\n${body}\n`, { mode: 0o755 });
  return file;
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  commit('chore: start');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g('remote', 'add', 'origin', origin);
  g('push', '-q', '-u', 'origin', 'main');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
});

test('a branch is found on the base however it got there, and a branch only just cut is not', () => {
  branch('merged');
  g('merge', '-q', '--no-ff', 'merged', '-m', "Merge branch 'merged'");
  assert.equal(mergedInto(dir, 'merged', { named: 'change:merged' })?.how, 'merge');

  branch('squashed');
  commit('chore: main moves on');
  g('merge', '-q', '--squash', 'squashed');
  g('commit', '-q', '-m', 'Squashed (#7)');
  assert.equal(mergedInto(dir, 'squashed', { named: 'change:squashed' })?.how, 'squash');

  branch('rebased');
  commit('chore: main moves again');
  g('cherry-pick', 'main..rebased');
  assert.equal(mergedInto(dir, 'rebased', { named: 'change:rebased' })?.how, 'rebase');

  branch('forwarded');
  g('merge', '-q', '--ff-only', 'forwarded');
  assert.equal(mergedInto(dir, 'forwarded', { named: 'change:forwarded' })?.how, 'forward');

  g('branch', 'just-cut', 'main');
  assert.equal(mergedInto(dir, 'just-cut', { named: 'change:just-cut' }), null);
  branch('open');
  assert.equal(mergedInto(dir, 'open', { named: 'change:open' }), null);
  assert.equal(mergedInto(dir, 'no-such-branch'), null);
});

test('sync git sets done the changes in review whose branch is merged, and only those', () => {
  for (const slug of ['merged', 'squashed', 'open']) inReview(slug);
  change(store, 'rebased', { title: 'rebased', summary: 's', project: 'project:web', next: 'build it' });
  const dry = syncGit(store, { write: false });
  assert.deepEqual(dry.done.map((d) => d.change).toSorted(), ['change:web/merged', 'change:web/squashed']);
  assert.equal(statusOf('merged'), 'review', 'a dry run writes nothing');
  const r = syncGit(store);
  assert.deepEqual(r.done.map((d) => [d.change, d.branch, d.how]).toSorted(), [
    ['change:web/merged', 'merged', 'merge'],
    ['change:web/squashed', 'squashed', 'squash'],
  ]);
  assert.ok(r.done.every((d) => d.commit));
  assert.equal(statusOf('merged'), 'done');
  assert.equal(statusOf('squashed'), 'done');
  assert.equal(statusOf('open'), 'review', 'its branch is not merged');
  assert.equal(statusOf('rebased'), 'planning', 'not in review: the rule leaves it');
  const again = syncGit(store);
  assert.deepEqual(again.done, []);
  assert.deepEqual(again.merged.map((m) => m.branch).toSorted(), ['merged', 'squashed'], 'done and safe to remove');
});

test('a merge made on the remote is followed once it is fetched', () => {
  inReview('remote');
  branch('remote');
  g('push', '-q', 'origin', 'remote');
  // the pull request is squashed on the remote, as a forge does it
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', origin, other]);
  gitIn(other, 'merge', '-q', '--squash', 'origin/remote');
  gitIn(other, 'commit', '-q', '-m', 'Remote (#8)');
  gitIn(other, 'push', '-q', 'origin', 'main');
  assert.deepEqual(syncGit(store).done, [], 'nothing fetched yet');
  g('fetch', '-q', 'origin');
  const r = syncGit(store);
  assert.deepEqual(
    r.done.map((d) => [d.change, d.how, d.on]),
    [['change:web/remote', 'squash', 'origin/main']],
  );
  assert.equal(statusOf('remote'), 'done');
});

test('pjman merge lands the branch locally where the project has not opted in to Entire', () => {
  assert.equal(mergeChange(store, 'change:web/open').by, 'local');
  assert.equal(statusOf('open'), 'done');
  assert.match(g('log', '-1', '--format=%s'), /^Merge branch 'open': open \(change:open\)$/);
  assert.equal(mergeChange(store, 'change:web/open').by, 'already');

  inReview('dirty');
  branch('dirty');
  fs.writeFileSync(path.join(dir, 'f1.txt'), 'edited\n');
  assert.throws(() => mergeChange(store, 'change:web/dirty'), /not merged: .* has uncommitted changes/);
  g('checkout', '-q', '--', 'f1.txt');
  g('switch', '-q', 'dirty');
  assert.throws(() => mergeChange(store, 'change:web/dirty'), /not merged: .* is not on main/);
  g('switch', '-q', 'main');
  assert.equal(statusOf('dirty'), 'review');
  inReview('branchless');
  assert.throws(() => mergeChange(store, 'change:web/branchless'), /has no branch in this repository to merge/);
});

test("opted in, the merge is the Trail's: a gate that blocks merges nothing; a merge that passes is pulled and set done", () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  const head = g('rev-parse', 'main');
  const blocked = fake('entire-blocked', 'echo "merge blocked: Human Review needs 1 approval" >&2; exit 1');
  assert.throws(
    () => mergeChange(store, 'change:web/dirty', { entire: { bin: blocked } }),
    /not merged: entire trail merge --branch dirty failed: merge blocked: Human Review needs 1 approval\n.*nothing was merged locally/,
  );
  assert.equal(g('rev-parse', 'main'), head, 'main did not move');
  assert.equal(statusOf('dirty'), 'review');
  assert.equal(fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim(), 'trail merge --branch dirty --json');

  // Entire merges the pull request on the remote: the fake does what the forge would
  g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  g('push', '-q', 'origin', 'main', 'dirty');
  const other = path.join(tmp, 'other2');
  execFileSync('git', ['clone', '-q', origin, other]);
  const passes = fake(
    'entire-passes',
    `cd ${other} && git -c user.name=t -c user.email=t@example.com merge -q --no-ff origin/dirty -m "Merge pull request #9 from acme/dirty" && git push -q origin main && echo '{"merged":true}'`,
  );
  const r = mergeChange(store, 'change:web/dirty', { entire: { bin: passes } });
  assert.equal(r.by, 'entire');
  assert.deepEqual(r.notes, []);
  assert.equal(statusOf('dirty'), 'done');
  assert.match(
    g('log', '-1', '--format=%s', 'main'),
    /^Merge pull request #9 from acme\/dirty$/,
    'the base was pulled',
  );
});
