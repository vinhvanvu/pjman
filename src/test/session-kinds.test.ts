// Sessions with no change (change:unbound-sessions): a session kind is a record with the five verbs, four seeded with
// the store (decision unbound-sessions/kinds); one command names a session and infers what it is not given from the
// session's own record, creating a kind it lacks (decision unbound-sessions/naming); the sources such a session reads
// are observed edges from the session itself, so the getter finds it from a PR (decision unbound-sessions/sources).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { loadStoreConfig, writeStoreConfig, findStore, type Store } from '../store/config.js';
import { migrate, pendingMigration } from '../ops/migrate.js';
import { mv } from '../ops/mv.js';
import { newRecord } from '../ops/new.js';
import { rm } from '../ops/rm.js';
import { sessionBind, sessionLog, sessionName, sessionObserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { ls } from '../model/view.js';
import { get } from '../model/graph.js';
import { findSession, loadStore } from '../store/records.js';
import { DEFAULT_SESSION_KINDS, inferSessionKind, ownSources } from '../ops/session-kinds.js';
import { validate } from '../model/validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-session-kinds-'));
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
const session = (id: string) => findSession(loadStore(store), id)!;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
  change(store, 'cart', { title: 'The cart', summary: 's', project: 'project:web' });
  newRecord(store, 'source', 'github-pr:acme/web#7', { title: 'Round the tax up' });
});

test('the four kinds come with the store, each a record with a name and a gist, listed as an entity', () => {
  const rows = ls(store, { type: 'session-kind' });
  assert.deepEqual(
    rows.map((r) => r.key).toSorted(),
    DEFAULT_SESSION_KINDS.map((k) => `session-kind:${k.slug}`).toSorted(),
  );
  for (const r of rows) {
    assert.ok(r.name, `${r.key} has a name`);
    assert.ok(r.gist, `${r.key} has a gist`);
  }
  assert.equal(fs.existsSync(path.join(store.root, 'session-kinds', 'review.md')), true);
  assert.equal(errors().length, 0);
});

