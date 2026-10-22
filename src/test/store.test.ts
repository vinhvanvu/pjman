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
import { set } from '../commands/set.js';
import { changeContext, decisionLine, formatLs, formatStoreContext, ls, storeContext } from '../commands/view.js';
import { findStore, writeStoreConfig, type Store } from '../config.js';
import { get, keyFromUrl } from '../graph.js';
import { renderView } from '../commands/pane.js';
import { buildIndex } from '../indexdb.js';
import { loadStore } from '../records.js';
import { localDate, today } from '../util.js';
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

test('init creates the global store, its own repository, and registers the repository as a project', () => {
  const lines = init({ cwd: project });
  assert.ok(lines.some((l) => /created the global store/.test(l)));
  const found = findStore(project);
  assert.ok(found);
  store = found;
  assert.equal(store.mode, 'standalone');
  assert.equal(store.root, path.join(home, 'store'));
  assert.equal(store.config.name, 'global');
  assert.equal(store.project, 'project:project');
  assert.ok(loadStore(store).byKey.has('project:project'));
  writeStoreConfig(store.root, { ...store.config, vocabulary: { merged: 'done' } });
  store = findStore(project)!;
  assert.match(git(store.root, 'log', '--format=%s'), /pjman: new project:project\npjman: init store global$/);
  assert.ok(fs.existsSync(path.join(store.root, '.gitignore')));
  assert.deepEqual(init({ cwd: project }).filter((l) => /already registered/.test(l)).length, 1);
});

