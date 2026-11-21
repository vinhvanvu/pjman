import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { undo } from '../ops/apply.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionObserve, sessionUnobserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { findStore, type Store } from '../store/config.js';
import { readEvents, rebuildEvents } from '../store/events.js';
import { findSession, loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { branchOf, observedBranches } from '../model/view.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-unobserve-'));
let store: Store;

/** The change's branch line, as context and ls read it. */
const line = (slug: string) => {
  const loaded = loadStore(store);
  const rec = loaded.records.find((r) => r.type === 'change' && r.key.endsWith(`/${slug}`))!;
  return branchOf(rec, observedBranches(loaded), undefined);
};
const session = () => findSession(loadStore(store), 's1')!;
const edges = () =>
  ((session().data.observed ?? []) as { from: string; to: string }[]).map((o) => `${o.from.split('/').pop()} ${o.to}`);

before(async () => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  change(store, 'abc-1', { title: 'One', summary: 's', project: 'project:web' });
  change(store, 'abc-2', { title: 'Two', summary: 's', project: 'project:web' });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code' });
  sessionBind(store, 's1', 'change:abc-1');
  sessionObserve(store, 's1', 'links', 'change:abc-1', 'branch:abc-1');
  sessionObserve(store, 's1', 'links', 'change:abc-1', 'file:src/a.ts');
  // the edge observed in error: another change's branch, seen later. It no longer decides the line (a branch named
  // for another change never stands for this one, change:branch-line-own-branch), and is still a wrong edge to take back
  await new Promise((r) => setTimeout(r, 5));
  sessionObserve(store, 's1', 'links', 'change:abc-1', 'branch:abc-2');
});

test('unobserve corrects a branch line that names a stray branch', () => {
  change(store, 'abc-3', { title: 'Three', summary: 's', project: 'project:web' });
  newRecord(store, 'session', 's0', { agent: 'agent:claude-code' });
  sessionBind(store, 's0', 'change:abc-3');
  // a branch that names no change, observed on the change in error: nothing says it is another's, so it is the line
  sessionObserve(store, 's0', 'links', 'change:abc-3', 'branch:spike/throwaway');
  assert.deepEqual(line('abc-3'), { name: 'spike/throwaway', worktree: line('abc-3').worktree, observed: true });
  sessionUnobserve(store, 's0', 'links', 'abc-3', 'branch:spike/throwaway');
  assert.equal(line('abc-3').observed, false);
  assert.equal(line('abc-3').name, 'abc-3');
});

test('unobserve takes back a wrong edge and keeps the binding and the other edges; undo reverts it', () => {
  assert.equal(line('abc-1').name, 'abc-1');
  const r = sessionUnobserve(store, 's1', 'links', 'abc-1', 'branch:abc-2');
  assert.equal(r.dropped, 1);
  assert.ok(r.commit);

  assert.deepEqual(line('abc-1'), { name: 'abc-1', worktree: line('abc-1').worktree, observed: true });
  const rec = session();
  assert.deepEqual(
    (rec.data.changes as string[]).map((c) => c.split('/').pop()),
    ['abc-1'],
  );
  assert.deepEqual(edges(), ['abc-1 branch:abc-1', 'abc-1 file:src/a.ts']);
  assert.match(rec.body, /took back links change:\S*abc-1 → branch:abc-2 \(observed \S+\), observed in error/);
  assert.equal(validate(loadStore(store)).filter((p) => p.level === 'error').length, 0);
  for (const read of [() => readEvents(store), () => (rebuildEvents(store), readEvents(store))]) {
    const last = read().at(-1)!;
    assert.equal(last.op, 'set');
    assert.deepEqual(last.fields, ['observed', 'log']);
  }

  undo(store, { commit: r.commit });
  assert.equal(line('abc-1').name, 'abc-1');
  assert.deepEqual(edges(), ['abc-1 branch:abc-1', 'abc-1 file:src/a.ts', 'abc-1 branch:abc-2']);
});

