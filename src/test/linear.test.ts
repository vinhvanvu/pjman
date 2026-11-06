import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { loadStore } from '../records.js';
import { issuesIn, mapStatus, syncLinear, toIssue } from '../sync/linear.js';
import { validate } from '../validate.js';
import { stepsOf } from '../foundation.js';
import { next } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-linear-'));
const project = path.join(tmp, 'app');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

// what a harness's Linear MCP tools answer with, in a few of the shapes they take
type Raw = { identifier: string; title: string; url: string; state: { name: string; type: string }; parent?: { identifier: string }; updatedAt: string; team: { key: string } };
const issues: Raw[] = [
  { identifier: 'APP-1', title: 'Login', url: 'https://linear.app/acme/issue/APP-1/login', state: { name: 'In Progress', type: 'started' }, updatedAt: '2026-10-20T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'APP-2', title: 'Signup form', url: 'https://linear.app/acme/issue/APP-2/signup', state: { name: 'Todo', type: 'unstarted' }, parent: { identifier: 'APP-1' }, updatedAt: '2026-10-21T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'APP-3', title: 'Old thing', url: 'https://linear.app/acme/issue/APP-3/old', state: { name: 'Done', type: 'completed' }, updatedAt: '2026-10-01T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'XYZ-9', title: 'Other team', url: 'https://linear.app/acme/issue/XYZ-9/x', state: { name: 'Todo', type: 'unstarted' }, updatedAt: '2026-10-21T10:00:00Z', team: { key: 'XYZ' } },
];

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  fs.mkdirSync(process.env.PJMAN_HOME!, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME!, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
});

test('shapes: issues from several field names and containers, status mapping', () => {
  assert.equal(toIssue({ identifier: 'A-1', title: 't', state: { name: 'In Review', type: 'started' } })?.stateType, 'started');
  assert.equal(toIssue({ key: 'A-2', name: 't', status: 'Done' })?.state, 'Done');
  assert.equal(toIssue({ id: 'uuid', title: 't' }), null);
  assert.equal(issuesIn(issues).length, 4);
  assert.equal(issuesIn({ issues: issues.slice(0, 2), nextCursor: 'x' }).length, 2);
  assert.equal(issuesIn({ nodes: issues.slice(0, 1) }).length, 1);
  assert.equal(issuesIn(issues[0]).length, 1);
  assert.equal(issuesIn({ content: [{ type: 'text', text: JSON.stringify({ issues: issues.slice(0, 3) }) }] }).length, 3);
  assert.equal(issuesIn(JSON.stringify(issues)).length, 4);
  assert.equal(issuesIn('not json').length, 0);
  assert.equal(mapStatus(store, 'In Progress', 'started'), 'active');
  assert.equal(mapStatus(store, 'Canceled', 'canceled'), 'dropped');
  assert.equal(mapStatus(store, 'Weird', undefined), 'open');
  assert.equal(mapStatus({ ...store, config: { ...store.config, vocabulary: { 'in review': 'review' } } }, 'In Review', 'started'), 'review');
});

test('a project without a tracker or a team is refused; nothing to sync is refused', () => {
  assert.throws(() => syncLinear(store, { from: issues }), /tracker=linear/);
  set(store, 'project:app', ['tracker=linear'], {});
  assert.throws(() => syncLinear(store, { from: issues }), /names no Linear team/);
  set(store, 'project:app', ['ext.linear.team=APP'], {});
  assert.throws(() => syncLinear(store, {}), /--from/);
  const file = path.join(tmp, 'issues.json');
  fs.writeFileSync(file, 'nope');
  assert.throws(() => syncLinear(store, { from: file }), /not JSON/);
});

test('a sync applies the bound team: sources, changes, status, parent; a second run changes nothing; pjman fields survive', () => {
  const r = syncLinear(store, { from: issues });
  assert.equal(r.team, 'APP');
  assert.equal(r.issues, 3);
  assert.deepEqual(r.created.sort(), ['change:app/app-1', 'change:app/app-2', 'change:app/app-3']);
  assert.deepEqual(r.skipped, [{ id: 'XYZ-9', reason: 'team XYZ is not APP' }]);
  assert.ok(r.commit);
  const loaded = loadStore(store);
  const c1 = loaded.byKey.get('change:app/app-1')![0];
  assert.equal(c1.data.status, 'active');
  assert.deepEqual(c1.data.binds, ['linear:APP-1']);
  assert.equal(c1.data.links, undefined);
  assert.equal(c1.data.project, 'project:app');
  assert.equal(c1.data.writer, 'agent:linear-sync');
  const c2 = loaded.byKey.get('change:app/app-2')![0];
  assert.equal(c2.data.parent, 'change:app/app-1');
  assert.equal(c2.data.status, 'planning');
  assert.equal(loaded.byKey.get('change:app/app-3')![0].data.status, 'done');
  assert.ok(!loaded.byKey.has('change:app/xyz-9'));
  const s1 = loaded.byKey.get('linear:APP-1')![0];
  assert.equal(s1.data.title, 'Login');
  assert.equal((s1.data.ext as { linear: { state: string } }).linear.state, 'In Progress');
  assert.ok(r.session && loaded.byKey.has(r.session));
  assert.deepEqual(validate(loaded).filter((p) => p.level === 'error'), []);

  const events = readEvents(store).length;
  const again = syncLinear(store, { from: issues });
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.updated, []);
  assert.equal(again.unchanged.length, 3);
  assert.equal(again.commit, null);
  assert.ok(readEvents(store).length - events <= 2); // only the run's session record

  next(store, 'change:app/app-1', 'write the tests');
  set(store, 'change:app/app-1', ['intent=Our own words.'], {});
  const moved = issues.map((i) => (i.identifier === 'APP-1' ? { ...i, title: 'Login (renamed)', state: { name: 'Done', type: 'completed' } } : i));
  const third = syncLinear(store, { from: JSON.stringify({ issues: moved }) });
  assert.deepEqual(third.updated, [], 'pjman owns the change: a renamed, closed ticket moves only its source');
  const after = loadStore(store).byKey.get('change:app/app-1')![0];
  assert.equal(after.data.status, 'active');
  assert.equal(after.data.gist, 'Login');
  assert.equal(loadStore(store).byKey.get('linear:APP-1')![0].data.title, 'Login (renamed)');
  assert.equal(stepsOf(after.data)[0]?.text, 'write the tests');
  assert.match(after.sections.get('Intent')!, /Our own words/);

  // one ticket, pasted as the tool answered it, from a file
  const file = path.join(tmp, 'one.json');
  fs.writeFileSync(file, JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ identifier: 'APP-4', title: 'New one', url: 'https://linear.app/acme/issue/APP-4/n', state: { name: 'Backlog', type: 'backlog' }, team: { key: 'APP' } }) }] }));
  const one = syncLinear(store, { from: file });
  assert.deepEqual(one.created, ['change:app/app-4']);
  assert.equal(loadStore(store).byKey.get('change:app/app-4')![0].data.status, 'open');
});
