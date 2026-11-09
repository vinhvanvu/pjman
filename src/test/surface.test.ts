// The command line's surface (change:interface-audit): one declaration per command, its own flags and arity, every
// record argument resolving as the getter resolves it, one error contract, the help by entity, list edits, step edits,
// and the bulk forms that land as one commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { findStore, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { loadStore } from '../records.js';
import { stepsOf } from '../foundation.js';
import { COMMANDS, ENTITIES, referenceMarkdown } from '../surface.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-surface-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'agent:bot';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const bin = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'bin', 'pjman.js');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
/** One run of the CLI in the project: its exit code, stdout and stderr. */
const pj = (args: string[], input?: string) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: project, env: process.env, encoding: 'utf8', input });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const filed = (slug: string, extra: string[] = []) =>
  pj(['new', 'change', slug, '--name', slug, '--gist', `The ${slug} change`, '--origin', 'asked', '--intent', 'a need', '--done-when', 'it is done', ...extra]);
const record = (key: string) => loadStore(store).byKey.get(key)![0];
let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
  newRecord(store, 'actor', 'person:vinh', { name: 'Vinh' });
  newRecord(store, 'feature', 'checkout', { title: 'People pay for what is in the cart', name: 'Checkout', product: 'product:app' });
  newRecord(store, 'feature', 'cards', { title: 'Pay by card', name: 'Cards', parent: 'feature:checkout' });
});

test('a flag a command does not take is refused naming the ones it does; a retired flag says where its job went; extra arguments are refused', () => {
  let r = pj(['ls', '--intent', 'x']);
  assert.equal(r.code, 2);
  assert.match(r.err, /pjman ls takes no --intent; it takes --status --kind --project --product --parent --feature/);
  r = pj(['new', 'change', 'x', '--plan', 'a plan']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--plan is retired here: the plan is steps/);
  r = pj(['decision', 'x/y', '--decided-by', 'person:vinh']);
  assert.match(r.err, /--decided-by is retired/);
  r = pj(['show', 'a', 'b']);
  assert.equal(r.code, 2);
  assert.match(r.err, /pjman show takes one argument; got 'b' besides/);
  // flags by subcommand: --reason belongs to session bind alone
  r = pj(['session', 'log', 'abc', 'hello', '--reason', 'prompt']);
  assert.match(r.err, /pjman session log takes no --reason; it takes no flags of its own/);
  assert.equal(pj(['frobnicate']).code, 2);
});

test('the error contract: usage exits 2, not found 1 with what was tried, and --json answers in the API\'s shape on stdout', () => {
  let r = pj(['get', 'nope']);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /^pjman: nope resolves to nothing; tried: /);
  r = pj(['get', 'nope', '--json']);
  assert.equal(r.code, 1);
  const body = JSON.parse(r.out) as { error: { code: string; message: string; tried: string[] } };
  assert.equal(body.error.code, 'not-found');
  assert.ok(body.error.tried.length);
  r = pj(['tree', 'product:nope']);
  assert.equal(r.code, 1);
  assert.match(r.err, /product:nope resolves to no product or feature/);
  r = pj(['ls', 'change', '--status', 'bogus']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--status bogus is not a status of a change \(open, planning/);
  assert.match(pj(['ls', 'change', '--kind', 'nope']).err, /--kind nope is not a kind of change \(work, bug\)/);
  assert.match(pj(['ls', 'step']).err, /unknown entity 'step' \(product, feature, aspect, place, project, change, decision, release, source, session, actor\)/);
  r = pj([]);
  assert.equal(r.code, 2);
  assert.match(r.out, /^pjman — /);
});

