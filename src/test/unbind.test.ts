import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { undo } from '../ops/apply.js';
import { sessionBind, sessionObserve, sessionUnbind, sessionUnobserve } from '../ops/session.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents, rebuildEvents } from '../store/events.js';
import { findSession, loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-unbind-'));
let store: Store;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  change(store, 'right', { title: 'Right', summary: 's', project: 'project:web' });
  change(store, 'wrong', { title: 'Wrong', summary: 's', project: 'project:web' });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code' });
  sessionBind(store, 's1', 'change:right');
  sessionObserve(store, 's1', 'links', 'change:right', 'branch:right');
  sessionBind(store, 's1', 'change:wrong');
  sessionObserve(store, 's1', 'links', 'change:wrong', 'branch:right');
});

test('unbind backs out the change and the edges observed on it, and logs that it did', () => {
  const r = sessionUnbind(store, 's1', 'wrong');
  assert.equal(r.dropped, 1);
  const loaded = loadStore(store);
  const rec = findSession(loaded, 's1')!;
  assert.deepEqual(
    (rec.data.changes as string[]).map((c) => c.split('/').pop()),
    ['right'],
  );
  assert.deepEqual(
    (rec.data.observed as { from: string }[]).map((o) => o.from.split('/').pop()),
    ['right'],
  );
  assert.match(rec.body, /unbound change:\S*wrong; dropped 1 edge observed on it/);
  assert.equal(validate(loaded).filter((p) => p.level === 'error').length, 0);
  for (const read of [() => readEvents(store), () => (rebuildEvents(store), readEvents(store))]) {
    const last = read().at(-1)!;
    assert.equal(last.op, 'set');
    assert.deepEqual(last.fields, ['changes', 'observed', 'log']);
  }
});

test('unobserve backs out one observed edge and leaves the binding and the other edges; undo puts it back', () => {
  sessionObserve(store, 's1', 'links', 'change:right', 'branch:someone-elses');
  sessionObserve(store, 's1', 'links', 'change:right', 'github-pr:acme/app#9');
  const r = sessionUnobserve(store, 's1', 'links', 'change:right', 'branch:someone-elses');
  assert.equal(r.dropped, 1);
  const read = () => findSession(loadStore(store), 's1')!;
  const targets = () => (read().data.observed as { to: string }[]).map((o) => o.to);
  assert.deepEqual(targets(), ['branch:right', 'github-pr:acme/app#9']);
  assert.deepEqual(
    (read().data.changes as string[]).map((c) => c.split('/').pop()),
    ['right'],
  );
  assert.match(read().body, /unobserved change:\S*right links branch:someone-elses/);
  for (const events of [() => readEvents(store), () => (rebuildEvents(store), readEvents(store))]) {
    const last = events().at(-1)!;
    assert.equal(last.op, 'set');
    assert.deepEqual(last.fields, ['observed', 'log']);
  }
  assert.throws(
    () => sessionUnobserve(store, 's1', 'links', 'change:right', 'branch:someone-elses'),
    /observed no links edge from change:\S*right to branch:someone-elses/,
  );
  undo(store, { commit: r.commit! });
  assert.deepEqual(targets(), ['branch:right', 'branch:someone-elses', 'github-pr:acme/app#9']);
  assert.equal(validate(loadStore(store)).filter((p) => p.level === 'error').length, 0);
});

test('unbind refuses a change the session is not bound to', () => {
  assert.throws(() => sessionUnbind(store, 's1', 'wrong'), /is not bound to/);
});
