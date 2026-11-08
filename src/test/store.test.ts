import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { fmt } from '../commands/fmt.js';
import { init } from '../commands/init.js';
import { mv } from '../commands/mv.js';
import { apply, undo } from '../commands/apply.js';
import { rm } from '../commands/rm.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionLog, sessionObserve } from '../commands/session.js';
import { set } from '../commands/set.js';
import { changeContext, decisionLine, formatChangeContext, formatLs, formatStoreContext, ls, storeContext } from '../commands/view.js';
import { findStore, readUserConfig, writeStoreConfig, type Store } from '../config.js';
import { findReferences, get, keyFromUrl } from '../graph.js';
import { renderView, viewData } from '../commands/pane.js';
import { BRIEF, installBrief } from '../commands/brief.js';
import { start, stop } from '../commands/start.js';
import { readServeAddress } from '../server.js';
import { follow, readEvents, rebuildEvents } from '../events.js';
import { receipt } from '../receipt.js';
import { buildIndex } from '../indexdb.js';
import { loadStore, resolve as resolveKey } from '../records.js';
import { localDate, today } from '../util.js';
import { validate } from '../validate.js';
import { accept, change, decisionRec, next } from './shape.js';
import { step } from '../commands/step.js';

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
  const lines = init({ checkers: [], cwd: project });
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
  assert.match(git(store.root, 'log', '--format=%s'), /pjman: new project:project\npjman: new product:project\npjman: new person:tester\npjman: init store global$/);
  assert.ok(fs.existsSync(path.join(store.root, '.gitignore')));
  assert.deepEqual(init({ checkers: [], cwd: project }).filter((l) => /already registered/.test(l)).length, 1);
});