test('unobserve refuses an edge the session never observed, naming what it did observe', () => {
  assert.throws(
    () => sessionUnobserve(store, 's1', 'links', 'abc-1', 'branch:nope'),
    /observed no links edge from change:\S*abc-1 to branch:nope \(from change:\S*abc-1 it observed: links branch:abc-1,/,
  );
  assert.throws(() => sessionUnobserve(store, 's1', 'binds', 'abc-1', 'branch:abc-2'), /observed no binds edge/);
  assert.throws(() => sessionUnobserve(store, 's1', 'sees', 'abc-1', 'branch:abc-2'), /is not an edge/);
  assert.equal(edges().length, 3);
});

test('unobserve takes back every copy of the edge, and the last edge leaves no empty list', () => {
  newRecord(store, 'session', 's2', { agent: 'agent:claude-code' });
  sessionBind(store, 's2', 'change:abc-2');
  sessionObserve(store, 's2', 'links', 'change:abc-2', 'branch:abc-1');
  sessionObserve(store, 's2', 'links', 'change:abc-2', 'branch:abc-1');
  const r = sessionUnobserve(store, 's2', 'links', 'change:abc-2', 'branch:abc-1');
  assert.equal(r.dropped, 2);
  const rec = findSession(loadStore(store), 's2')!;
  assert.equal(rec.data.observed, undefined);
  assert.deepEqual(
    (rec.data.changes as string[]).map((c) => c.split('/').pop()),
    ['abc-2'],
  );
  assert.equal(line('abc-2').observed, false);
});

test('unobserve names the other sessions that still hold the edge, and its event names the change', () => {
  newRecord(store, 'session', 's3', { agent: 'agent:claude-code' });
  sessionObserve(store, 's3', 'links', 'change:abc-1', 'branch:abc-2');
  const r = sessionUnobserve(store, 's1', 'links', 'abc-1', 'branch:abc-2');
  assert.deepEqual(r.others, ['session:s3']);
  // the edge is read across sessions: it stands until the last holder lets go
  assert.equal(line('abc-1').name, 'abc-1');
  for (const read of [() => readEvents(store), () => (rebuildEvents(store), readEvents(store))]) {
    const last = read().at(-1)!;
    assert.equal(last.key, 'session:s1');
    assert.match(last.value ?? '', /^change:\S*abc-1$/);
  }
  assert.throws(
    () => sessionUnobserve(store, 's1', 'links', 'abc-1', 'branch:abc-2'),
    /observed no links edge .*; observed by session:s3, each taken back by its own id/,
  );
  assert.deepEqual(sessionUnobserve(store, 's3', 'links', 'abc-1', 'branch:abc-2').others, []);
  assert.equal(line('abc-1').name, 'abc-1');
});

test('an edge taken back is put back with the time it was first seen, after later writes refuse the undo', () => {
  newRecord(store, 'session', 's4', { agent: 'agent:claude-code' });
  sessionObserve(store, 's4', 'links', 'change:abc-2', 'branch:early', '2026-01-01T00:00:00.000Z');
  sessionObserve(store, 's4', 'links', 'change:abc-2', 'branch:late');
  const r = sessionUnobserve(store, 's4', 'links', 'abc-2', 'branch:early');
  assert.deepEqual(r.at, ['2026-01-01T00:00:00.000Z']);
  assert.match(findSession(loadStore(store), 's4')!.body, /took back .* \(observed 2026-01-01T00:00:00.000Z\)/);
  sessionObserve(store, 's4', 'links', 'change:abc-2', 'file:src/b.ts');
  assert.throws(() => undo(store, { commit: r.commit ?? '' }), /later write/);
  sessionObserve(store, 's4', 'links', r.from, r.to, r.at[0]);
  // restored with a new time it would have become the newest and taken the line
  assert.equal(line('abc-2').name, 'late');
  assert.throws(() => sessionObserve(store, 's4', 'links', r.from, r.to, 'yesterday'), /--at takes a time/);
});

test('set branch= on a change is refused naming unobserve and each session that observed a branch on it', () => {
  assert.throws(
    () => set(store, 'change:abc-2', ['branch=abc-2'], {}),
    /'branch' cannot be set on a change: .*pjman session unobserve <session> links change:\S*abc-2 branch:<name>[\s\S]*branch:late, observed by session:s4 at \S+: pjman session unobserve s4 links change:\S*abc-2 branch:late/,
  );
});
