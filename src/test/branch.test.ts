import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { branchNameFor, slugOfBranch, slugsOfBranch, worktreeNameFor } from '../model/branch.js';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionObserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { findStore, readUserConfig, writeUserConfig, type Store } from '../store/config.js';
import { findReferences } from '../model/graph.js';
import { loadStore } from '../store/records.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-branch-'));
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ cwd: project, name: 'app' });
  store = findStore(project)!;
  change(store, 'card-export', { title: 'Card export', summary: 'Export.' });
  newRecord(store, 'session', 'sess-1', { agent: 'agent:claude-code' });
});

test('the branch name is derived from the key under the configured prefix; the worktree is its last segment', () => {
  assert.equal(branchNameFor('change:app/card-export'), 'card-export');
  assert.equal(branchNameFor('change:app/card-export', 'vinh'), 'vinh/card-export');
  assert.equal(branchNameFor('change:app/card-export', '/vinh/'), 'vinh/card-export');
  assert.equal(branchNameFor('change:card-export', 'team/vinh'), 'team/vinh/card-export');
  assert.equal(worktreeNameFor('change:app/card-export'), 'card-export');
  assert.equal(slugOfBranch('vinh/card-export'), 'card-export');
  assert.equal(slugOfBranch('worktree-card-export'), 'card-export');
  assert.equal(slugOfBranch('vinh/worktree-card-export'), 'card-export');
  assert.equal(slugOfBranch('Card-Export'), 'card-export');
});

test("a branch key leads to the change its name was cut for; the harness's worktree- prefix is dropped", () => {
  const loaded = loadStore(store);
  const opts = { cwd: project, projectDir: project, project: store.project };
  for (const b of ['branch:card-export', 'branch:vinh/card-export', 'branch:worktree-card-export']) {
    const refs = findReferences(loaded, `on ${b} now`, opts);
    assert.equal(refs.length, 1, b);
    assert.equal(refs[0].key, b);
    assert.equal(refs[0].change, 'change:app/card-export', b);
  }
  assert.equal(findReferences(loaded, 'branch:nothing-here', opts)[0]?.change, undefined);
});

test("the desktop app's worktree branch leads to the change less its random suffix, only when the name as written leads nowhere", () => {
  assert.deepEqual(slugsOfBranch('claude/card-export-af891f'), ['card-export-af891f', 'card-export']);
  assert.deepEqual(slugsOfBranch('card-export'), ['card-export']);
  assert.deepEqual(slugsOfBranch('claude/card-export-v2'), ['card-export-v2']);
  const opts = { cwd: project, projectDir: project, project: store.project };
  assert.equal(
    findReferences(loadStore(store), 'branch:claude/card-export-af891f', opts)[0]?.change,
    'change:app/card-export',
  );
  // a change whose own slug ends in six hex digits is found as written, before the suffix is tried off
  change(store, 'card-export-c0ffee', { title: 'Card export, the coffee one', summary: 'Export.' });
  assert.equal(
    findReferences(loadStore(store), 'branch:claude/card-export-c0ffee', opts)[0]?.change,
    'change:app/card-export-c0ffee',
  );
});

test('the context shows the recommended branch until a session is seen on one', () => {
  writeUserConfig({ ...readUserConfig(), branch_prefix: 'vinh' });
  let ctx = changeContext(store, 'change:app/card-export');
  assert.deepEqual(ctx.branch, { name: 'vinh/card-export', worktree: 'card-export', observed: false });
  assert.match(formatChangeContext(ctx), /^branch: vinh\/card-export \(recommended; worktree card-export\)$/m);
  sessionObserve(store, 'sess-1', 'links', 'change:app/card-export', 'branch:vinh/card-export');
  ctx = changeContext(store, 'change:app/card-export');
  assert.deepEqual(ctx.branch, { name: 'vinh/card-export', worktree: 'card-export', observed: true });
  assert.match(formatChangeContext(ctx), /^branch: vinh\/card-export$/m);
});

test('whose branch: a written link, then the name, then an observed edge (decision observed-branch-belongs/whose-branch)', () => {
  const opts = { cwd: project, projectDir: project, project: store.project };
  const whose = (branch: string) => findReferences(loadStore(store), `branch:${branch}`, opts)[0]?.change;
  change(store, 'stack-a', { title: 'Stack a', summary: 'A.' });
  change(store, 'stack-b', { title: 'Stack b', summary: 'B.' });
  // a session bound to a stood in b's worktree: the wrong edge does not make b's branch a's
  sessionObserve(store, 'sess-1', 'links', 'change:app/stack-a', 'branch:TICK-2/stack-b');
  assert.equal(whose('TICK-2/stack-b'), 'change:app/stack-b');
  // a branch named for no change leads to the change it was observed on
  sessionObserve(store, 'sess-1', 'links', 'change:app/stack-a', 'branch:feat/login');
  assert.equal(whose('feat/login'), 'change:app/stack-a');
  assert.equal(findReferences(loadStore(store), 'branch:feat/login', opts)[0]?.relation, 'observed');
  // observed with the branch it was seen on, an edge lands on the change the name gives the branch to
  const seen = (from: string, branch: string) =>
    sessionObserve(store, 'sess-1', 'links', from, `github-pr:acme/app#${branch.length}`, undefined, branch);
  assert.equal(seen('change:app/stack-a', 'TICK-2/stack-b').from, 'change:app/stack-b');
  assert.equal(seen('change:app/stack-a', 'TICK-2/stack-b').added, false, 'an edge it holds is not written twice');
  // an earlier observation is no ground to move another change's edge: on a branch nothing else claims, it stays
  assert.equal(seen('change:app/stack-b', 'feat/login').from, 'change:app/stack-b');
  assert.equal(seen('change:app/stack-b', 'nobodys').from, 'change:app/stack-b');
  // a link someone wrote outranks the name
  set(store, 'change:app/stack-a', ['links+=branch:TICK-2/stack-b'], {});
  assert.equal(whose('TICK-2/stack-b'), 'change:app/stack-a');
});