test('new change, decision, source, actor, session validate and commit', () => {
  const c = change(store, 'schema', { title: 'Schema: v3', summary: 'The contract.', links: ['file:SCHEMA.md'] });
  assert.equal(c.key, 'change:project/schema');
  assert.ok(c.commit);
  assert.equal(loadStore(store).byKey.get('change:project/schema')![0].data.project, 'project:project');
  const d = decisionRec(store, 'schema/keys', { title: 'Keys', decision: 'Keys.', why: 'Because.', created: '2026-10-10' });
  assert.equal(d.path, 'products/project/changes/schema/decisions/2026-10-10-keys.md');
  newRecord(store, 'source', 'file:SCHEMA.md', { title: 'The schema' });
  assert.ok(loadStore(store).byKey.has('person:tester')); // init made the person record
  newRecord(store, 'session', 'sess-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  assert.deepEqual(errors(store), []);
  const text = fs.readFileSync(path.join(store.root, 'products/project/changes/schema/change.md'), 'utf8');
  assert.match(text, /^gist: "Schema: v3"$/m);
  assert.match(text, /^name: "Schema: v3"$/m);
  assert.match(text, /^## Origin\n\n> asked for in a test/m);
  assert.match(text, /^writer: person:tester$/m);
});

test('a decision that supersedes marks its target superseded', () => {
  const r = decisionRec(store, 'schema/keys-and-aliases', {
    title: 'Keys and aliases', decision: 'x', why: 'y', decidedBy: 'person:tester', supersedes: 'decision:project/schema/keys',
  });
  assert.deepEqual(r.notes, ['decision:project/schema/keys is now superseded']);
  const loaded = loadStore(store);
  assert.equal(loaded.byKey.get('decision:project/schema/keys')![0].data.status, 'superseded');
  assert.deepEqual(errors(store), []);
});

test('the tool refuses what would not validate and undoes the write', () => {
  change(store, 'alpha', { title: 'Alpha', summary: 'a', binds: ['linear:ABC-1'] });
  assert.throws(() => change(store, 'beta', { title: 'Beta', summary: 'b', binds: ['linear:ABC-1'] }), /also bound by change:project\/alpha/);
  assert.ok(!fs.existsSync(path.join(store.root, 'products/project/changes/beta')));
  assert.throws(() => change(store, 'gamma', { title: 'G', status: 'implementing' }), /not in the vocabulary/);
  assert.throws(() => decisionRec(store, 'nope/x', { title: 'x' }), /does not exist/);
  assert.throws(() => decisionRec(store, 'alpha/agentic', { title: 'x', status: 'decided', writer: 'agent:bot' }), /not the decider/);
  assert.throws(() => change(store, 'nameless', { title: 'x', name: 'one two three four five' }), /one to four/);
  assert.throws(() => change(store, 'twoline', { gist: "a\nb" }), /one line/);
  assert.throws(() => newRecord(store, 'source', 'bogus:1', { title: 'x' }), /not in source_kinds/);
});

test('sessions append: bind, log, observe', () => {
  sessionBind(store, 'sess-1', 'change:project/schema');
  sessionLog(store, 'sess-1', 'did a thing');
  sessionObserve(store, 'sess-1', 'links', 'change:project/schema', 'file:THESIS.md');
  const rec = loadStore(store).byKey.get('session:sess-1')![0];
  assert.deepEqual(rec.data.changes, ['change:project/schema']);
  assert.equal((rec.data.observed as unknown[]).length, 1);
  assert.match(rec.sections.get('Log')!, /did a thing/);
  assert.deepEqual(errors(store), []);
  assert.match(git(store.root, 'log', '-1', '--format=%B'), /Pjman-Session: session:sess-1/);
});

test('a session started just before local midnight is named by that day and validates', () => {
  // 23:30 local on 2026-10-25, as the UTC instant the hook records; its UTC day may already be the 26th
  const local = new Date(2026, 9, 25, 23, 30);
  const r = newRecord(store, 'session', 'late-night', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', started: local.toISOString() });
  assert.equal(r.path, 'sessions/2026-10-25-late-night.md');
  const warnings = validate(loadStore(store)).filter((p) => p.path === r.path);
  assert.deepEqual(warnings, []);
  rm(store, 'session:late-night', {});
});

test('validate reports hand-written faults by path and reason, never drops', () => {
  fs.mkdirSync(path.join(store.root, 'products/project/changes/hand'), { recursive: true });
  fs.writeFileSync(path.join(store.root, 'products/project/changes/hand/change.md'), '---\ngist: Hand: written\nstatus: open\n---\nno origin\n');
  const problems = validate(loadStore(store));
  const hand = problems.filter((p) => p.path === 'products/project/changes/hand/change.md');
  assert.ok(hand.some((p) => /pjman fmt/.test(p.message)));
  const r = fmt(store, {});
  assert.deepEqual(r.changed, ['products/project/changes/hand/change.md']);
  const after = validate(loadStore(store)).filter((p) => p.path === 'products/project/changes/hand/change.md').map((p) => p.message);
  assert.deepEqual(after, ["body is missing the '## Origin' section"]);
  fs.rmSync(path.join(store.root, 'products/project/changes/hand'), { recursive: true });
});

test('set changes authored fields and refuses what would not validate', () => {
  const r = set(store, 'change:project/alpha', ['status=active', 'gist=Write the plan: soon', 'links=file:A.md,file:B.md'], {});
  assert.deepEqual(r.changed, ['status', 'gist', 'links']);
  const rec = loadStore(store).byKey.get('change:project/alpha')![0];
  assert.equal(rec.data.status, 'active');
  assert.deepEqual(rec.data.links, ['file:A.md', 'file:B.md']);
  assert.match(fs.readFileSync(rec.abs, 'utf8'), /^gist: "Write the plan: soon"$/m);
  assert.throws(() => set(store, 'change:project/alpha', ['next=x'], {}), /next is retired/);
  assert.throws(() => set(store, 'change:project/alpha', ['title=x'], {}), /no title/);
  set(store, 'change:project/alpha', ['intent=What it is now.', 'scope=In: this.'], {});
  const body = loadStore(store).byKey.get('change:project/alpha')![0];
  assert.equal(body.sections.get('Intent'), 'What it is now.');
  assert.equal(body.sections.get('Scope'), 'In: this.');
  assert.equal(body.data.status, 'active');
  set(store, 'change:project/alpha', ['scope='], {});
  assert.equal(loadStore(store).byKey.get('change:project/alpha')![0].sections.has('Scope'), false);
  assert.throws(() => set(store, 'change:project/alpha', ['origin='], {}), /Origin/);
  const decided = loadStore(store).records.find((r) => r.type === 'decision' && r.data.status === 'decided')!;
  assert.throws(() => set(store, decided.key, ['decision=changed'], {}), /thread/);
  assert.throws(() => set(store, decided.key, ['status=proposed'], {}), /follows its thread/);
  assert.throws(() => set(store, 'change:project/alpha', ['status=merged'], {}), /maps it to 'done'/);
  assert.equal(loadStore(store).byKey.get('change:project/alpha')![0].data.status, 'active');
  assert.throws(() => set(store, 'session:sess-1', ['agent=agent:x'], {}), /append-only/);
});

test('mv renames the folder, leaves an alias, rewrites references', () => {
  const r = mv(store, 'change:project/schema', 'change:project/contract', {});
  assert.ok(r.rewritten.includes('sessions/' + fs.readdirSync(path.join(store.root, 'sessions')).find((f) => f.endsWith('.md'))));
  const loaded = loadStore(store);
  const c = loaded.byKey.get('change:project/contract')![0];
  assert.deepEqual(c.data.aliases, ['schema']);
  assert.ok(loaded.byKey.has('decision:project/contract/keys-and-aliases'));
  assert.deepEqual(loaded.byKey.get('decision:project/contract/keys-and-aliases')![0].data.supersedes, ['decision:project/contract/keys']);
  assert.deepEqual(loaded.byKey.get('session:sess-1')![0].data.changes, ['change:project/contract']);
  assert.deepEqual(errors(store), []);
  const ctx = changeContext(store, 'change:project/schema'); // via alias
  assert.equal(ctx.change.key, 'change:project/contract');
  assert.equal(ctx.decisions.length, 2);
  assert.equal(ctx.sessions.length, 1);
  const old = ctx.decisions.find((d) => d.key === 'decision:project/contract/keys')!;
  assert.equal(decisionLine(old), 'superseded by decision:project/contract/keys-and-aliases');
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
  const id1 = (query(store, "select id from records where key='change:project/contract'") as { id: string }[])[0].id;
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  buildIndex(store);
  const id2 = (query(store, "select id from records where key='change:project/contract'") as { id: string }[])[0].id;
  assert.equal(id1, id2);
  const rev = query(store, "select from_key from edges where edge='in' and to_key='change:project/contract'") as { from_key: string }[];
  assert.equal(rev.length, 2);
  // a hand-written double bind is a conflict, not a silent winner
  fs.mkdirSync(path.join(store.root, 'products/project/changes/beta'), { recursive: true });
  fs.writeFileSync(path.join(store.root, 'products/project/changes/beta/change.md'), '---\ntitle: Beta\nstatus: open\nbinds:\n  - linear:ABC-1\n---\n\n## Summary\n\nb\n');
  const c = buildIndex(store);
  assert.equal(c.conflicts.length, 1);
  assert.equal(c.conflicts[0].kind, 'double-bind');
  fs.rmSync(path.join(store.root, 'products/project/changes/beta'), { recursive: true });
});

test('a second repository joins the same global store as its own project; the board scopes by project', () => {
  const p3 = path.join(tmp, 'p3');
  fs.mkdirSync(path.join(p3, 'src'), { recursive: true });
  git(p3, 'init', '-q');
  git(p3, 'remote', 'add', 'origin', 'git@github.com:acme/other.git');
  init({ checkers: [], cwd: p3, name: 'Other' });
  const s3 = findStore(path.join(p3, 'src'))!;
  assert.equal(s3.root, store.root);
  assert.equal(s3.project, 'project:other');
  assert.deepEqual(loadStore(s3).byKey.get('project:other')![0].data.links, ['git-repo:acme/other']);
  change(s3, 'x2', { title: 'X2', summary: 's' });
  assert.deepEqual(storeContext(s3, { project: s3.project }).changes.map((r) => r.key), ['change:other/x2']);
  const all = storeContext(store, { project: null });
  assert.ok(all.changes.some((r) => r.key === 'change:other/x2') && all.changes.some((r) => r.data.project === 'project:project'));
  assert.equal(ls(store, { type: 'change', project: 'project:other' }).length, 1);
  // the change is keyed under other's product: a project of another product is a move, not a field
  assert.throws(() => set(store, 'change:other/x2', ['project=project:nope'], {}), /does not resolve/);
  assert.throws(() => set(store, 'change:other/x2', ['project=project:project'], {}), /belongs to product:project; this change is keyed under product:other/);
  mv(store, 'change:other/x2', 'change:project/x2', {});
  assert.equal(loadStore(store).byKey.get('change:project/x2')![0].data.project, 'project:project');
  assert.deepEqual(loadStore(store).byKey.get('change:project/x2')![0].data.aliases, ['other/x2']);
  assert.equal(storeContext(s3, { project: 'project:other' }).changes.length, 0);
  assert.throws(() => storeContext(store, { project: 'project:nope' }), /does not resolve to a project/);
});

test('init --in-project never commits; the store resolves by walking up', () => {
  const p2 = path.join(tmp, 'p2');
  fs.mkdirSync(path.join(p2, 'src'), { recursive: true });
  git(p2, 'init', '-q');
  init({ checkers: [], cwd: p2, inProject: true });
  const s = findStore(path.join(p2, 'src'));
  assert.ok(s);
  assert.equal(s.mode, 'in-project');
  const r = change(s, 'x', { title: 'X', summary: 's' });
  assert.equal(r.commit, null);
  assert.match(git(p2, 'status', '--short'), /\.pjman/);
});

test('the store resolves from inside its own directory, unscoped', () => {
  const inside = findStore(path.join(store.root, 'products'));
  assert.ok(inside);
  assert.equal(inside.root, store.root);
  assert.equal(inside.project, undefined);
});

test('dates are local calendar days; ls shows them', () => {
  assert.equal(localDate(new Date(2026, 9, 21, 23, 30)), '2026-10-21');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 10)), '2026-01-01');
  assert.equal(today(), localDate(new Date()));
  const r = change(store, 'dated', { title: 'Dated' });
  const line = formatLs(ls(store, { type: 'change' })).split('\n').find((l) => l.includes('change:project/dated'));
  assert.ok(line);
  assert.match(line, new RegExp(`^change   ${today()}  change:project/dated`));
  fs.rmSync(path.join(store.root, path.dirname(r.path)), { recursive: true });
});

