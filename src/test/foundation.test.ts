// The foundation (change:record-foundation): a change's sections and plan, a decision's thread, the rungs and their
// staleness, what a record still needs, and the migration that maps the old shape into it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { decide, decision, entriesFromFlags, reopen } from '../commands/decision.js';
import { step } from '../commands/step.js';
import { set } from '../commands/set.js';
import { changeContext, formatChangeContext, storeContext, formatStoreContext } from '../commands/view.js';
import { migrate, pendingMigration } from '../commands/migrate.js';
import { findStore, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { loadStore } from '../records.js';
import { scope } from '../scope.js';
import { validate } from '../validate.js';
import { decisionState, formatDecisionState, needsOf, nextStep, pointsOf, rungsOf, stepsOf, threadOf } from '../foundation.js';
import { syncLinear } from '../sync/linear.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-foundation-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'agent:bot';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const errors = (store: Store) => validate(loadStore(store)).filter((p) => p.level === 'error').map((p) => `${p.path}: ${p.message}`);
let store: Store;

before(() => {
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '-q');
  git(project, 'config', 'user.name', 'Tester');
  git(project, 'config', 'user.email', 't@example.com');
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
  newRecord(store, 'actor', 'person:vinh', { name: 'Vinh' });
});

test('a change is filed with its name, gist, origin, intent and done-when; the retired fields refuse with a pointer', () => {
  assert.throws(() => newRecord(store, 'change', 'bare', { title: 'Bare' }), /no title or summary/);
  assert.throws(() => newRecord(store, 'change', 'bare', { name: 'Bare', gist: 'A bare change' }), /--origin is required/);
  const r = newRecord(store, 'change', 'login', {
    name: 'Magic links', gist: 'Sign in by a link in the mail, so nobody keeps a password',
    origin: 'can we drop passwords? a link in the mail is enough for us', intent: 'People sign in without a password.\n\nThe need: support sees a lockout a day.', doneWhen: 'A link signs a person in; no password field remains.',
    scope: '- in: the link, the mail\n- out: SSO', openQuestions: '- how long does a link live?',
  });
  const rec = loadStore(store).byKey.get(r.key)![0];
  assert.equal(rec.data.name, 'Magic links');
  assert.match(rec.sections.get('Origin')!, /^> can we drop passwords\?/);
  assert.equal(rec.sections.get('Done when'), 'A link signs a person in; no password field remains.');
  assert.deepEqual([...rec.sections.keys()], ['Origin', 'Intent', 'Done when', 'Scope', 'Open questions']);
  assert.deepEqual(needsOf(rec), []);
  assert.equal(rungsOf(rec).stale, false);
  assert.deepEqual(errors(store), []);
  // a source as the origin is linked, never copied
  const t = newRecord(store, 'change', 'ticketed', { name: 'Ticketed', gist: 'From a ticket', origin: 'linear:APP-9', intent: 'i', doneWhen: 'd' });
  const tr = loadStore(store).byKey.get(t.key)![0];
  assert.match(tr.sections.get('Origin')!, /^from linear:APP-9/);
  assert.deepEqual(tr.data.links, ['linear:APP-9']);
  assert.throws(() => set(store, 'change:login', ['next=x'], {}), /next is retired/);
  assert.throws(() => set(store, 'change:login', ['summary=x'], {}), /no summary/);
  assert.throws(() => set(store, 'change:login', ['plan=x'], {}), /pjman step/);
  assert.throws(() => set(store, 'change:login', ['name='], {}), /rewrite it rather than remove it/);
});

