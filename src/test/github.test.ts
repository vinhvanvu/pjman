import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { loadStore } from '../records.js';
import { ghIssuesIn, ghReadCommand, mapGhStatus, syncGithub, toGhIssue } from '../sync/github.js';
import { validate } from '../validate.js';
import { stepsOf } from '../foundation.js';
import { next } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-github-'));
const project = path.join(tmp, 'app');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

// gh issue list --json number,title,state,stateReason,url,labels,milestone
const issues = [
  { number: 1, title: 'Login', state: 'OPEN', stateReason: '', url: 'https://github.com/acme/app/issues/1', labels: [{ name: 'in progress' }], milestone: { title: 'v1' } },
  { number: 2, title: 'Signup', state: 'OPEN', stateReason: '', url: 'https://github.com/acme/app/issues/2', labels: [{ name: 'Bug' }], milestone: null, parent: { number: 1 } },
  { number: 3, title: 'Old', state: 'CLOSED', stateReason: 'COMPLETED', url: 'https://github.com/acme/app/issues/3', labels: [] },
  { number: 4, title: 'Nope', state: 'CLOSED', stateReason: 'NOT_PLANNED', url: 'https://github.com/acme/app/issues/4', labels: [] },
  { number: 5, title: 'A PR', state: 'OPEN', url: 'https://github.com/acme/app/pull/5', pull_request: {} },
];

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: project });
  fs.mkdirSync(process.env.PJMAN_HOME!, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME!, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
});

test('shapes and status: gh json and the REST shape; labels through the vocabulary; closed reasons', () => {
  assert.equal(toGhIssue(issues[0])?.labels[0], 'in progress');
  assert.equal(toGhIssue(issues[1])?.parent, 1);
  assert.equal(toGhIssue(issues[4]), null);
  assert.equal(toGhIssue({ number: 9, title: 't', state: 'closed', state_reason: 'not_planned', html_url: 'https://github.com/acme/app/issues/9', labels: ['bug'] })?.repo, 'acme/app');
  assert.equal(ghIssuesIn(issues).length, 4);
  assert.equal(ghIssuesIn(JSON.stringify(issues)).length, 4);
  assert.equal(mapGhStatus(store, toGhIssue(issues[2])!), 'done');
  assert.equal(mapGhStatus(store, toGhIssue(issues[3])!), 'dropped');
  assert.equal(mapGhStatus(store, toGhIssue(issues[0])!), 'open');
  assert.equal(mapGhStatus({ ...store, config: { ...store.config, vocabulary: { 'in progress': 'active' } } }, toGhIssue(issues[0])!), 'active');
});

test('the GraphQL shape gh api graphql --paginate --slurp answers: pages, label connections, uppercase states, parents', () => {
  const page = (nodes: unknown[]) => ({ data: { repository: { issues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } });
  const pages = [
    page([{ number: 1, title: 'Parent', url: 'https://github.com/acme/app/issues/1', state: 'OPEN', stateReason: null, labels: { nodes: [{ name: 'in progress' }] }, milestone: null, parent: null }]),
    page([{ number: 2, title: 'Child', url: 'https://github.com/acme/app/issues/2', state: 'CLOSED', stateReason: 'NOT_PLANNED', labels: { nodes: [] }, milestone: { title: 'v1' }, parent: { number: 1 } }]),
  ];
  const got = ghIssuesIn(pages);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].labels, ['in progress']);
  assert.equal(got[1].parent, 1);
  assert.equal(got[1].milestone, 'v1');
  assert.equal(mapGhStatus(store, got[1]), 'dropped');
  assert.match(ghReadCommand('acme/app'), /gh api graphql --paginate --slurp .*owner:"acme",name:"app".*parent\{number\}/);
});

test('a sync applies the repository from the project link: sources, changes, parent; pjman fields survive', () => {
  assert.throws(() => syncGithub(store, { from: issues }), /tracker=github-issue/);
  set(store, 'project:app', ['tracker=github-issue'], {});
  const r = syncGithub(store, { from: issues });
  assert.equal(r.team, 'acme/app');
  assert.deepEqual(r.created.sort(), ['change:app/app-1', 'change:app/app-2', 'change:app/app-3', 'change:app/app-4']);
  const loaded = loadStore(store);
  const c1 = loaded.byKey.get('change:app/app-1')![0];
  assert.deepEqual(c1.data.binds, ['github-issue:acme/app#1']);
  assert.equal(c1.data.status, 'open');
  assert.equal(loaded.byKey.get('change:app/app-2')![0].data.parent, 'change:app/app-1');
  assert.equal(loaded.byKey.get('change:app/app-2')![0].data.kind, 'bug');
  assert.equal(loaded.byKey.get('change:app/app-1')![0].data.kind, undefined);
  assert.equal(loaded.byKey.get('change:app/app-3')![0].data.status, 'done');
  assert.equal(loaded.byKey.get('change:app/app-4')![0].data.status, 'dropped');
  const s1 = loaded.byKey.get('github-issue:acme/app#1')![0];
  assert.equal(s1.data.url, 'https://github.com/acme/app/issues/1');
  assert.deepEqual((s1.data.ext as { github: { labels: string[] } }).github.labels, ['in progress']);
  assert.equal(c1.data.writer, 'agent:github-sync');
  assert.deepEqual(validate(loaded).filter((p) => p.level === 'error'), []);
  const again = syncGithub(store, { from: issues });
  assert.deepEqual(again.created, []);
  assert.equal(again.unchanged.length, 4);
  assert.equal(again.commit, null);
  next(store, 'change:app/app-1', 'ship it', {});
  const closed = issues.map((i) => (i.number === 1 ? { ...i, state: 'CLOSED', stateReason: 'COMPLETED' } : i));
  const third = syncGithub(store, { from: closed });
  assert.deepEqual(third.updated, [], 'pjman owns the status: a closed ticket moves nothing on its change');
  const after = loadStore(store).byKey.get('change:app/app-1')![0];
  assert.equal(after.data.status, 'planning', 'the step lifts it; the ticket closing does not');
  assert.equal(stepsOf(after.data)[0]?.text, 'ship it');
  const other = syncGithub(store, { from: [{ number: 7, title: 'x', state: 'OPEN', url: 'https://github.com/other/repo/issues/7', labels: [] }] });
  assert.deepEqual(other.skipped, [{ id: 'other/repo#7', reason: 'repository other/repo is not acme/app' }]);
});