test('the getter: any shape in, the record and the changes in reach out', () => {
  let loaded = loadStore(store);
  // change:schema was renamed to change:contract above; the former slug still resolves
  const byAlias = get(loaded, 'change:project/schema');
  assert.equal(byAlias.resolution.status, 'alias');
  assert.equal(byAlias.resolution.key, 'change:project/contract');
  assert.equal(byAlias.via['change:project/contract'], 'self');
  const bySource = get(loaded, 'file:SCHEMA.md');
  assert.equal(bySource.resolution.status, 'record');
  assert.deepEqual(bySource.changes.map((c) => c.change.key), ['change:project/contract']);
  assert.equal(bySource.via['change:project/contract'], 'links');
  const byPath = get(loaded, path.join(project, 'SCHEMA.md'), { cwd: project, projectDir: project });
  assert.equal(byPath.resolution.key, 'file:SCHEMA.md');
  assert.equal(byPath.resolution.shape, 'file path');
  const byDecision = get(loaded, 'keys');
  assert.equal(byDecision.resolution.key, 'decision:project/contract/keys');
  assert.equal(byDecision.via['change:project/contract'], 'in');
  assert.equal(get(loaded, 'sess-1').resolution.key, 'session:sess-1');
  assert.equal(get(loaded, 'nothing-here').resolution.status, 'none');

  change(store, 'abc', { title: 'ABC', summary: 's', binds: ['linear:ABC-1234'] });
  loaded = loadStore(store);
  const byTicket = get(loaded, 'ABC-1234');
  assert.equal(byTicket.resolution.status, 'key');
  assert.equal(byTicket.resolution.key, 'linear:ABC-1234');
  assert.deepEqual(byTicket.changes.map((c) => c.change.key), ['change:project/abc']);
  assert.equal(byTicket.via['change:project/abc'], 'binds');
  const byUrl = get(loaded, 'https://linear.app/acme/issue/ABC-1234/some-title');
  assert.equal(byUrl.resolution.key, 'linear:ABC-1234');
  assert.equal(byUrl.resolution.shape, 'url');
  assert.deepEqual(byUrl.changes.map((c) => c.change.key), ['change:project/abc']);
  assert.equal(keyFromUrl('https://github.com/acme/app/pull/7'), 'github-pr:acme/app#7');
  assert.equal(keyFromUrl('https://github.com/acme/app/issues/8'), 'github-issue:acme/app#8');
  assert.equal(keyFromUrl('https://github.com/acme/app'), 'git-repo:acme/app');
  assert.equal(get(loaded, 'https://github.com/acme/app/pull/7').changes.length, 0);

  // a source is listed once, bound before linked, with where it opens: the record's URL, else one built from the key
  change(store, 'chips', { title: 'Chips', summary: 's', binds: ['github-issue:acme/app#8'], links: ['github-issue:acme/app#8', 'github-pr:acme/app#7', 'url:https://example.com/a', 'file:SCHEMA.md'] });
  const chips = changeContext(store, 'change:project/chips').sources;
  assert.deepEqual(chips.map((x) => [x.via, x.key, x.url]), [
    ['binds', 'github-issue:acme/app#8', 'https://github.com/acme/app/issues/8'],
    ['links', 'github-pr:acme/app#7', 'https://github.com/acme/app/pull/7'],
    ['links', 'url:https://example.com/a', 'https://example.com/a'],
    ['links', 'file:SCHEMA.md', undefined],
  ]);
  assert.equal(changeContext(store, 'change:project/abc').sources[0].url, undefined); // a Linear key builds none: its record carries the URL
  rm(store, 'change:project/chips', {});

  // a bare id nothing references resolves only through the project's tracker
  assert.equal(get(loaded, 'XYZ-9', { project: 'project:project' }).resolution.status, 'none');
  assert.throws(() => set(store, 'project:project', ['tracker=nope'], {}), /not in source_kinds/);
  set(store, 'project:project', ['tracker=linear'], {});
  const viaTracker = get(loadStore(store), 'XYZ-9', { project: 'project:project' });
  assert.equal(viaTracker.resolution.status, 'key');
  assert.equal(viaTracker.resolution.key, 'linear:XYZ-9');

  // GitHub issue references: owner/repo#n anywhere, bare #n through the project's repository and tracker
  assert.equal(get(loadStore(store), '#5', { project: 'project:project' }).resolution.status, 'none');
  set(store, 'project:project', ['tracker=github-issue', 'ext.github.repo=acme/app'], {});
  change(store, 'app-8', { title: 'Eight', summary: 's', binds: ['github-issue:acme/app#8'] });
  loaded = loadStore(store);
  assert.equal(get(loaded, '#5', { project: 'project:project' }).resolution.key, 'github-issue:acme/app#5');
  assert.equal(get(loaded, 'acme/app#5').resolution.key, 'github-issue:acme/app#5');
  assert.deepEqual(get(loaded, '#8', { project: 'project:project' }).changes.map((c) => c.change.key), ['change:project/app-8']);
  assert.deepEqual(get(loaded, 'other/repo#8').changes, []);
  assert.equal(get(loaded, 'other/repo#8').resolution.key, 'github-issue:other/repo#8');
  // an id of another kind's shape does not resolve through this project's tracker
  assert.equal(get(loaded, 'XYZ-77', { project: 'project:project' }).resolution.status, 'none');

  // the scanner: every reference in a text, in order, with the change it leads to; a shape of another tracker is not a reference here
  const refs = findReferences(loaded, 'see change:contract, then #8 (not #77, UTF-8 or XYZ-77) and https://linear.app/acme/issue/ABC-1234/x', { project: 'project:project' });
  // a bare #n is listed with what it would lead to but is weak: it never binds or creates; the qualified form does
  assert.deepEqual(refs.map((r) => [r.text, r.key, r.change, r.creatable, r.weak]), [
    ['change:contract', 'change:project/contract', 'change:project/contract', false, false],
    ['#8', 'github-issue:acme/app#8', 'change:project/app-8', false, true],
    ['#77', 'github-issue:acme/app#77', undefined, false, true],
    ['https://linear.app/acme/issue/ABC-1234/x', 'linear:ABC-1234', 'change:project/abc', false, false],
  ]);
  assert.deepEqual(findReferences(loaded, 'then acme/app#77', { project: 'project:project' }).map((r) => [r.key, r.creatable, r.weak]), [['github-issue:acme/app#77', true, false]]);
  // what an interface writes for a pasted image or text is not a reference
  assert.deepEqual(findReferences(loaded, '[Image #8] and [Pasted text #8 +3 lines]', { project: 'project:project' }), []);
  assert.equal(findReferences(loaded, 'nothing here', { project: 'project:project' }).length, 0);
  fs.rmSync(path.join(store.root, 'products/project/changes/abc'), { recursive: true });
});

