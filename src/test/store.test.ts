import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fmt } from '../commands/fmt.js';
import { init } from '../commands/init.js';
import { mv } from '../commands/mv.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionLog, sessionObserve } from '../commands/session.js';
import { changeContext } from '../commands/view.js';
import { findStore, type Store } from '../config.js';
import { buildIndex } from '../indexdb.js';
import { loadStore } from '../records.js';
import { validate } from '../validate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-test-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const errors = (store: Store) => validate(loadStore(store)).filter((p) => p.level === 'error');

let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
});

test('init standalone creates its own repository and binds the project', () => {
  init({ cwd: project, dir: path.join(tmp, 'store') });
  const found = findStore(project);
  assert.ok(found);
  store = found;
  assert.equal(store.mode, 'standalone');
  assert.equal(git(store.root, 'log', '--format=%s'), 'pjman: init store project');
  assert.ok(fs.existsSync(path.join(store.root, '.gitignore')));
});

test('new change, decision, source, actor, session validate and commit', () => {
  const c = newRecord(store, 'change', 'schema', { title: 'Schema: v3', summary: 'The contract.', links: ['file:SCHEMA.md'] });
  assert.equal(c.key, 'change:schema');
  assert.ok(c.commit);
  const d = newRecord(store, 'decision', 'schema/keys', { title: 'Keys', decision: 'Keys.', why: 'Because.', created: '2026-10-10' });
  assert.equal(d.path, 'changes/schema/decisions/2026-10-10-keys.md');
  newRecord(store, 'source', 'file:SCHEMA.md', { title: 'The schema' });
  newRecord(store, 'actor', 'person:tester', { name: 'Tester' });
  newRecord(store, 'session', 'sess-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  assert.deepEqual(errors(store), []);
  const text = fs.readFileSync(path.join(store.root, 'changes/schema/change.md'), 'utf8');
  assert.match(text, /^title: "Schema: v3"$/m);
  assert.match(text, /^writer: person:tester$/m);
});

test('a decision that supersedes marks its target superseded', () => {
  const r = newRecord(store, 'decision', 'schema/keys-and-aliases', {
    title: 'Keys and aliases', decision: 'x', why: 'y', decidedBy: 'person:tester', supersedes: 'decision:schema/keys',
  });
  assert.deepEqual(r.notes, ['decision:schema/keys is now superseded']);
  const loaded = loadStore(store);
  assert.equal(loaded.byKey.get('decision:schema/keys')![0].data.status, 'superseded');
  assert.deepEqual(errors(store), []);
});

test('the tool refuses what would not validate and undoes the write', () => {
  newRecord(store, 'change', 'alpha', { title: 'Alpha', summary: 'a', binds: ['linear:ABC-1'] });
  assert.throws(() => newRecord(store, 'change', 'beta', { title: 'Beta', summary: 'b', binds: ['linear:ABC-1'] }), /also bound by change:alpha/);
  assert.ok(!fs.existsSync(path.join(store.root, 'changes/beta')));
  assert.throws(() => newRecord(store, 'change', 'gamma', { title: 'G', status: 'implementing' }), /not in the vocabulary/);
  assert.throws(() => newRecord(store, 'decision', 'nope/x', { title: 'x' }), /does not exist/);
  assert.throws(() => newRecord(store, 'decision', 'alpha/agentic', { title: 'x', status: 'decided', writer: 'agent:bot' }), /not the decider/);
  assert.throws(() => newRecord(store, 'source', 'bogus:1', { title: 'x' }), /not in source_kinds/);
});

test('sessions append: bind, log, observe', () => {
  sessionBind(store, 'sess-1', 'change:schema');
  sessionLog(store, 'sess-1', 'did a thing');
  sessionObserve(store, 'sess-1', 'links', 'change:schema', 'file:THESIS.md');
  const rec = loadStore(store).byKey.get('session:sess-1')![0];
  assert.deepEqual(rec.data.changes, ['change:schema']);
  assert.equal((rec.data.observed as unknown[]).length, 1);
  assert.match(rec.sections.get('Log')!, /did a thing/);
  assert.deepEqual(errors(store), []);
  assert.match(git(store.root, 'log', '-1', '--format=%B'), /Pjman-Session: session:sess-1/);
});

test('validate reports hand-written faults by path and reason, never drops', () => {
  fs.mkdirSync(path.join(store.root, 'changes/hand'), { recursive: true });
  fs.writeFileSync(path.join(store.root, 'changes/hand/change.md'), '---\ntitle: Hand: written\nstatus: open\n---\nno summary\n');
  const problems = validate(loadStore(store));
  const hand = problems.filter((p) => p.path === 'changes/hand/change.md');
  assert.ok(hand.some((p) => /pjman fmt/.test(p.message)));
  const r = fmt(store, {});
  assert.deepEqual(r.changed, ['changes/hand/change.md']);
  const after = validate(loadStore(store)).filter((p) => p.path === 'changes/hand/change.md').map((p) => p.message);
  assert.deepEqual(after, ["body is missing the '## Summary' section"]);
  fs.rmSync(path.join(store.root, 'changes/hand'), { recursive: true });
});

test('mv renames the folder, leaves an alias, rewrites references', () => {
  const r = mv(store, 'change:schema', 'change:contract', {});
  assert.ok(r.rewritten.includes('sessions/' + fs.readdirSync(path.join(store.root, 'sessions')).find((f) => f.endsWith('.md'))));
  const loaded = loadStore(store);
  const c = loaded.byKey.get('change:contract')![0];
  assert.deepEqual(c.data.aliases, ['schema']);
  assert.ok(loaded.byKey.has('decision:contract/keys-and-aliases'));
  assert.equal(loaded.byKey.get('decision:contract/keys-and-aliases')![0].data.supersedes, 'decision:contract/keys');
  assert.deepEqual(loaded.byKey.get('session:sess-1')![0].data.changes, ['change:contract']);
  assert.deepEqual(errors(store), []);
  const ctx = changeContext(store, 'change:schema'); // via alias
  assert.equal(ctx.change.key, 'change:contract');
  assert.equal(ctx.decisions.length, 2);
  assert.equal(ctx.sessions.length, 1);
});

test('index mints stable ids, derives reverse edges, records conflicts', async () => {
  const a = buildIndex(store);
  assert.equal(a.conflicts.length, 0);
  assert.ok(a.edges > 0);
  const b = buildIndex(store);
  assert.equal(a.records.change, b.records.change);
  // same key keeps its id across rebuilds
  const { query } = await import('../indexdb.js');
  const id1 = (query(store, "select id from records where key='change:contract'") as { id: string }[])[0].id;
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  buildIndex(store);
  const id2 = (query(store, "select id from records where key='change:contract'") as { id: string }[])[0].id;
  assert.equal(id1, id2);
  const rev = query(store, "select from_key from edges where edge='in' and to_key='change:contract'") as { from_key: string }[];
  assert.equal(rev.length, 2);
  // a hand-written double bind is a conflict, not a silent winner
  fs.mkdirSync(path.join(store.root, 'changes/beta'), { recursive: true });
  fs.writeFileSync(path.join(store.root, 'changes/beta/change.md'), '---\ntitle: Beta\nstatus: open\nbinds:\n  - linear:ABC-1\n---\n\n## Summary\n\nb\n');
  const c = buildIndex(store);
  assert.equal(c.conflicts.length, 1);
  assert.equal(c.conflicts[0].kind, 'double-bind');
  fs.rmSync(path.join(store.root, 'changes/beta'), { recursive: true });
});

test('init --in-project never commits; the store resolves by walking up', () => {
  const p2 = path.join(tmp, 'p2');
  fs.mkdirSync(path.join(p2, 'src'), { recursive: true });
  git(p2, 'init', '-q');
  init({ cwd: p2, inProject: true });
  const s = findStore(path.join(p2, 'src'));
  assert.ok(s);
  assert.equal(s.mode, 'in-project');
  const r = newRecord(s, 'change', 'x', { title: 'X', summary: 's' });
  assert.equal(r.commit, null);
  assert.match(git(p2, 'status', '--short'), /\.pjman/);
});