test('the rungs go stale when the foundation is written without them, and are fresh again once rewritten', () => {
  const r = set(store, 'change:login', ['intent=People sign in without a password, on any device.'], {});
  assert.ok(r.notes.some((n) => /rewrite them/.test(n)));
  let rec = loadStore(store).byKey.get('change:app/login')![0];
  assert.equal(rungsOf(rec).stale, true);
  const ctx = changeContext(store, 'change:login');
  assert.equal(ctx.stale, true);
  assert.match(formatChangeContext(ctx), /^rungs: stale/m);
  assert.match(formatChangeContext(ctx), /^# change:app\/login — Magic links\nSign in by a link/);
  // the gist rewritten in the same write as the foundation: fresh
  set(store, 'change:login', ['done-when=A link signs a person in on any device.', 'gist=Sign in by a mailed link on any device, no password'], {});
  rec = loadStore(store).byKey.get('change:app/login')![0];
  assert.equal(rungsOf(rec).stale, false);
  // a section outside the foundation leaves them fresh
  set(store, 'change:login', ['scope=- in: the link'], {});
  assert.equal(rungsOf(loadStore(store).byKey.get('change:app/login')![0]).stale, false);
});

test('the plan: steps through commands, each move an event; the next step, the progress and the note are derived', () => {
  const key = 'change:login';
  assert.throws(() => step(store, key, 'done', 1, {}), /plan is empty/);
  step(store, key, 'add', undefined, { text: 'Send the mail' });
  step(store, key, 'add', undefined, { text: 'Verify the link' });
  step(store, key, 'add', undefined, { text: 'Design the mail', first: true });
  let steps = stepsOf(loadStore(store).byKey.get('change:app/login')![0].data);
  assert.deepEqual(steps.map((s) => [s.text, s.state]), [['Design the mail', 'open'], ['Send the mail', 'open'], ['Verify the link', 'open']]);
  assert.equal(nextStep(steps)?.n, 1);
  const s = step(store, key, 'start', 2, { note: 'halfway; the template is the hard part' });
  assert.equal(s.next?.n, 2);
  assert.equal(s.next?.step.note, 'halfway; the template is the hard part');
  step(store, key, 'done', 1, {});
  step(store, key, 'drop', 3, { note: 'the link verifies itself' });
  const ctx = changeContext(store, key);
  assert.deepEqual(ctx.planProgress, { done: 1, total: 2 });
  assert.equal(ctx.next?.n, 2);
  assert.match(formatChangeContext(ctx), /^next: 2\. Send the mail — halfway; the template is the hard part$/m);
  assert.match(formatChangeContext(ctx), /## Plan \(1\/2 done\)\n\n1\. \[x\] Design the mail\n2\. \[>\] Send the mail — halfway; the template is the hard part\n3\. \[-\] Verify the link \(dropped\) — the link verifies itself/);
  step(store, key, 'move', 3, { first: true });
  step(store, key, 'reopen', 1, {});
  steps = stepsOf(loadStore(store).byKey.get('change:app/login')![0].data);
  assert.deepEqual(steps.map((s) => [s.text, s.state, s.note]), [['Verify the link', 'open', undefined], ['Design the mail', 'done', undefined], ['Send the mail', 'active', 'halfway; the template is the hard part']]);
  assert.throws(() => step(store, key, 'start', 3, {}), /already active/);
  assert.throws(() => step(store, key, 'move', 1, { before: 1 }), /is the step itself/);
  const evs = readEvents(store).filter((e) => e.key === 'change:app/login' && e.fields?.includes('plan'));
  assert.equal(evs.length, 8);
  assert.deepEqual(evs.slice(-2).map((e) => e.fields), [['plan', 'step move'], ['plan', 'step reopen']]);
  // the board and the scope read the next step where next was
  assert.match(formatStoreContext(storeContext(store, { project: 'project:app' })), /^  next: 3\. Send the mail — halfway; the template is the hard part$/m, 'the active step comes before an open one');
  const row = scope(store, loadStore(store), { lens: 'project' }).changes.find((c) => c.key === 'change:app/login')!;
  assert.equal(row.next, '3. Send the mail — halfway; the template is the hard part');
  assert.deepEqual(row.plan, { done: 1, total: 3 });
  assert.equal(row.name, 'Magic links');
  assert.deepEqual(errors(store), []);
});

test('a decision is a thread: created at any size, added to later, accepted by a person, reopened; its status follows', () => {
  assert.throws(() => decision(store, 'login/link-life', { entries: [] }), /needs --name, --gist, --question, --option/);
  const flags = entriesFromFlags({ question: 'How long does a link live?', criterion: ['a stolen link is useless soon'], option: ['short=Fifteen minutes', 'long=A day'], case: ['short=+ safe − a slow reader misses it'], recommend: 'short=fifteen minutes covers every mail client' }, 'agent:bot');
  const r = decision(store, 'login/link-life', { name: 'Link life', gist: 'How long a link lives: recommended fifteen minutes', entries: flags });
  assert.equal(r.created, true);
  assert.equal(r.status, 'proposed');
  assert.equal(r.state.recommendation?.option, 'short');
  assert.deepEqual(r.state.options.map((o) => [o.id, o.recommended, o.case]), [['short', true, '+ safe − a slow reader misses it'], ['long', false, undefined]]);
  assert.deepEqual(errors(store), []);
  assert.throws(() => newRecord(store, 'decision', 'login/x', { title: 'x' }), /pjman decision login\/x/, 'new decision points to the verb');
  assert.throws(() => set(store, 'decision:login/link-life', ['status=decided'], {}), /follows its thread/, 'status is not set by hand');
  // a later entry for the same id restates the option (change:decision-card): the latest text and case stand, the
  // recommendation on it stays, the thread keeps both; a case is points, one per line
  const r1 = decision(store, 'login/link-life', { entries: [{ type: 'option', id: 'short', text: 'Fifteen minutes', case: '- a stolen link is useless soon\n- a slow reader misses it' }] });
  assert.ok(r1.notes.some((n) => /short restated/.test(n)));
  assert.deepEqual(r1.state.options.map((o) => [o.id, o.recommended, pointsOf(o.case)]), [['short', true, ['a stolen link is useless soon', 'a slow reader misses it']], ['long', false, []]]);
  assert.equal(threadOf(loadStore(store).records.find((x) => x.key === 'decision:app/login/link-life')!.data).filter((e) => e.type === 'option' && e.id === 'short').length, 2);
  assert.match(formatDecisionState(r1.state).join('\n'), /- short \(recommended\): Fifteen minutes\n  - a stolen link is useless soon\n  - a slow reader misses it/);
  assert.throws(() => decision(store, 'login/link-life', { entries: [{ type: 'accept', option: 'short', by: 'agent:bot' }] }), /not the decider/, 'an agent never accepts');
  assert.throws(() => decision(store, 'login/link-life', { entries: [{ type: 'accept', option: 'nope', by: 'person:vinh' }] }), /not an option/, 'an acceptance names an option');
  // the person pushes back and the recommendation moves: the rungs are said to be stale
  const r2 = decision(store, 'login/link-life', { entries: [{ type: 'comment', text: 'fifteen is too tight for people on the train', by: 'person:vinh' }, { type: 'option', id: 'hour', text: 'An hour' }, { type: 'recommendation', option: 'hour', text: 'the train' }, { type: 'reject', option: 'short', text: 'too tight' }] });
  assert.equal(r2.created, false);
  assert.deepEqual(r2.appended, ['comment', 'option', 'recommendation', 'reject']);
  assert.ok(r2.notes.some((n) => /rewrite them/.test(n)));
  let rec = loadStore(store).byKey.get('decision:app/login/link-life')![0];
  assert.equal(rungsOf(rec).stale, true);
  assert.equal(decisionState(threadOf(rec.data)).options.find((o) => o.id === 'short')?.rejected, 'too tight');
  // accepted from the dashboard: the recommended option, by the person; the status event wakes the sessions
  const d = decide(store, 'decision:login/link-life', { by: 'person:vinh', words: 'an hour it is' });
  assert.equal(d.status, 'decided');
  rec = loadStore(store).byKey.get('decision:app/login/link-life')![0];
  assert.equal(rec.data.decided_by, 'person:vinh');
  assert.match(String(rec.data.decided_on), /^\d{4}-\d\d-\d\d$/);
  assert.ok(readEvents(store).at(-1)!.fields?.includes('status'));
  assert.throws(() => decide(store, 'decision:login/link-life', { by: 'person:vinh' }), /not proposed/);
  const ctx = changeContext(store, 'change:login');
  const text = formatChangeContext(ctx);
  assert.match(text, /### decision:app\/login\/link-life — Link life\nHow long a link lives: recommended fifteen minutes\ndecided by person:vinh on \d{4}-\d\d-\d\d\nrungs: stale/);
  assert.match(text, /Question: How long does a link live\?\nCriteria:\n- a stolen link is useless soon\nOptions:\n- short \(rejected: too tight\): Fifteen minutes\n  - a stolen link is useless soon\n  - a slow reader misses it\n- long: A day\n- hour \(accepted\): An hour\nWhy hour: the train\nperson:vinh \(\d{4}-\d\d-\d\d\): fifteen is too tight for people on the train\nAccepted hour by person:vinh on \d{4}-\d\d-\d\d: an hour it is/);
  assert.doesNotThrow(() => decision(store, 'login/link-life', { entries: [{ type: 'question', text: 'again?' }] }), 'a decided decision still takes a comment or a question');
  // reopened: the acceptance is no longer in force; the rungs rewritten are fresh
  const ro = reopen(store, 'decision:login/link-life', {});
  assert.equal(ro.status, 'proposed');
  rec = loadStore(store).byKey.get('decision:app/login/link-life')![0];
  assert.equal(rec.data.decided_by, undefined);
  decision(store, 'login/link-life', { name: 'Link life', gist: 'How long a link lives: an hour, reopened', entries: [] });
  assert.equal(rungsOf(loadStore(store).byKey.get('decision:app/login/link-life')![0]).stale, false);
  // a decision from a sync-less call with several options and no recommendation cannot be decided from a card
  decision(store, 'login/mail-sender', { name: 'Mail sender', gist: 'Who sends the mail', entries: [{ type: 'question', text: 'Who sends the mail?' }, { type: 'option', id: 'us', text: 'Our server' }, { type: 'option', id: 'them', text: 'A service' }] });
  assert.throws(() => decide(store, 'decision:login/mail-sender', { by: 'person:vinh' }), /recommends nothing/);
  assert.deepEqual(needsOf(loadStore(store).byKey.get('decision:app/login/mail-sender')![0]), []);
  assert.deepEqual(errors(store), []);
});

test('an ingested ticket makes a change in the shape with a draft gist, and says what it needs; pjman owns it afterwards', () => {
  set(store, 'project:app', ['tracker=linear', 'ext.linear.team=APP'], {});
  const issues = [{ identifier: 'APP-1', title: 'Login  is broken', url: 'https://linear.app/acme/issue/APP-1/login', state: { name: 'Todo', type: 'unstarted' }, team: { key: 'APP' } }];
  const r = syncLinear(store, { from: issues });
  assert.deepEqual(r.created, ['change:app/app-1']);
  const rec = loadStore(store).byKey.get('change:app/app-1')![0];
  assert.equal(rec.data.gist, 'Login is broken');
  assert.equal(rec.data.name, undefined);
  assert.match(rec.sections.get('Origin')!, /^from linear:APP-1/);
  assert.deepEqual(needsOf(rec), ['name', 'intent', 'done when']);
  const text = formatChangeContext(changeContext(store, 'change:app-1'));
  assert.match(text, /^# change:app\/app-1 — Login is broken\n/);
  assert.match(text, /^needs: name, intent, done when/m);
  assert.deepEqual(errors(store), []);
  set(store, 'change:app-1', ['name=Login fix', 'intent=i', 'done-when=d', 'status=active'], {});
  const again = syncLinear(store, { from: [{ ...issues[0], title: 'Renamed', state: { name: 'Done', type: 'completed' } }] });
  assert.deepEqual(again.updated, []);
  const after = loadStore(store).byKey.get('change:app/app-1')![0];
  assert.equal(after.data.status, 'active');
  assert.equal(after.data.gist, 'Login is broken');
  assert.equal(loadStore(store).byKey.get('linear:APP-1')![0].data.title, 'Renamed');
});

test('the migration maps the old shape into the foundation, nothing dropped; the mark clears on the next write', () => {
  const dir = path.join(store.root, 'products/app/changes/old');
  fs.mkdirSync(path.join(dir, 'decisions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'change.md'), '---\ntitle: The old change\nstatus: active\nproject: project:app\nnext: write the tests\nwriter: agent:bot\ncreated: 2026-10-01\n---\n\n## Summary\n\nWhat it was for.\n\n## Plan\n\n- first\n- second\n');
  fs.writeFileSync(path.join(dir, 'decisions', '2026-10-02-shape.md'), '---\ntitle: Its shape\nstatus: decided\ndecided_by: person:vinh\ndecided_on: 2026-10-02\nwriter: agent:bot\ncreated: 2026-10-02\n---\n\n## Decision\n\nShaped so.\n\n## Why\n\nBecause.\n');
  fs.writeFileSync(path.join(dir, 'decisions', '2026-10-03-open.md'), '---\ntitle: Still open\nstatus: proposed\nwriter: agent:bot\ncreated: 2026-10-03\n---\n\n## Decision\n\nDo this.\n\n## Why\n\nSo.\n');
  git(store.root, 'add', '-A');
  git(store.root, 'commit', '-qm', 'old shape');
  assert.ok(errors(store).some((e) => /pjman migrate/.test(e)));
  assert.throws(() => set(store, 'change:old', ['status=review'], {}), /pjman migrate/);
  assert.equal(pendingMigration(store), 'foundation');
  const m = migrate(store);
  assert.equal(m.kind, 'foundation');
  assert.equal(m.changes, 1);
  assert.equal(m.decisions, 2);
  assert.deepEqual(errors(store), []);
  const loaded = loadStore(store);
  const c = loaded.byKey.get('change:app/old')![0];
  assert.equal(c.data.gist, 'The old change');
  assert.equal(c.data.title, undefined);
  assert.equal(c.data.next, undefined);
  assert.equal(c.sections.get('Intent'), 'What it was for.');
  assert.match(c.sections.get('Origin')!, /^Mapped from the record as it stood before the foundation/);
  assert.match(c.sections.get('Notes')!, /next \(before the foundation\): write the tests/);
  assert.deepEqual(stepsOf(c.data).map((s) => [s.text, s.state]), [['first', 'open'], ['second', 'open']]);
  assert.match(String(c.data.migrated), /^\d{4}-\d\d-\d\d$/);
  assert.deepEqual(needsOf(c), ['name', 'done when'], 'a summary becomes the intent; nothing in the old shape said when it is done');
  const d = loaded.byKey.get('decision:app/old/shape')![0];
  const st = decisionState(threadOf(d.data));
  assert.deepEqual(st.options.map((o) => [o.id, o.text, o.case, o.accepted]), [['chosen', 'Shaped so.', 'Because.', true]]);
  assert.equal(st.accepted?.by, 'person:vinh');
  assert.equal(d.data.status, 'decided');
  const o = loaded.byKey.get('decision:app/old/open')![0];
  assert.equal(decisionState(threadOf(o.data)).recommendation?.option, 'chosen');
  assert.equal(o.data.status, 'proposed');
  assert.match(formatChangeContext(changeContext(store, 'change:old')), /^migrated: \d{4}-\d\d-\d\d \(mapped from the old shape/m);
  assert.equal(pendingMigration(store), null);
  assert.throws(() => migrate(store), /nothing to migrate/);
  // the first write through the tool clears the mark
  set(store, 'change:old', ['name=Old change'], {});
  assert.equal(loadStore(store).byKey.get('change:app/old')![0].data.migrated, undefined);
  decision(store, 'old/open', { entries: [{ type: 'comment', text: 'read it', by: 'person:vinh' }] });
  assert.equal(loadStore(store).byKey.get('decision:app/old/open')![0].data.migrated, undefined);
  assert.deepEqual(errors(store), []);
});

test('the batch admits decision and step lines; the CLI writes a decision from flags and from JSON', () => {
  const bin = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'bin', 'pjman.js');
  const env = { ...process.env, PJMAN_WRITER: 'agent:bot' };
  const run = (...args: string[]) => execFileSync(process.execPath, [bin, ...args], { cwd: project, env, encoding: 'utf8' });
  const out = run('decision', 'login/retry', '--name', 'Retry', '--gist', 'Retry a failed mail: recommended once', '--question', 'Retry a failed mail?', '--option', 'once=Once', '--option', 'never=Never', '--recommend', 'once=cheap');
  assert.match(out, /^created decision:login\/retry \(question, option, option, recommendation\): proposed, recommended once/);
  const json = JSON.stringify({ entries: [{ type: 'comment', text: 'once is fine', by: 'person:vinh' }, { type: 'accept', option: 'once', by: 'person:vinh', text: 'go' }] });
  const acc = execFileSync(process.execPath, [bin, 'decision', 'login/retry', '--from', '-'], { cwd: project, env, encoding: 'utf8', input: json });
  assert.match(acc, /accepted once/);
  const batch = 'step change:login add "a step from the batch"\ndecision login/retry --comment "and a comment" --by person:vinh\n';
  const applied = execFileSync(process.execPath, [bin, 'apply', '-', '--for', 'change:login'], { cwd: project, env, encoding: 'utf8', input: batch });
  assert.match(applied, /applied 2 writes/);
  assert.deepEqual(errors(store), []);
  const plan = run('step', 'change:login', 'note', '4', 'nearly there');
  assert.match(plan, /4\. \[ \] a step from the batch — nearly there/);
});