test('a change may have a parent change: any depth, no cycles, children derived, progress derived, the board nests', () => {
  change(store, 'epic', { title: 'Epic', summary: 's' });
  change(store, 'epic-a', { title: 'A', summary: 's', parent: 'change:project/epic' });
  change(store, 'epic-a-1', { title: 'A1', summary: 's', parent: 'change:project/epic-a' });
  assert.throws(() => change(store, 'orphan', { title: 'O', summary: 's', parent: 'change:project/nope' }), /parent/);
  assert.throws(() => set(store, 'change:project/epic', ['parent=change:epic-a-1'], {}), /cycles/);
  assert.throws(() => set(store, 'change:project/epic', ['parent=change:epic'], {}), /cycles/);
  const ctx = changeContext(store, 'change:project/epic-a');
  assert.equal(ctx.parent?.key, 'change:project/epic');
  assert.deepEqual(ctx.children.map((r) => r.key), ['change:project/epic-a-1']);
  const board = formatStoreContext(storeContext(store, { project: 'project:project' }));
  assert.match(board, /^- change:project\/epic — Epic · 0\/1 done\n  - change:project\/epic-a \[open\] — A · 0\/1 done\n    - change:project\/epic-a-1 \[open\] — A1$/m);
  // a parent change is a milestone: progress is its children done, dropped excluded
  change(store, 'epic-b', { title: 'B', summary: 's', parent: 'change:project/epic', status: 'done' });
  change(store, 'epic-c', { title: 'C', summary: 's', parent: 'change:project/epic', status: 'dropped' });
  assert.deepEqual(changeContext(store, 'change:project/epic').progress, { done: 1, total: 2 });
  assert.equal(changeContext(store, 'change:project/epic-a-1').progress, undefined);
  assert.match(formatChangeContext(changeContext(store, 'change:project/epic')), /## Children \(1\/2 done\)/);
  const n = get(loadStore(store), 'change:project/epic-a');
  assert.equal(n.via['change:project/epic'], 'parent');
  assert.equal(n.via['change:project/epic-a-1'], 'parent');
  assert.deepEqual(errors(store), []);
  for (const c of ['epic-a-1', 'epic-a', 'epic-b', 'epic-c', 'epic']) fs.rmSync(path.join(store.root, 'products/project/changes', c), { recursive: true });
});

test('the view renders a reference; the session page reads what a session is on', () => {
  const one = renderView(store, { ref: 'change:project/contract' });
  assert.match(one.markdown, /^# change:project\/contract\n## Schema: v3\n/);
  assert.match(one.markdown, /### Decisions\n- /);
  assert.equal(one.showing.key, 'change:project/contract');
  const bySource = renderView(store, { ref: 'file:SCHEMA.md' });
  assert.match(bySource.markdown, /^# file:SCHEMA.md\n## The schema/);
  assert.match(bySource.markdown, /_reached through links_\n\n# change:project\/contract/);
  newRecord(store, 'session', 'sess-v', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  const board = viewData(store, { session: 'sess-v', project: 'project:project' });
  assert.equal(board.showing.board, 'project:project');
  assert.equal(board.session?.key, 'session:sess-v');
  sessionBind(store, 'sess-v', 'change:project/contract');
  const followed = viewData(store, { session: 'session:sess-v' });
  assert.equal(followed.showing.key, 'change:project/contract');
  assert.equal(followed.session?.on, 'change:project/contract');
  assert.throws(() => viewData(store, { session: 'nope' }), /does not resolve to a session/);
});

test('every write appends one event per record to the stream; follow delivers new ones; rebuild derives the stream from git', async () => {
  const before = readEvents(store);
  assert.ok(before.length > 0);
  assert.equal(before[0].op, 'init');
  assert.ok(before.every((e, i) => e.seq === i + 1));
  const delivered: string[] = [];
  const stop = follow(store, before.at(-1)!.seq, (e) => delivered.push(`${e.op} ${e.key}`));
  const r = change(store, 'evented', { title: 'E', summary: 's' });
  set(store, 'change:project/evented', ['status=active'], {});
  next(store, 'change:project/evented', 'go');
  decisionRec(store, 'evented/first', { title: 'First', decision: 'a', why: 'b' });
  decisionRec(store, 'evented/second', { title: 'Second', decision: 'a', why: 'b', supersedes: 'decision:project/evented/first' });
  const after = readEvents(store, before.at(-1)!.seq);
  assert.deepEqual(after.map((e) => [e.op, e.key, e.fields]), [
    ['created', 'change:project/evented', undefined],
    ['set', 'change:project/evented', ['status']],
    ['set', 'change:project/evented', ['plan', 'step add']],
    ['created', 'decision:project/evented/first', undefined],
    ['created', 'decision:project/evented/second', undefined],
    ['set', 'decision:project/evented/first', ['status']],
  ]);
  assert.equal(after[0].commit, r.commit);
  assert.equal(after[0].writer, 'person:tester');
  assert.match(after[0].at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  await new Promise((res) => setTimeout(res, 300));
  stop();
  assert.deepEqual(delivered, ['created change:project/evented', 'set change:project/evented', 'set change:project/evented', 'created decision:project/evented/first', 'created decision:project/evented/second', 'set decision:project/evented/first']);
  const all = readEvents(store);
  const rebuilt = rebuildEvents(store);
  const again = readEvents(store);
  assert.equal(rebuilt.events, again.length);
  assert.deepEqual(again.slice(-6).map((e) => [e.op, e.key]), all.slice(-6).map((e) => [e.op, e.key]));
  assert.equal(again.at(-1)!.commit, all.at(-1)!.commit);
  fs.rmSync(path.join(store.root, 'products/project/changes/evented'), { recursive: true });
});

test('the brief is short and installs once, between markers, in the harness file', () => {
  assert.ok(BRIEF.trim().split('\n').length <= 40, `the brief is ${BRIEF.trim().split('\n').length} lines`);
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
  const file = path.join(process.env.CLAUDE_CONFIG_DIR, 'CLAUDE.md');
  fs.writeFileSync(file, '# mine\n\nkeep this\n');
  const first = installBrief('claude-md');
  assert.equal(first.path, file);
  assert.ok(first.changed);
  const second = installBrief('claude-md');
  assert.ok(!second.changed);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal((text.match(/<!-- pjman:brief -->/g) ?? []).length, 1);
  assert.match(text, /^# mine\n\nkeep this\n/);
  assert.match(text, /pjman get <anything>/);
  const lines = init({ checkers: [], cwd: project, brief: 'claude-md' });
  assert.ok(lines.some((l) => /kept the brief/.test(l)));
  delete process.env.CLAUDE_CONFIG_DIR;
});

test('start brings the dashboard up detached and is idempotent; stop takes it down', () => {
  const first = start({ cwd: project, ui: false });
  assert.ok(first.started);
  assert.match(first.address.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const again = start({ cwd: project, ui: false });
  assert.ok(!again.started);
  assert.equal(again.address.url, first.address.url);
  assert.equal(readServeAddress()?.pid, first.address.pid);
  const lines = init({ checkers: [], cwd: project, start: true });
  assert.ok(lines.some((l) => l === `dashboard: ${first.address.url} (already running)` || l.startsWith(`dashboard: ${first.address.url}`)));
  assert.ok(lines.some((l) => /left to do/.test(l)));
  const stopped = stop();
  assert.equal(stopped?.pid, first.address.pid);
  assert.equal(readServeAddress(), null);
  assert.equal(stop(), null);
});

test('rm removes a record; refused while referenced; --detach drops droppable references; a project with changes and a required reference refuse', () => {
  change(store, 'doomed', { title: 'Doomed', summary: 'd', binds: ['linear:DOOM-1'] });
  decisionRec(store, 'doomed/why', { title: 'Why', decision: 'd', why: 'w' });
  change(store, 'orphan', { title: 'Orphan', summary: 'o', parent: 'change:project/doomed' });
  newRecord(store, 'session', 'sess-rm', { agent: 'agent:claude-code', onBehalfOf: 'person:vinh' });
  sessionBind(store, 'sess-rm', 'change:project/doomed');
  sessionObserve(store, 'sess-rm', 'links', 'change:project/doomed', 'file:src/x.ts');
  assert.throws(() => rm(store, 'change:project/nope'), /does not exist/);
  assert.throws(() => rm(store, 'change:project/doomed'), /referenced by\n  change:project\/orphan  parent\n  session:sess-rm  changes, observed/);
  assert.ok(loadStore(store).byKey.has('change:project/doomed'));
  const r = rm(store, 'change:project/doomed', { detach: true });
  assert.equal(r.removed.length, 2);
  assert.ok(r.removed.includes('products/project/changes/doomed/change.md'));
  assert.ok(r.removed.some((p) => p.startsWith('products/project/changes/doomed/decisions/')));
  assert.deepEqual(r.detached.map((d) => [d.key, d.fields]), [['change:project/orphan', ['parent']], ['session:sess-rm', ['changes', 'observed']]]);
  const after = loadStore(store);
  assert.ok(!after.byKey.has('change:project/doomed'));
  assert.ok(!after.byKey.has('decision:project/doomed/why'));
  assert.ok(!fs.existsSync(path.join(store.root, 'products/project/changes/doomed')));
  assert.equal(after.byKey.get('change:project/orphan')![0].data.parent, undefined);
  assert.equal(after.byKey.get('session:sess-rm')![0].data.changes, undefined);
  assert.deepEqual(validate(after).filter((p) => p.level === 'error'), []);
  const evs = readEvents(store);
  const removed = evs.filter((e) => e.op === 'removed').map((e) => e.key);
  assert.deepEqual(removed.slice(-2), ['change:project/doomed', 'decision:project/doomed/why']);
  assert.ok(evs.some((e) => e.op === 'set' && e.key === 'change:project/orphan' && e.fields?.includes('parent')));
  // a project with changes, and a record whose writer is the actor, refuse even with --detach
  assert.throws(() => rm(store, 'project:project', { detach: true }), /is the project of/);
  // a referenced source with --detach: the bind goes
  change(store, 'keeper', { title: 'Keeper', summary: 'k', binds: ['linear:KEEP-1'] });
  newRecord(store, 'source', 'linear:KEEP-1', { title: 'Keep' });
  assert.throws(() => rm(store, 'linear:KEEP-1'), /change:project\/keeper  binds/);
  rm(store, 'linear:KEEP-1', { detach: true });
  assert.equal(loadStore(store).byKey.get('change:project/keeper')![0].data.binds, undefined);
  rm(store, 'change:project/keeper');
  rm(store, 'change:project/orphan');
});

test('crud: set reaches actors and refuses sessions; mv renames a decision, within and across changes, and a project with its bindings', () => {
  // update on the two kinds set did not reach
  const actor = loadStore(store).records.find((r) => r.type === 'actor')!;
  set(store, actor.key, ['url=https://example.com/me'], {});
  assert.equal(loadStore(store).byKey.get(actor.key)![0].data.url, 'https://example.com/me');
  // a session is append-only: log, bind and observe add to it; nothing rewrites it
  assert.throws(() => set(store, 'session:sess-1', ['parent=session:sess-rm'], {}), /append-only/);

  // a decision rename: the superseding decision's pointer follows, the date prefix stays
  const before = loadStore(store).byKey.get('decision:project/contract/keys')![0].path;
  const d = mv(store, 'decision:project/contract/keys', 'decision:project/contract/keys-v1', {});
  assert.ok(d.rewritten.some((p) => p.endsWith('keys-and-aliases.md')));
  let loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('decision:project/contract/keys'));
  const moved = loaded.byKey.get('decision:project/contract/keys-v1')![0];
  assert.equal(path.basename(moved.path), path.basename(before).replace(/keys\.md$/, 'keys-v1.md'));
  assert.deepEqual(loaded.byKey.get('decision:project/contract/keys-and-aliases')![0].data.supersedes, ['decision:project/contract/keys-v1']);
  assert.deepEqual(errors(store), []);
  // across changes
  change(store, 'elsewhere', { title: 'Elsewhere', summary: 'e' });
  mv(store, 'decision:project/contract/keys-v1', 'decision:project/elsewhere/keys-v1', {});
  loaded = loadStore(store);
  assert.ok(loaded.byKey.get('decision:project/elsewhere/keys-v1')![0].path.startsWith('products/project/changes/elsewhere/decisions/'));
  assert.deepEqual(loaded.byKey.get('decision:project/contract/keys-and-aliases')![0].data.supersedes, ['decision:project/elsewhere/keys-v1']);
  assert.throws(() => mv(store, 'decision:project/elsewhere/keys-v1', 'decision:project/nowhere/keys-v1', {}), /change:project\/nowhere does not exist/);
  assert.throws(() => mv(store, 'decision:project/elsewhere/keys-v1', 'change:project/keys-v1', {}), /keeps the kind/);
  assert.deepEqual(errors(store), []);

  // a project rename: every change's project field and the directory binding follow
  const bound = readUserConfig().stores.flatMap((s) => s.projects).filter((b) => b.project === 'project:project').length;
  const p = mv(store, 'project:project', 'project:renamed', {});
  loaded = loadStore(store);
  assert.ok(!loaded.byKey.has('project:project'));
  assert.equal(loaded.byKey.get('project:renamed')![0].path, 'projects/renamed.md');
  assert.ok(loaded.records.filter((r) => r.type === 'change' && r.data.project).every((r) => r.data.project === 'project:renamed'));
  assert.ok(p.rewritten.length >= 1);
  assert.equal(readUserConfig().stores.flatMap((s) => s.projects).filter((b) => b.project === 'project:renamed').length, bound);
  assert.deepEqual(errors(store), []);
  assert.throws(() => mv(store, 'linear:ABC-1', 'linear:ABC-2', {}), /not renamed/);
  const evs = readEvents(store);
  assert.equal(evs.filter((e) => e.op === 'moved').slice(-1)[0].key, 'project:renamed');
});

test('the receipt: what the store received since a point, one line per record, deterministic', () => {
  const since = readEvents(store).at(-1)?.seq ?? 0;
  change(store, 'receipt-a', { title: 'Receipt A', summary: 's', project: 'project:renamed' });
  set(store, 'change:project/receipt-a', ['status=active'], {});
  next(store, 'change:project/receipt-a', 'go');
  decisionRec(store, 'receipt-a/d', { title: 'D', decision: 'd', why: 'w' });
  rm(store, 'change:project/receipt-a', { detach: true });
  const r = receipt(store, { since });
  assert.equal(r.seq, readEvents(store).at(-1)!.seq);
  assert.deepEqual(r.lines, ['removed change:project/receipt-a', 'removed decision:project/receipt-a/d']);
  change(store, 'receipt-b', { title: 'Receipt B', summary: 's', project: 'project:renamed' });
  const mid = readEvents(store).at(-1)!.seq;
  set(store, 'change:project/receipt-b', ['status=review'], {});
  next(store, 'change:project/receipt-b', 'look');
  assert.deepEqual(receipt(store, { since: mid }).lines, ['set change:project/receipt-b (status → review, plan, step add)']);
  assert.deepEqual(receipt(store, { since: mid, session: 'session:nobody' }).lines, []);
  rm(store, 'change:project/receipt-b');
});

test("a session's receipt: its writes and its spawned sessions', nothing from another session, no line for a spawn", () => {
  change(store, 'receipt-c', { title: 'Receipt C', summary: 's', project: 'project:renamed' });
  const since = readEvents(store).at(-1)!.seq;
  const who = { agent: 'agent:claude-code', onBehalfOf: 'person:tester' };
  newRecord(store, 'session', 'rc-parent', who);
  newRecord(store, 'session', 'rc-child', { ...who, parent: 'session:rc-parent', session: 'session:rc-child' });
  newRecord(store, 'session', 'rc-grandchild', { ...who, parent: 'session:rc-child', session: 'session:rc-grandchild' });
  newRecord(store, 'session', 'rc-other', who);
  sessionLog(store, 'rc-child', 'spawned by session:rc-parent');
  sessionBind(store, 'rc-parent', 'change:project/receipt-c');
  set(store, 'change:project/receipt-c', ['status=active'], { session: 'session:rc-parent' });
  set(store, 'change:project/receipt-c', ['notes=n'], { session: 'session:rc-child' });
  next(store, 'change:project/receipt-c', 'deep', { session: 'session:rc-grandchild' });
  set(store, 'change:project/receipt-c', ['scope=s'], { session: 'session:rc-other' });
  change(store, 'receipt-d', { title: 'Receipt D', summary: 's', project: 'project:renamed', session: 'session:rc-other' });
  assert.deepEqual(receipt(store, { since, session: 'session:rc-parent' }).lines, ['set change:project/receipt-c (status → active, notes, plan, step add)']);
  assert.deepEqual(receipt(store, { since, session: 'session:rc-child' }).lines, ['set change:project/receipt-c (notes, plan, step add)']);
  assert.deepEqual(receipt(store, { since, session: 'session:rc-other' }).lines, ['set change:project/receipt-c (scope)', 'created change:project/receipt-d — Receipt D']);
  rm(store, 'change:project/receipt-d');
});

test('depends_on, kind, severity, target and the sequence: validated, refused when wrong, dropped by rm --detach', () => {
  const project = 'project:renamed'; // renamed above; its product is still product:project
  change(store, 'base', { title: 'Base', summary: 'b', project });
  change(store, 'on-base', { title: 'On base', summary: 'o', project, dependsOn: ['change:project/base'], target: '2026-12-01' });
  const rec = loadStore(store).byKey.get('change:project/on-base')![0];
  assert.deepEqual(rec.data.depends_on, ['change:project/base']);
  assert.equal(rec.data.target, '2026-12-01');
  const ctx = changeContext(store, 'change:project/on-base');
  assert.deepEqual(ctx.dependsOn.map((r) => r.key), ['change:project/base']);
  assert.deepEqual(changeContext(store, 'change:project/base').neededBy.map((r) => r.key), ['change:project/on-base']);
  assert.match(formatChangeContext(ctx), /## Depends on\n- change:project\/base/);
  // a cycle, a self-dependency, a missing target, a bad date: refused
  assert.throws(() => set(store, 'change:project/base', ['depends_on=change:on-base'], {}), /depends_on cycles/);
  assert.throws(() => set(store, 'change:project/base', ['depends_on=change:base'], {}), /is the change itself/);
  assert.throws(() => set(store, 'change:project/base', ['depends_on=change:nowhere'], {}), /does not resolve/);
  assert.throws(() => set(store, 'change:project/base', ['target=soon'], {}), /must be a date/);
  // a bug carries kind and severity; severity without the kind is refused
  change(store, 'crash', { title: 'Crash on save', summary: 'c', project, kind: 'bug', severity: 'feature' });
  assert.equal(loadStore(store).byKey.get('change:project/crash')![0].data.severity, 'feature');
  assert.throws(() => set(store, 'change:project/base', ['severity=cosmetic'], {}), /a bug's field/);
  assert.throws(() => set(store, 'change:project/crash', ['severity=huge'], {}), /not one of product, feature/);
  assert.throws(() => set(store, 'change:project/crash', ['kind=chore'], {}), /not one of work, bug/);
  change(store, 'typo', { title: 'Typo', summary: 't', project, kind: 'bug', severity: 'cosmetic', created: '2026-01-01' });
  change(store, 'slow', { title: 'Slow', summary: 's', project, kind: 'bug' });
  assert.deepEqual(ls(store, { type: 'change', kind: 'bug' }).map((r) => r.key), ['change:project/crash', 'change:project/typo', 'change:project/slow']);
  assert.ok(!ls(store, { type: 'change', kind: 'work' }).some((r) => r.key === 'change:project/crash'));
  // the product's sequence: change keys, no repeats
  set(store, 'product:project', ['sequence=change:base,change:on-base'], {});
  assert.deepEqual(loadStore(store).byKey.get('product:project')![0].data.sequence, ['change:project/base', 'change:project/on-base']);
  assert.throws(() => set(store, 'product:project', ['sequence=change:base,change:base'], {}), /appears twice/);
  assert.throws(() => set(store, 'product:project', ['sequence=feature:nope'], {}), /must be a change key/);
  // the getter sees the edges
  const n = get(loadStore(store), 'change:project/base');
  assert.ok(n.in.some((e) => e.edge === 'depends_on' && e.from === 'change:project/on-base'));
  assert.ok(n.in.some((e) => e.edge === 'sequence' && e.from === 'product:project'));
  // rm --detach drops the dependency and the sequence entry
  assert.throws(() => rm(store, 'change:project/base'), /change:project\/on-base  depends_on/);
  const r = rm(store, 'change:project/base', { detach: true });
  assert.ok(r.detached.some((d) => d.key === 'change:project/on-base' && d.fields.includes('depends_on')));
  assert.ok(r.detached.some((d) => d.key === 'product:project' && d.fields.includes('sequence')));
  assert.equal(loadStore(store).byKey.get('change:project/on-base')![0].data.depends_on, undefined);
  assert.deepEqual(loadStore(store).byKey.get('product:project')![0].data.sequence, ['change:project/on-base']);
  assert.deepEqual(errors(store), []);
});

test('a feature rename keeps the old slug as an alias; apply lands a batch as one commit and refuses it whole; undo puts it back', () => {
  const project = 'project:renamed'; // renamed above; its product is still product:project
  newRecord(store, 'product', 'shop', { title: 'Shop' });
  newRecord(store, 'feature', 'board', { title: 'The board', name: 'Board', product: 'product:shop' });
  change(store, 'board-work', { title: 'Board work', summary: 'b', project, features: ['adds feature:board'] });
  // mv feature: the folder moves, the effect follows, the old slug resolves via the alias
  const m = mv(store, 'feature:shop/board', 'feature:shop/lanes', {});
  assert.equal(m.to, 'feature:shop/lanes');
  const after = loadStore(store);
  assert.deepEqual(after.byKey.get('feature:shop/lanes')![0].data.aliases, ['board']);
  assert.deepEqual(after.byKey.get('change:project/board-work')![0].data.features, ['adds feature:shop/lanes']);
  const viaAlias = resolveKey(after, 'feature:shop/board');
  assert.equal(viaAlias.status, 'alias');
  assert.throws(() => mv(store, 'feature:shop/lanes', 'feature:shop/board', {}), /former name of feature:shop\/lanes/);
  assert.deepEqual(errors(store), []);

  // apply: a small dispatcher stands in for the CLI's
  const run = (argv: string[]) => {
    const [cmd, ...rest] = argv;
    if (cmd === 'new') {
      const [type, ident, ...flags] = rest;
      const f: Record<string, unknown> = {};
      for (let i = 0; i < flags.length; i += 2) {
        const name = flags[i]!.replace(/^--/, '');
        if (name === 'features') f.features = [...((f.features as string[] | undefined) ?? []), flags[i + 1]!];
        else f[name] = flags[i + 1];
      }
      newRecord(store, type as 'feature', ident!, f);
    } else if (cmd === 'set') set(store, rest[0]!, rest.slice(1), {});
    else if (cmd === 'step') step(store, rest[0]!, rest[1]!, rest[1] === 'add' ? undefined : Number(rest[2]), { text: rest.slice(2).join(' ') });
    else if (cmd === 'mv') mv(store, rest[0]!, rest[1]!, {});
    else throw new Error(`no ${cmd}`);
  };
  const before = git(store.root, 'rev-parse', 'HEAD');
  const seqBefore = readEvents(store).at(-1)!.seq;
  const batch = [
    '# the map, regrouped',
    'new feature io --title "Ways in and out" --name I/O --product product:shop',
    "set feature:lanes parent=feature:io product=",
    'pjman step change:board-work add "after the batch"',
  ].join('\n');
  const a = apply(store, batch, run, { for: 'change:project/board-work' });
  assert.equal(a.lines, 3);
  // the step added lifts the change to planning, inside the batch: four writes, one commit
  assert.equal(a.writes, 4);
  assert.ok(a.commit);
  assert.equal(git(store.root, 'rev-list', '--count', `${before}..HEAD`), '1');
  assert.match(git(store.root, 'log', '-1', '--format=%s%n%(trailers:key=Pjman-For,valueonly)'), /^pjman: apply 4 writes for change:project\/board-work\nchange:project\/board-work/);
  assert.equal(loadStore(store).byKey.get('feature:shop/lanes')![0].data.parent, 'feature:shop/io');
  const evs = readEvents(store, seqBefore);
  assert.deepEqual(evs.map((e) => e.op), ['created', 'set', 'set', 'set', 'applied']);
  assert.ok(evs.every((e) => e.commit === a.commit));
  assert.deepEqual(evs.at(-1)!.fields, ['4 writes']);
  // a line that fails refuses the whole batch: nothing written, nothing committed
  assert.throws(() => apply(store, 'set feature:io title=Changed\nset feature:nope title=x', run), /refused at line 2 .*nothing was written/s);
  assert.equal(git(store.root, 'rev-parse', 'HEAD'), git(store.root, 'rev-parse', 'HEAD'));
  assert.equal(loadStore(store).byKey.get('feature:shop/io')![0].data.title, 'Ways in and out');
  assert.equal(git(store.root, 'status', '--porcelain'), '');
  assert.throws(() => apply(store, 'start --port 1', run), /does not go in a batch/);
  assert.throws(() => apply(store, '', run), /empty/);
  // undo: the batch reverted as one commit, the events say what came back
  const u = undo(store, {});
  assert.equal(u.reverted, a.commit);
  assert.equal(u.for, 'change:project/board-work');
  const back = loadStore(store);
  assert.equal(back.byKey.has('feature:shop/io'), false);
  assert.equal(back.byKey.get('feature:shop/lanes')![0].data.product, 'product:shop');
  assert.equal(back.byKey.get('change:project/board-work')![0].data.plan, undefined);
  const undone = readEvents(store, evs.at(-1)!.seq);
  assert.deepEqual(undone.map((e) => [e.op, e.key]).sort(), [['removed', 'feature:shop/io'], ['reverted', 'change:project/board-work'], ['set', 'change:project/board-work'], ['set', 'feature:shop/lanes']]);
  assert.deepEqual(errors(store), []);
  // a later write on a record of the batch refuses the undo of it
  const a2 = apply(store, 'step change:board-work add again', run, {});
  next(store, 'change:project/board-work', 'later still');
  assert.throws(() => undo(store, { commit: a2.commit! }), /refused: 1 later write touched/);
  assert.throws(() => undo(store, { commit: 'nope' }), /not a commit/);
  // the rebuilt stream reads the batch and its undo the same way
  rebuildEvents(store);
  const rebuilt = readEvents(store);
  assert.ok(rebuilt.some((e) => e.op === 'applied' && e.key === 'change:project/board-work' && e.commit === a.commit));
  assert.ok(rebuilt.some((e) => e.op === 'reverted' && e.key === 'change:project/board-work'));
});

test('init asks about the map once and records the answer; the context says when a product has no map', () => {
  const other = path.join(tmp, 'other');
  fs.mkdirSync(other, { recursive: true });
  git(other, 'init', '-q');
  const lines = init({ checkers: [], cwd: other, adapter: false, start: false, map: false });
  assert.ok(lines.some((l) => /no product map will be proposed \(project:other map=skip\)/.test(l)));
  // init inventories the repository and records what it holds (decision cold-start-gaps/init-inventories-the-repository)
  assert.ok(lines.some((l) => l === 'the repository holds nothing yet'), lines.join('\n'));
  assert.equal(loadStore(store).byKey.get('project:other')![0].data.map, 'skip');
  assert.equal(loadStore(store).byKey.get('project:other')![0].data.holds, 'bare');
  // no line while the project declined
  assert.equal(storeContext(store, { project: 'project:other' }).mapPrompt, undefined);
  // yes on a later init flips it; a bare repository is said to grow its map from the work, never to get a proposal
  const again = init({ checkers: [], cwd: other, adapter: false, start: false, map: true });
  assert.ok(again.some((l) => /^no map is proposed yet \(project:other map=propose; .*\): there is nothing to survey, so the map grows from the work/.test(l)), again.join('\n'));
  assert.equal(loadStore(store).byKey.get('project:other')![0].data.map, 'propose');
  // init made the product with the project; with no feature yet the context says the product has no map, by what the repository holds
  const c = storeContext(store, { project: 'project:other' });
  assert.match(c.mapPrompt ?? '', /^product:other has no map yet; the repository holds nothing yet\. Nothing to survey: the map grows from the work/);
  assert.match(formatStoreContext(c), /^# project:other.*\nno product map: product:other has no map yet/);
  // the repository grows docs and code: read live from the repository when it is the store's own project, else as recorded
  fs.writeFileSync(path.join(other, 'README.md'), '# other\n\n' + 'The other product does a thing for a person, described here.\n'.repeat(8));
  fs.mkdirSync(path.join(other, 'src'), { recursive: true });
  fs.writeFileSync(path.join(other, 'src', 'main.py'), 'print(1)\n');
  assert.match(storeContext(store, { project: 'project:other' }).mapPrompt ?? '', /holds nothing yet/, 'another project\'s store reads the recorded state');
  const own = findStore(other)!;
  assert.equal(own.project, 'project:other');
  const live = storeContext(own, { project: 'project:other' }).mapPrompt ?? '';
  assert.match(live, /the repository holds docs and code \(README\.md; src\/\)\. the map is proposed from both/);
  assert.match(live, /file it with no feature and propose the map in the same breath/);
  const third = init({ checkers: [], cwd: other, adapter: false, start: false, map: true });
  assert.ok(third.some((l) => /^the first change through intake proposes a product map \(project:other map=propose/.test(l)), third.join('\n'));
  assert.equal(loadStore(store).byKey.get('project:other')![0].data.holds, 'docs+code', 'a re-run refreshes the record');
  // a feature ends the line
  newRecord(store, 'feature', 'cart', { title: 'The cart', product: 'product:other' });
  assert.equal(storeContext(store, { project: 'project:other' }).mapPrompt, undefined);
  assert.equal(storeContext(store, { project: 'project:other' }).regroupPrompt, undefined);
  // a map grown past seven layers is offered a regrouping, in the context, never run
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) newRecord(store, 'feature', `top-${n}`, { title: `Top ${n}`, product: 'product:other' });
  const grown = storeContext(store, { project: 'project:other' });
  assert.match(grown.regroupPrompt ?? '', /^product:other has 8 top-level features, more than a proposed map would have/);
  assert.match(formatStoreContext(grown), /\nmap outgrown: product:other has 8 top-level features/);
  assert.throws(() => set(store, 'project:other', ['map=maybe'], {}), /not one of propose, skip/);
  assert.throws(() => set(store, 'project:other', ['holds=maybe'], {}), /not one of bare, docs, code, docs\+code/);
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.path === 'projects/other.md'), [], 'holds is a known field: no warning');
  assert.deepEqual(errors(store), []);
});

test('a refused write puts the record back: a bind to a missing change leaves the session file and the tree untouched', () => {
  const sess = loadStore(store).records.find((r) => r.type === 'session')!;
  const textBefore = fs.readFileSync(sess.abs, 'utf8');
  const head = git(store.root, 'rev-parse', 'HEAD');
  assert.throws(() => sessionBind(store, sess.key.slice('session:'.length), 'change:never-made'), /does not resolve/);
  assert.equal(fs.readFileSync(sess.abs, 'utf8'), textBefore);
  assert.equal(git(store.root, 'status', '--porcelain'), '');
  assert.equal(git(store.root, 'rev-parse', 'HEAD'), head);
  // a superseding decision that fails to validate puts the superseded one back too
  const project = 'project:renamed'; // renamed above; its product is still product:project
  change(store, 'sup', { title: 'Sup', summary: 's', project });
  decisionRec(store, 'sup/old', { title: 'Old', decision: 'o', why: 'w' });
  const old = loadStore(store).byKey.get('decision:project/sup/old')![0];
  const oldText = fs.readFileSync(old.abs, 'utf8');
  assert.throws(() => decisionRec(store, 'sup/new', { title: 'New', decision: 'n', why: 'w', supersedes: 'decision:project/sup/old', links: ['not a key'] }), /would not validate/);
  assert.equal(fs.readFileSync(old.abs, 'utf8'), oldText);
  assert.equal(git(store.root, 'status', '--porcelain'), '');
  // a product carries a short name like a feature
  newRecord(store, 'product', 'named', { title: 'A product in a sentence', name: 'Named' });
  assert.equal(loadStore(store).byKey.get('product:named')![0].data.name, 'Named');
  set(store, 'product:named', ['name=Renamed'], {});
  assert.equal(loadStore(store).byKey.get('product:named')![0].data.name, 'Renamed');
  assert.deepEqual(errors(store), []);
});
