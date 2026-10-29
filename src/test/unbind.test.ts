import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionObserve, sessionUnbind } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { readEvents, rebuildEvents } from '../events.js';
import { findSession, loadStore } from '../records.js';
import { validate } from '../validate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-unbind-'));
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
  newRecord(store, 'change', 'right', { title: 'Right', summary: 's', project: 'project:web' });
  newRecord(store, 'change', 'wrong', { title: 'Wrong', summary: 's', project: 'project:web' });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
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
  assert.deepEqual((rec.data.changes as string[]).map((c) => c.split('/').pop()), ['right']);
  assert.deepEqual((rec.data.observed as { from: string }[]).map((o) => o.from.split('/').pop()), ['right']);
  assert.match(rec.body, /unbound change:\S*wrong; dropped 1 edge observed on it/);
  assert.equal(validate(loaded).filter((p) => p.level === 'error').length, 0);
  for (const read of [() => readEvents(store), () => (rebuildEvents(store), readEvents(store))]) {
    const last = read().at(-1)!;
    assert.equal(last.op, 'set');
    assert.deepEqual(last.fields, ['changes', 'observed', 'log']);
  }
});

test('unbind refuses a change the session is not bound to', () => {
  assert.throws(() => sessionUnbind(store, 's1', 'wrong'), /is not bound to/);
});
