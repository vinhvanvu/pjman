import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { sessionProject, sessionStart } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { findSession, loadStore } from '../records.js';
import { validate } from '../validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-session-start-'));
let store: Store;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
  change(store, 'login', { title: 'Login', summary: 's', project: 'project:web' });
});

test('a start on a branch named for a change is one write: the record, the start line, the binding, the branch edge, the brief', () => {
  const before = readEvents(store).length;
  const r = sessionStart(store, 's1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', log: 'session started', branch: 'worktree-login', writer: 'agent:claude-code' });
  assert.equal(r.created, true);
  assert.equal(r.bound, 'change:web/login');
  assert.equal(r.observed, 'branch:worktree-login');
  assert.equal(r.brief?.mode, 'full');
  assert.match(r.brief!.text, /bound to change:web\/login; its context in full/);
  const loaded = loadStore(store);
  const rec = findSession(loaded, 's1')!;
  assert.deepEqual(rec.data.changes, ['change:web/login']);
  assert.equal((rec.data.observed as { from: string; to: string }[]).map((o) => `${o.from} ${o.to}`).join(), 'change:web/login branch:worktree-login');
  assert.equal((rec.data.briefed as { change: string }).change, 'change:web/login');
  assert.match(rec.sections.get('Log') ?? '', /— session started\n.*— bound change:web\/login \(branch\)$/);
  assert.deepEqual(validate(loaded).filter((p) => p.level === 'error'), []);
  // the events the separate commands would have emitted, with one commit between them
  const events = readEvents(store).slice(before).filter((e) => e.key === 'session:s1');
  assert.deepEqual(events.map((e) => e.op), ['created', 'log', 'bind', 'observe', 'set']);
  assert.equal(new Set(events.map((e) => e.commit)).size, 1);
});

test('a start of a session that exists appends the line and binds nothing twice; a branch leading nowhere binds nothing', () => {
  const again = sessionStart(store, 's1', { log: 'session resumed', branch: 'worktree-login', writer: 'agent:claude-code' });
  assert.equal(again.created, false);
  assert.equal(again.bound, undefined);
  assert.equal(again.observed, undefined);
  assert.equal(again.brief, null, 'nothing moved since the last brief');
  const rec = findSession(loadStore(store), 's1')!;
  assert.deepEqual(rec.data.changes, ['change:web/login']);
  assert.equal((rec.data.observed as unknown[]).length, 1);
  assert.match(rec.sections.get('Log') ?? '', /— session resumed$/);
  // --full: the bound change's context again, as after a compaction
  const full = sessionStart(store, 's1', { log: 'context compacted', full: true, writer: 'agent:claude-code' });
  assert.equal(full.brief?.mode, 'full');
  const loose = sessionStart(store, 's2', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', log: 'session started', branch: 'main', writer: 'agent:claude-code' });
  assert.equal(loose.created, true);
  assert.equal(loose.bound, undefined);
  assert.equal(loose.brief, null);
  assert.equal(findSession(loadStore(store), 's2')!.data.changes, undefined);
  assert.throws(() => sessionStart(store, 's3', { log: 'x' }), /--agent is required/);
});

test('a session started outside any project is resolved to the project of the repository it works in, once, and logged', () => {
  const loose = sessionStart({ ...store, project: undefined, projectDir: undefined }, 's-loose', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', log: 'session started', writer: 'agent:claude-code' });
  assert.equal(loose.created, true);
  assert.equal(findSession(loadStore(store), 's-loose')!.data.project, undefined);
  const r = sessionProject(store, 's-loose', 'project:web');
  assert.equal(r.moved, true);
  assert.equal(r.project, 'project:web');
  const rec = findSession(loadStore(store), 's-loose')!;
  assert.equal(rec.data.project, 'project:web');
  assert.match(rec.sections.get('Log') ?? '', /— resolved to project:web from the repository it works in \(started outside any project\)$/);
  const ev = readEvents(store).filter((e) => e.key === 'session:s-loose' && e.op === 'set').at(-1)!;
  assert.deepEqual(ev.fields, ['project', 'log']);
  assert.equal(ev.value, 'project:web');
  assert.equal(sessionProject(store, 's-loose', 'web').moved, false, 'the same project again is no write');
  assert.throws(() => sessionProject(store, 's-loose', 'project:nowhere'), /does not resolve|not found|unknown/i);
  assert.throws(() => sessionProject(store, 's-loose', 'change:web/login'), /is not a project/);
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
});