test('new change, decision, source, actor, session validate and commit', () => {
  const c = newRecord(store, 'change', 'schema', { title: 'Schema: v3', summary: 'The contract.', links: ['file:SCHEMA.md'] });
  assert.equal(c.key, 'change:schema');
  assert.ok(c.commit);
  assert.equal(loadStore(store).byKey.get('change:schema')![0].data.project, 'project:project');
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

test('set changes authored fields and refuses what would not validate', () => {
  const r = set(store, 'change:alpha', ['status=active', 'next=write the plan: soon', 'links=file:A.md,file:B.md'], {});
  assert.deepEqual(r.changed, ['status', 'next', 'links']);
  const rec = loadStore(store).byKey.get('change:alpha')![0];
  assert.equal(rec.data.status, 'active');
  assert.deepEqual(rec.data.links, ['file:A.md', 'file:B.md']);
  assert.match(fs.readFileSync(rec.abs, 'utf8'), /^next: "write the plan: soon"$/m);
  set(store, 'change:alpha', ['summary=What it is now.', 'plan=Step one.'], {});
  const body = loadStore(store).byKey.get('change:alpha')![0];
  assert.equal(body.sections.get('Summary'), 'What it is now.');
  assert.equal(body.sections.get('Plan'), 'Step one.');
  assert.equal(body.data.status, 'active');
  set(store, 'change:alpha', ['plan='], {});
  assert.equal(loadStore(store).byKey.get('change:alpha')![0].sections.has('Plan'), false);
  assert.throws(() => set(store, 'change:alpha', ['summary='], {}), /Summary/);
  const proposed = loadStore(store).records.find((r) => r.type === 'decision' && r.data.status === 'proposed');
  if (proposed) {
    set(store, proposed.key, ['why=Because.'], {});
    assert.equal(loadStore(store).byKey.get(proposed.key)![0].sections.get('Why'), 'Because.');
  }
  const decided = loadStore(store).records.find((r) => r.type === 'decision' && r.data.status === 'decided')!;
  assert.throws(() => set(store, decided.key, ['decision=changed'], {}), /text is fixed/);
  assert.throws(() => set(store, 'change:alpha', ['status=merged'], {}), /maps it to 'done'/);
  assert.equal(loadStore(store).byKey.get('change:alpha')![0].data.status, 'active');
  assert.throws(() => set(store, 'session:sess-1', ['agent=agent:x'], {}), /append-only/);
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
  const old = ctx.decisions.find((d) => d.key === 'decision:contract/keys')!;
  assert.equal(decisionLine(old), 'superseded by decision:contract/keys-and-aliases');
  const dated = ls(store, { type: 'decision' }).map((r) => r.path);
  assert.deepEqual(dated, [...dated].sort((a, b) => a.localeCompare(b)));
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

test('a second repository joins the same global store as its own project; the board scopes by project', () => {
  const p3 = path.join(tmp, 'p3');
  fs.mkdirSync(path.join(p3, 'src'), { recursive: true });
  git(p3, 'init', '-q');
  git(p3, 'remote', 'add', 'origin', 'git@github.com:acme/other.git');
  init({ cwd: p3, name: 'Other' });
  const s3 = findStore(path.join(p3, 'src'))!;
  assert.equal(s3.root, store.root);
  assert.equal(s3.project, 'project:other');
  assert.deepEqual(loadStore(s3).byKey.get('project:other')![0].data.links, ['git-repo:acme/other']);
  newRecord(s3, 'change', 'x2', { title: 'X2', summary: 's' });
  assert.deepEqual(storeContext(s3, { project: s3.project }).changes.map((r) => r.key), ['change:x2']);
  const all = storeContext(store, { project: null });
  assert.ok(all.changes.some((r) => r.key === 'change:x2') && all.changes.some((r) => r.data.project === 'project:project'));
  assert.equal(ls(store, { type: 'change', project: 'project:other' }).length, 1);
  assert.throws(() => set(store, 'change:x2', ['project=project:nope'], {}), /does not resolve/);
  set(store, 'change:x2', ['project=project:project'], {});
  assert.equal(storeContext(s3, { project: 'project:other' }).changes.length, 0);
  assert.throws(() => storeContext(store, { project: 'project:nope' }), /does not resolve to a project/);
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

test('the store resolves from inside its own directory, unscoped', () => {
  const inside = findStore(path.join(store.root, 'changes'));
  assert.ok(inside);
  assert.equal(inside.root, store.root);
  assert.equal(inside.project, undefined);
});

test('dates are local calendar days; ls shows them', () => {
  assert.equal(localDate(new Date(2026, 9, 21, 23, 30)), '2026-10-21');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 10)), '2026-01-01');
  assert.equal(today(), localDate(new Date()));
  const r = newRecord(store, 'change', 'dated', { title: 'Dated' });
  const line = formatLs(ls(store, { type: 'change' })).split('\n').find((l) => l.includes('change:dated'));
  assert.ok(line);
  assert.match(line, new RegExp(`^change   ${today()}  change:dated`));
  fs.rmSync(path.join(store.root, path.dirname(r.path)), { recursive: true });
});

test('the getter: any shape in, the record and the changes in reach out', () => {
  let loaded = loadStore(store);
  // change:schema was renamed to change:contract above; the former slug still resolves
  const byAlias = get(loaded, 'change:schema');
  assert.equal(byAlias.resolution.status, 'alias');
  assert.equal(byAlias.resolution.key, 'change:contract');
  assert.equal(byAlias.via['change:contract'], 'self');
  const bySource = get(loaded, 'file:SCHEMA.md');
  assert.equal(bySource.resolution.status, 'record');
  assert.deepEqual(bySource.changes.map((c) => c.change.key), ['change:contract']);
  assert.equal(bySource.via['change:contract'], 'links');
  const byPath = get(loaded, path.join(project, 'SCHEMA.md'), { cwd: project, projectDir: project });
  assert.equal(byPath.resolution.key, 'file:SCHEMA.md');
  assert.equal(byPath.resolution.shape, 'file path');
  const byDecision = get(loaded, 'keys');
  assert.equal(byDecision.resolution.key, 'decision:contract/keys');
  assert.equal(byDecision.via['change:contract'], 'in');
  assert.equal(get(loaded, 'sess-1').resolution.key, 'session:sess-1');
  assert.equal(get(loaded, 'nothing-here').resolution.status, 'none');

  newRecord(store, 'change', 'abc', { title: 'ABC', summary: 's', binds: ['linear:ABC-1234'] });
  loaded = loadStore(store);
  const byTicket = get(loaded, 'ABC-1234');
  assert.equal(byTicket.resolution.status, 'key');
  assert.equal(byTicket.resolution.key, 'linear:ABC-1234');
  assert.deepEqual(byTicket.changes.map((c) => c.change.key), ['change:abc']);
  assert.equal(byTicket.via['change:abc'], 'binds');
  const byUrl = get(loaded, 'https://linear.app/acme/issue/ABC-1234/some-title');
  assert.equal(byUrl.resolution.key, 'linear:ABC-1234');
  assert.equal(byUrl.resolution.shape, 'url');
  assert.deepEqual(byUrl.changes.map((c) => c.change.key), ['change:abc']);
  assert.equal(keyFromUrl('https://github.com/acme/app/pull/7'), 'github-pr:acme/app#7');
  assert.equal(keyFromUrl('https://github.com/acme/app/issues/8'), 'github-issue:acme/app#8');
  assert.equal(keyFromUrl('https://github.com/acme/app'), 'git-repo:acme/app');
  assert.equal(get(loaded, 'https://github.com/acme/app/pull/7').changes.length, 0);

  // a bare id nothing references resolves only through the project's tracker
  assert.equal(get(loaded, 'XYZ-9', { project: 'project:project' }).resolution.status, 'none');
  assert.throws(() => set(store, 'project:project', ['tracker=nope'], {}), /not in source_kinds/);
  set(store, 'project:project', ['tracker=linear'], {});
  const viaTracker = get(loadStore(store), 'XYZ-9', { project: 'project:project' });
  assert.equal(viaTracker.resolution.status, 'key');
  assert.equal(viaTracker.resolution.key, 'linear:XYZ-9');
  fs.rmSync(path.join(store.root, 'changes/abc'), { recursive: true });
});

test('a change may have a parent change: any depth, no cycles, children derived, the board nests', () => {
  newRecord(store, 'change', 'epic', { title: 'Epic', summary: 's' });
  newRecord(store, 'change', 'epic-a', { title: 'A', summary: 's', parent: 'change:epic' });
  newRecord(store, 'change', 'epic-a-1', { title: 'A1', summary: 's', parent: 'change:epic-a' });
  assert.throws(() => newRecord(store, 'change', 'orphan', { title: 'O', summary: 's', parent: 'change:nope' }), /parent/);
  assert.throws(() => set(store, 'change:epic', ['parent=change:epic-a-1'], {}), /cycles/);
  assert.throws(() => set(store, 'change:epic', ['parent=change:epic'], {}), /cycles/);
  const ctx = changeContext(store, 'change:epic-a');
  assert.equal(ctx.parent?.key, 'change:epic');
  assert.deepEqual(ctx.children.map((r) => r.key), ['change:epic-a-1']);
  const board = formatStoreContext(storeContext(store, { project: 'project:project' }));
  assert.match(board, /^- change:epic — Epic\n  - change:epic-a \[open\] — A\n    - change:epic-a-1 \[open\] — A1$/m);
  const n = get(loadStore(store), 'change:epic-a');
  assert.equal(n.via['change:epic'], 'parent');
  assert.equal(n.via['change:epic-a-1'], 'parent');
  assert.deepEqual(errors(store), []);
  for (const c of ['epic-a-1', 'epic-a', 'epic']) fs.rmSync(path.join(store.root, 'changes', c), { recursive: true });
});

test('the view renders a reference, or what a session is on', () => {
  const one = renderView(store, { ref: 'change:contract' });
  assert.match(one.markdown, /^# change:contract\n## Schema: v3\n/);
  assert.match(one.markdown, /### Decisions\n- /);
  assert.equal(one.showing.key, 'change:contract');
  const bySource = renderView(store, { ref: 'file:SCHEMA.md' });
  assert.match(bySource.markdown, /^# file:SCHEMA.md\n## The schema/);
  assert.match(bySource.markdown, /_reached through links_\n\n# change:contract/);
  newRecord(store, 'session', 'sess-v', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  const board = renderView(store, { session: 'sess-v', project: 'project:project' });
  assert.equal(board.showing.board, 'project:project');
  assert.match(board.markdown, /^# project:project\n/);
  sessionBind(store, 'sess-v', 'change:contract');
  const followed = renderView(store, { session: 'session:sess-v' });
  assert.equal(followed.showing.key, 'change:contract');
  assert.match(followed.markdown, /following session:sess-v · pjman view_/);
  assert.throws(() => renderView(store, { session: 'nope' }), /does not resolve to a session/);
});
