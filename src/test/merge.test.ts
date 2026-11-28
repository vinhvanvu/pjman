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
import { findingsOf } from '../model/findings.js';
import { settleFinding } from '../sync/review.js';
import { reconcileTrail } from '../sync/trail.js';
import { change, holdLock } from './shape.js';

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

test('pjman merge writes the store under its lock: a busy store leaves the branch merged and says the change is not set done', async () => {
  inReview('busy');
  branch('busy');
  const release = await holdLock(store.root);
  let r;
  try {
    r = mergeChange(store, 'change:web/busy');
  } finally {
    await release();
  }
  assert.equal(r.by, 'local');
  assert.equal(r.commit, null);
  assert.match(r.undone ?? '', /the store is busy.*pjman sync git sets it done/);
  assert.equal(statusOf('busy'), 'review', 'nothing written beside the holder');
  assert.deepEqual(
    syncGit(store).done.map((d) => d.change),
    ['change:web/busy'],
  );
  assert.equal(statusOf('busy'), 'done');
  // one merged before its plan ended is not one sync git ends: the message says how instead
  change(store, 'early', { title: 'early', summary: 's', project: 'project:web', next: 'build it' });
  step(store, 'change:early', 'start', 1, {});
  branch('early');
  const again = await holdLock(store.root);
  try {
    r = mergeChange(store, 'change:web/early');
  } finally {
    await again();
  }
  assert.match(
    r.undone ?? '',
    /the store is busy.*once the store is free, set it done with pjman set change:web\/early status=done, then pjman code learn/,
  );
  assert.equal(statusOf('early'), 'active');
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
  // that the merge went through the Trail is kept on the change, for whichever command reads the merge later
  const ext = loadStore(store).byKey.get('change:web/dirty')![0].data.ext as { entire?: { merged_through?: string } };
  assert.match(ext.entire?.merged_through ?? '', /^\d{4}-\d\d-\d\dT/);
  assert.match(
    g('log', '-1', '--format=%s', 'main'),
    /^Merge pull request #9 from acme\/dirty$/,
    'the base was pulled',
  );
});

test('a branch with no commits of its own is not merged by a later merge of another branch, nor by a longer key', () => {
  g('switch', '-q', 'main');
  // cut and never built on, then main moves past it by another branch's merge
  g('branch', 'idle');
  branch('idle-later');
  g('merge', '-q', '--no-ff', 'idle-later', '-m', "Merge branch 'idle-later' (change:idle-later)");
  assert.equal(mergedInto(dir, 'idle', { named: 'change:idle' }), null);
  // the merged branch itself is still found
  assert.equal(mergedInto(dir, 'idle-later', { named: 'change:idle-later' })?.how, 'merge');
});

test("the Trail's findings are read onto the change before the merge, since a merged Trail lists none", async () => {
  g('switch', '-q', 'main');
  g('pull', '-q', '--no-rebase', '--no-edit', 'origin', 'main');
  branch('late');
  inReview('late');
  g('push', '-q', 'origin', 'late');
  const other = path.join(tmp, 'other3');
  execFileSync('git', ['clone', '-q', origin, other]);
  const trail =
    '{"id":"01L","number":4,"url":"https://entire.com/gh/acme/-/trails/4","status":"open","phase":"building","changes":[{"number":4,"branch":"late","status":"open","mergeability":{"mergeable":true,"gates":[]}}]}';
  const bin = fake(
    'entire-late',
    `case "$1 $2" in
  "trail show"|"trail update") echo '${trail}' ;;
  "trail ready") echo ready ;;
  "trail finding") if [ -f ${path.join(tmp, 'late.nolist')} ]; then echo 'the server did not answer (503)' >&2; exit 1; elif [ "$3" = dismiss ]; then touch ${path.join(tmp, 'late.dismissed')}; echo dismissed; elif [ -f ${path.join(tmp, 'late.dismissed')} ]; then echo '{"counts":{"Open":0},"findings":[{"id":"L1","body":"a late finding","severity":"low","status":"dismissed"}]}'; else echo '{"counts":{"Open":1},"findings":[{"id":"L1","body":"a late finding","severity":"low","status":"open"}]}'; fi ;;
  "trail merge") cd ${other} && git -c user.name=t -c user.email=t@example.com merge -q --no-ff origin/late -m "Merge pull request #10 from acme/late" && git push -q origin main && echo '{"merged":true}' ;;
esac`,
  );
  assert.deepEqual(reconcileTrail(store, 'change:web/late', { entire: { bin } })!.pending, []);
  // a read that cannot be made (Entire's list fails) or written (the store busy) merges nothing: once merged, Entire
  // lists the findings no more
  fs.rmSync(path.join(tmp, 'calls.log'));
  fs.writeFileSync(path.join(tmp, 'late.nolist'), '');
  assert.throws(
    () => mergeChange(store, 'change:web/late', { entire: { bin } }),
    /not merged: the Trail's findings could not be read onto change:web\/late \(.*503/,
  );
  fs.rmSync(path.join(tmp, 'late.nolist'));
  assert.ok(!fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').includes('trail merge'), 'not merged past it');
  fs.rmSync(path.join(tmp, 'calls.log'));
  const release = await holdLock(store.root);
  try {
    assert.throws(
      () => mergeChange(store, 'change:web/late', { entire: { bin } }),
      /not merged: the Trail's findings could not be read onto change:web\/late \(the store is busy/,
    );
  } finally {
    await release();
  }
  assert.ok(!fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').includes('trail merge'), 'not merged past it');
  fs.rmSync(path.join(tmp, 'calls.log'));
  // what was posted on the Trail is read first, and is the change's own to handle: the merge waits on it, whatever
  // its severity (decision review-fixes-in-place/where-findings-go)
  assert.throws(
    () => mergeChange(store, 'change:web/late', { entire: { bin } }),
    /not merged: 1 finding is not handled on change:web\/late\n1\. \[open\] low — a late finding[\s\S]*--defer <n>/,
  );
  const log = fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim().split('\n');
  assert.ok(
    log.some((l) => l.startsWith('trail finding list')),
    'read first',
  );
  assert.ok(!log.some((l) => l.startsWith('trail merge')), 'not merged past it');
  assert.deepEqual(
    findingsOf(loadStore(store).byKey.get('change:web/late')![0].data).map((f) => [f.text, f.by, f.entire]),
    [['a late finding', 'entire', 'L1']],
  );
  assert.equal(statusOf('late'), 'review');
  // handled, it no longer stands in the way
  settleFinding(store, 'change:web/late', 1, 'dismissed', 'the comment is right as it reads', { entire: { bin } });
  const r = mergeChange(store, 'change:web/late', { entire: { bin } });
  assert.equal(r.by, 'entire');
  assert.equal(statusOf('late'), 'done');
});