test('a record argument resolves as get resolves it: the slug alone, ambiguity refused by name, a kind asked for where one is taken', () => {
  assert.equal(filed('login').code, 0);
  assert.equal(filed('checkout').code, 0); // shares its slug with the feature
  let r = pj(['show', 'login']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /changes\/login\/change\.md/);
  r = pj(['show', 'checkout']);
  assert.equal(r.code, 1);
  assert.match(r.err, /checkout is ambiguous: .*change:app\/checkout.*feature:app\/checkout|checkout is ambiguous: .*feature:app\/checkout.*change:app\/checkout/);
  assert.equal(pj(['set', 'login', 'notes=from a slug']).code, 0);
  assert.match(record('change:app/login').sections.get('Notes') ?? '', /from a slug/);
  // the product and its project share the name app; tree asks only for products and features
  assert.match(pj(['tree', 'app']).out, /product:app/);
  assert.match(pj(['show', 'app']).err, /app is ambiguous/);
  // rest takes the slug alone as the others do, and asks only for changes, so the feature's slug does not make it ambiguous
  r = pj(['rest', 'login']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^change:login rests/);
  r = pj(['rest', 'checkout']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^change:checkout rests/);
  r = pj(['rest', 'nowhere']);
  assert.equal(r.code, 1);
  assert.match(r.err, /nowhere/);
  assert.ok(!/at restOf|\n    at /.test(r.err), 'a refusal, not a stack trace');
  // show --json is the listing's row with the body
  const row = JSON.parse(pj(['show', 'login', '--json']).out) as { type: string; key: string; body: string };
  assert.equal(row.type, 'change');
  assert.equal(row.key, 'change:app/login');
});

test('step add takes several texts as one commit, or lines on stdin; edit rewrites a text; words left unquoted are refused', () => {
  const head = readEvents(store).length;
  let r = pj(['step', 'login', 'add', 'Send the mail', 'Verify the link']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /step 1,2 add/);
  // one write for both (the change lifted to planning is its own event)
  const adds = readEvents(store).slice(head).filter((e) => e.fields?.includes('step add'));
  assert.equal(adds.length, 1);
  assert.deepEqual(adds[0].fields, ['plan', 'step add', '2 steps']);
  r = pj(['step', 'login', 'add', '--from', '-', '--first'], 'Design the mail\n\nWrite the copy\n');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(stepsOf(record('change:app/login').data).map((s) => s.text), ['Design the mail', 'Write the copy', 'Send the mail', 'Verify the link']);
  r = pj(['step', 'login', 'add', 'fix', 'the', 'bug']);
  assert.equal(r.code, 2);
  assert.match(r.err, /some of one word \('fix'\)/);
  assert.equal(pj(['step', 'login', 'edit', '2', 'Write the copy, short']).code, 0);
  assert.equal(stepsOf(record('change:app/login').data)[1].text, 'Write the copy, short');
  assert.match(pj(['step', 'login', 'edit', '2', 'Write the copy, short']).err, /already reads so/);
  assert.match(pj(['step', 'checkout', 'done', '1']).err, /the plan is empty/);
  // the same move over several steps is one commit
  const before = readEvents(store).length;
  r = pj(['step', 'login', 'done', '1', '3']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /step 1,3 done/);
  assert.deepEqual(stepsOf(record('change:app/login').data).map((s) => s.state), ['done', 'open', 'done', 'open']);
  assert.equal(readEvents(store).slice(before).filter((e) => e.fields?.includes('step done')).length, 1);
  assert.match(pj(['step', 'login', 'done', '1', '2']).err, /step 1 is already done/);
  assert.equal(stepsOf(record('change:app/login').data)[1].state, 'open', 'a refusal leaves every step as it was');
});