test("a PR observed on the session itself names it review by inference, after the source's title; the getter finds the session from the PR", () => {
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionObserve(store, 's1', 'links', 'session:s1', 'github-pr:acme/web#7');
  assert.deepEqual(
    ownSources(session('s1')).map((s) => s.to),
    ['github-pr:acme/web#7'],
  );
  const inferred = inferSessionKind(loadStore(store), session('s1'));
  assert.deepEqual(inferred, { kind: 'review', name: 'Round the tax up', from: 'github-pr:acme/web#7' });
  const r = sessionName(store, 's1', {});
  assert.equal(r.name, 'Round the tax up');
  assert.equal(r.kind, 'session-kind:review');
  assert.equal(r.inferred, 'github-pr:acme/web#7');
  assert.equal(r.createdKind, false);
  const rec = session('s1');
  assert.equal(rec.data.name, 'Round the tax up');
  assert.equal(rec.data.kind, 'session-kind:review');
  assert.match(rec.body, /named "Round the tax up" \(review\), read from github-pr:acme\/web#7/);
  // the same name again writes nothing
  assert.equal(sessionName(store, 's1', {}).commit, null);
  const n = get(loadStore(store), 'github-pr:acme/web#7');
  assert.ok(
    n.in.some((e) => e.from === 'session:s1' && e.edge === 'links' && e.observed),
    'the PR is referenced by the session that read it',
  );
  assert.deepEqual(
    ls(store, { type: 'session', kind: 'review' }).map((r) => r.key),
    ['session:s1'],
  );
  assert.match(ls(store, { type: 'session', kind: 'review' })[0].title ?? '', /Round the tax up \(review\)/);
  assert.equal(errors().length, 0);
});

test('a ticket with no change bound reads backlog by its key; a session with only log lines reads chat and needs a name; a bare record infers nothing', () => {
  newRecord(store, 'session', 's2', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionObserve(store, 's2', 'links', 'session:s2', 'github-issue:acme/web#12');
  assert.deepEqual(inferSessionKind(loadStore(store), session('s2')), {
    kind: 'backlog',
    name: 'acme/web#12',
    from: 'github-issue:acme/web#12',
  });
  newRecord(store, 'session', 's3', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  assert.equal(inferSessionKind(loadStore(store), session('s3')), null);
  assert.throws(() => sessionName(store, 's3', {}), /nothing on session:s3 says what it is doing/);
  sessionLog(store, 's3', 'session started');
  sessionLog(store, 's3', 'explained the order');
  assert.deepEqual(inferSessionKind(loadStore(store), session('s3')), { kind: 'chat', from: 'its log' });
  assert.throws(() => sessionName(store, 's3', {}), /reads as chat but nothing on it names it/);
  const r = sessionName(store, 's3', { name: 'Explaining the order' });
  assert.equal(r.kind, 'session-kind:chat');
  assert.equal(r.inferred, 'its log');
});

test('a kind handed to the naming command that the store lacks is created on the spot; one that is a slug of nothing is refused; the name is one to four words', () => {
  newRecord(store, 'session', 's4', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  const r = sessionName(store, 's4', { name: 'Sorting the week', kind: 'triage' });
  assert.equal(r.createdKind, true);
  assert.equal(r.kind, 'session-kind:triage');
  assert.equal(session('s4').data.kind, 'session-kind:triage');
  const kind = loadStore(store).byKey.get('session-kind:triage')?.[0];
  assert.equal(kind?.data.name, 'Triage');
  assert.throws(() => sessionName(store, 's4', { name: 'Sorting the week', kind: 'Not A Slug' }), /is not a slug/);
  assert.throws(() => sessionName(store, 's4', { name: 'one two three four five', kind: 'triage' }), /name: 5 words/);
  assert.throws(() => sessionName(store, 's4', { name: 'x', kind: 'change:cart' }), /not a session kind/);
  assert.throws(
    () => ls(store, { type: 'session', kind: 'nope' }),
    /--kind nope is not a session kind \(backlog, chat, other, review, triage\)/,
  );
  assert.equal(errors().length, 0);
});

test('a session that later binds a change keeps its name and kind; the edges it observed on itself stay', () => {
  sessionBind(store, 's1', 'change:cart');
  const rec = session('s1');
  assert.equal(rec.data.name, 'Round the tax up');
  assert.equal(rec.data.kind, 'session-kind:review');
  assert.deepEqual(
    ownSources(rec).map((s) => s.to),
    ['github-pr:acme/web#7'],
  );
  assert.equal(errors().length, 0);
});

test('rm is refused while a session carries the kind; mv renames it and every session follows, the old slug an alias; set changes its gist', () => {
  assert.throws(
    () => rm(store, 'session-kind:triage'),
    /refused: session-kind:triage is referenced by\n  session:s4  kind/,
  );
  const r = mv(store, 'session-kind:triage', 'session-kind:sorting', {});
  assert.equal(r.to, 'session-kind:sorting');
  assert.equal(session('s4').data.kind, 'session-kind:sorting');
  const loaded = loadStore(store);
  assert.deepEqual(loaded.aliases.get('session-kind:triage'), ['session-kind:sorting']);
  assert.deepEqual(
    ls(store, { type: 'session', kind: 'triage' }).map((x) => x.key),
    ['session:s4'],
  );
  set(store, 'session-kind:sorting', ['gist=Tickets sorted into changes'], {});
  assert.equal(loadStore(store).byKey.get('session-kind:sorting')?.[0].data.gist, 'Tickets sorted into changes');
  assert.throws(() => newRecord(store, 'session-kind', 'triage', {}), /former name of session-kind:sorting/);
  // a kind no session carries goes
  sessionName(store, 's4', { name: 'Sorting the week', kind: 'backlog' });
  assert.equal(rm(store, 'session-kind:sorting').removed.length, 1);
  assert.equal(errors().length, 0);
});

test('validate refuses a session whose kind is not a session kind record, and a kind record with a long name', () => {
  const rec = session('s2');
  const text = fs.readFileSync(rec.abs, 'utf8').replace(/^project: .*$/m, (m) => `${m}\nkind: session-kind:nowhere`);
  fs.writeFileSync(rec.abs, text);
  const messages = () =>
    errors()
      .map((p) => p.message)
      .join('\n');
  assert.ok(
    errors().some((p) => /kind: 'session-kind:nowhere' does not resolve/.test(p.message)),
    messages(),
  );
  fs.writeFileSync(rec.abs, text.replace('kind: session-kind:nowhere', 'kind: change:web/cart'));
  assert.ok(
    errors().some((p) => /kind: 'change:web\/cart' must be a session-kind key/.test(p.message)),
    messages(),
  );
  fs.writeFileSync(rec.abs, text.replace('\nkind: session-kind:nowhere', ''));
  assert.equal(errors().length, 0);
});

test('the session-kinds move: a store stamped before 0.3.0 that lacks the four gets them created, one write each, then the stamp', () => {
  for (const k of ['chat', 'other']) fs.rmSync(path.join(store.root, 'session-kinds', `${k}.md`));
  execFileSync('git', ['add', '-A'], { cwd: store.root });
  execFileSync('git', ['commit', '-qm', 'test: two kinds dropped'], { cwd: store.root });
  writeStoreConfig(store.root, { ...loadStoreConfig(store.root), version: '0.2.0' });
  execFileSync('git', ['commit', '-qam', 'test: stamped 0.2.0'], { cwd: store.root });
  const old = findStore(path.join(tmp, 'web'))!;
  assert.equal(pendingMigration(old), 'session-kinds');
  const r = migrate(old, {});
  assert.equal(r.kind, 'session-kinds');
  assert.equal(r.rewritten, 2);
  assert.ok(r.commit);
  const four = DEFAULT_SESSION_KINDS.map((k) => `session-kind:${k.slug}`);
  assert.deepEqual(
    ls(old, { type: 'session-kind' })
      .map((x) => x.key)
      .filter((k) => four.includes(k))
      .toSorted(),
    [...four].toSorted(),
  );
  assert.equal(pendingMigration(old), 'stamp');
  assert.equal(migrate(old, {}).kind, 'stamp');
  assert.equal(pendingMigration(findStore(path.join(tmp, 'web'))!), null);
  assert.equal(errors().length, 0);
});