test('new change --step files the change with its plan in one write', () => {
  const r = filed('signup', ['--step', 'Draft the form', '--step', 'Wire the mail']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(stepsOf(record('change:app/signup').data).map((s) => [s.text, s.state]), [['Draft the form', 'open'], ['Wire the mail', 'open']]);
});

test('set adds and removes one item of a list with += and -=, idempotent; = still replaces', () => {
  let r = pj(['set', 'login', 'links+=url:https://example.com/a', 'links+=url:https://example.com/b']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(record('change:app/login').data.links, ['url:https://example.com/a', 'url:https://example.com/b']);
  r = pj(['set', 'login', 'links+=url:https://example.com/a']);
  assert.match(r.out, /nothing to change on change:login\nnote: links already holds url:https:\/\/example.com\/a/);
  assert.equal(pj(['set', 'login', 'links-=url:https://example.com/a']).code, 0);
  assert.deepEqual(record('change:app/login').data.links, ['url:https://example.com/b']);
  // a short key is written full, and taken out by its short form
  assert.equal(pj(['set', 'login', 'features+=adds feature:cards']).code, 0);
  assert.deepEqual(record('change:app/login').data.features, ['adds feature:app/cards']);
  assert.equal(pj(['set', 'login', 'features-=adds feature:cards']).code, 0);
  assert.equal(record('change:app/login').data.features, undefined);
  r = pj(['set', 'login', 'gist+=more']);
  assert.equal(r.code, 2);
  assert.match(r.err, /gist\+= takes a list field of a change/);
});

test('set and rm over several records land as one commit, one applied event, and one undo puts them back', () => {
  filed('old-one');
  filed('old-two');
  const head = readEvents(store).length;
  let r = pj(['set', 'old-one', 'old-two', 'status=dropped']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /2 records as one commit/);
  const ev = readEvents(store).slice(head);
  assert.deepEqual(ev.map((e) => e.op), ['set', 'set', 'applied']);
  assert.equal(new Set(ev.map((e) => e.commit)).size, 1);
  assert.equal(record('change:app/old-two').data.status, 'dropped');
  r = pj(['rm', 'old-one', 'old-two']);
  assert.equal(r.code, 0, r.err);
  assert.equal(loadStore(store).byKey.has('change:app/old-one'), false);
  assert.equal(pj(['undo']).code, 0);
  assert.equal(loadStore(store).byKey.has('change:app/old-one'), true);
  // the activity reads a batch as one entry
  assert.match(pj(['activity', 'product:app']).out, /^#\d+-\d+ .* batch +2 set: change:old-one, change:old-two$/m);
  // a refusal on one refuses them all
  r = pj(['set', 'old-one', 'nope', 'notes=x']);
  assert.equal(r.code, 1);
  assert.equal(record('change:app/old-one').sections.get('Notes'), undefined);
});

test('ls filters by parent, feature and product; order with no move prints the order', () => {
  filed('epic');
  assert.equal(pj(['set', 'signup', 'parent=change:epic', 'features+=adds feature:cards']).code, 0);
  assert.deepEqual(JSON.parse(pj(['ls', 'change', '--parent', 'epic', '--json']).out).map((r: { key: string }) => r.key), ['change:app/signup']);
  assert.deepEqual(JSON.parse(pj(['ls', 'change', '--feature', 'feature:checkout', '--json']).out).map((r: { key: string }) => r.key), ['change:app/signup']);
  assert.deepEqual(JSON.parse(pj(['ls', 'feature', '--parent', 'feature:checkout', '--json']).out).map((r: { key: string }) => r.key), ['feature:app/cards']);
  assert.equal(pj(['order', 'signup', '--first']).code, 0);
  const o = JSON.parse(pj(['order', '--json']).out) as { product: string; sequence: string[] };
  assert.equal(o.product, 'product:app');
  assert.deepEqual(o.sequence, ['change:app/signup']);
});

test('the help reads by entity, every command has a group and its usage, and docs/reference.md carries the same text', () => {
  const r = pj(['--help']);
  assert.equal(r.code, 0);
  for (const e of ENTITIES) assert.match(r.out, new RegExp(`^${e.name} — `, 'm'));
  assert.match(r.out, /^Maintenance$/m);
  const change = pj(['help', 'change']).out;
  assert.match(change, /^change — a unit of work/);
  assert.match(change, /^ {2}create {2}pjman new change/m);
  assert.match(pj(['help', 'step']).out, /^step — .*\n(.*\n)*usage:\n {2}pjman step <change> add/);
  assert.equal(pj(['help', 'nonsense']).code, 2);
  // every entity names each of create, read and update, or says why not; every command is declared once
  for (const e of ENTITIES) for (const op of ['create', 'read', 'update']) assert.ok(e.ops.some(([o]) => o === op), `${e.name} ${op}`);
  assert.equal(new Set(COMMANDS.map((c) => c.name)).size, COMMANDS.length);
  const doc = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'docs', 'reference.md'), 'utf8');
  assert.ok(doc.includes(referenceMarkdown()), 'docs/reference.md is behind the declaration: npm run docs');
});

test('what a fresh agent tripped on: a slug in a flag or a field, a bare URL as a link, a near flag named, the slug alone for a decision', () => {
  let r = pj(['new', 'feature', 'wallet', '--title', 'Cards kept for next time', '--parent', 'checkout']);
  assert.equal(r.code, 0, r.err);
  assert.equal(record('feature:app/wallet').data.parent, 'feature:app/checkout');
  filed('epic-two');
  assert.equal(pj(['set', 'signup', 'parent=epic-two']).code, 0);
  assert.equal(record('change:app/signup').data.parent, 'change:app/epic-two');
  assert.equal(pj(['set', 'login', 'links+=https://example.com/pci']).code, 0);
  assert.ok((record('change:app/login').data.links as string[]).includes('url:https://example.com/pci'));
  assert.equal(pj(['set', 'login', 'links-=https://example.com/pci']).code, 0);
  assert.ok(!((record('change:app/login').data.links as string[] | undefined) ?? []).includes('url:https://example.com/pci'));
  r = pj(['new', 'change', 'x', '--title', 'X']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--title is retired here: a change has no title/);
  assert.match(pj(['new', 'change', 'x', '--feature', 'feature:cards']).err, /takes no --feature \(did you mean --features\?\)/);
  assert.doesNotMatch(pj(['new', 'change', 'x', '--feature', 'feature:cards']).err, /--title/);
  assert.match(pj(['set', 'login', '--step', 'more']).err, /a step is added with pjman step <change> add/);
  assert.equal(pj(['new', 'change', 'x', '--name', 'X']).code, 2);
  // a decision by its slug alone; a misspelt key is said not to exist
  assert.equal(pj(['decision', 'login/storage', '--name', 'Storage', '--gist', 'Where a card is kept', '--question', 'Where?', '--option', 'vault=A vault']).code, 0);
  r = pj(['decision', 'storage', '--comment', 'a vault is fine']);
  assert.equal(r.code, 0, r.err);
  r = pj(['decision', 'login/storag', '--comment', 'hi']);
  assert.equal(r.code, 2);
  assert.match(r.err, /decision:app\/login\/storag does not exist yet, and a new decision needs --name/);
  // a feature lists by the status the tree shows
  assert.ok(JSON.parse(pj(['ls', 'feature', '--status', 'planned', '--json']).out).some((x: { key: string }) => x.key === 'feature:app/wallet'));
  assert.match(pj(['help', 'change']).out, /every flag of each, in full: pjman help new · pjman help context/);
});

test('a bare undo reverts the last batch not yet undone, and a refusal names the batch it meant', () => {
  filed('keep-a');
  filed('keep-b');
  assert.equal(pj(['rm', 'keep-a', 'keep-b']).code, 0);
  assert.equal(pj(['undo']).code, 0);
  assert.ok(loadStore(store).byKey.has('change:app/keep-a'));
  // that batch is undone: the next bare undo looks past it to an earlier one, never at it again
  const r = pj(['undo']);
  assert.doesNotMatch(r.out + r.err, /rm change:app\/keep-a/);
  assert.match(r.err + r.out, /reverted|refused: .* touched a record of [0-9a-f]{7} \(pjman: apply/);
});
