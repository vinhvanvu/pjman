import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { set } from '../commands/set.js';
import { sessionBind, sessionFocus, sessionLog, sessionObserve } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { readEvents, rebuildEvents } from '../events.js';
import { brief, computeBrief, focusOf, neighboursOf } from '../hydrate.js';
import { findSession, loadStore } from '../records.js';
import { validate } from '../validate.js';
import { accept, change, decisionRec, next } from './shape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '..', '..', 'bin', 'pjman.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-hydrate-'));
const dir = path.join(tmp, 'web');
let store: Store;

const session = (id: string) => findSession(loadStore(store), id)!;

before(() => {
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
  newRecord(store, 'feature', 'login', { title: 'Signing in', product: 'product:web' });
  newRecord(store, 'feature', 'billing', { title: 'Paying', product: 'product:web' });
  change(store, 'milestone', { title: 'Launch', summary: 's', project: 'project:web' });
  change(store, 'auth', { title: 'Auth', summary: 's', project: 'project:web', parent: 'change:milestone', features: ['feature:login'] });
  change(store, 'after-auth', { title: 'After auth', summary: 's', project: 'project:web', dependsOn: ['change:auth'] });
  change(store, 'sso', { title: 'SSO', summary: 's', project: 'project:web', features: ['feature:login'] });
  change(store, 'invoices', { title: 'Invoices', summary: 's', project: 'project:web', features: ['feature:billing'] });
  for (const id of ['me', 'peer', 'near', 'far', 'gone']) newRecord(store, 'session', id, { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
});

test('an unbound session has no brief; binding gives the change in full once, and the watermark is recorded', () => {
  assert.equal(computeBrief(store, 'me').mode, 'none');
  sessionBind(store, 'me', 'change:auth', 'prompt');
  const b = brief(store, 'me');
  assert.equal(b.mode, 'full');
  assert.match(b.text, /^pjman brief: this session is bound to change:web\/auth; its context in full\.\n\n# change:web\/auth — Auth/);
  assert.equal(b.size.chars, b.text.length);
  assert.ok(b.size.tokens > 0 && b.size.lines > 0);
  const mark = session('me').data.briefed as { change: string; seq: number };
  assert.equal(mark.change, 'change:web/auth');
  assert.equal(mark.seq, b.seq);
  // the bind says why, in the log
  assert.match(session('me').sections.get('Log') ?? '', /bound change:web\/auth \(prompt\)/);
  // nothing new: nothing said, nothing written
  const before = readEvents(store).length;
  assert.equal(brief(store, 'me').mode, 'none');
  assert.equal(readEvents(store).length, before);
});

test('the delta: what others wrote on the change, its milestone, its decisions and its dependency edges, one line per record', () => {
  next(store, 'change:auth', 'first', { session: 'session:peer' });
  next(store, 'change:auth', 'second', { session: 'session:peer' });
  set(store, 'change:auth', ['status=active'], { session: 'session:peer' });
  next(store, 'change:milestone', 'launch soon', { session: 'session:peer' });
  next(store, 'change:after-auth', 'waiting on auth', { session: 'session:peer' });
  decisionRec(store, 'auth/tokens', { title: 'Tokens', decision: 'd', why: 'w', session: 'session:peer' });
  next(store, 'change:invoices', 'unrelated', { session: 'session:peer' });
  next(store, 'change:auth', 'my own', { session: 'session:me' });
  const b = brief(store, 'me');
  assert.equal(b.mode, 'delta');
  assert.deepEqual(b.lines, [
    'set change:web/auth (plan, step add, status → active) (3 writes)',
    'set change:web/milestone (plan, step add)',
    'set change:web/after-auth (plan, step add)',
    'created decision:web/auth/tokens — Tokens',
  ]);
  assert.ok(!b.text.includes('invoices'), 'a change outside the scope is not mentioned');
  assert.match(b.text, /\(pjman context change:web\/auth has the whole record\.\)/);
  assert.equal(brief(store, 'me').mode, 'none', 'the same thing is never told twice');
});

test('--full gives the whole context again, as after the conversation was compacted', () => {
  assert.equal(brief(store, 'me', { full: true }).mode, 'full');
});

test('neighbours: other live sessions on the same change, or on a change naming the same feature node; shared files warn', () => {
  sessionObserve(store, 'me', 'links', 'change:auth', 'file:src/auth.ts');
  sessionBind(store, 'peer', 'change:auth');
  sessionObserve(store, 'peer', 'links', 'change:auth', 'file:src/auth.ts');
  sessionBind(store, 'near', 'change:sso');
  sessionBind(store, 'far', 'change:invoices');
  sessionBind(store, 'gone', 'change:auth');
  sessionLog(store, 'gone', 'session ended (other)');
  const loaded = loadStore(store);
  const ns = neighboursOf(loaded, session('me'), loaded.byKey.get('change:web/auth')![0], readEvents(store));
  assert.deepEqual(ns.map((n) => [n.session, n.on, n.feature ?? null, n.shared]).sort(), [
    ['session:near', 'change:web/sso', 'feature:web/login', []],
    ['session:peer', 'change:web/auth', null, ['file:src/auth.ts']],
  ]);
  // an hour on, none of them is live
  assert.deepEqual(neighboursOf(loaded, session('me'), loaded.byKey.get('change:web/auth')![0], readEvents(store), Date.now() + 3_600_000), []);
  // the delta carries a neighbour that moved since the last brief, with its warning
  const b = brief(store, 'me');
  assert.match(b.text, /session:peer on this change, last moved just now, last touched file:src\/auth\.ts — warning: it also touched file:src\/auth\.ts/);
  assert.match(b.text, /session:near on change:web\/sso, which also names feature:web\/login/);
  assert.ok(!/session:far|session:gone/.test(b.text));
});

test('focus follows what the session reads and writes; binding does not move with it', () => {
  const at = () => focusOf(loadStore(store), session('me'), readEvents(store))?.change;
  sessionFocus(store, 'me', 'change:invoices');
  assert.equal(at(), 'change:web/invoices');
  next(store, 'change:sso', 'looked', { session: 'session:me' });
  assert.equal(at(), 'change:web/sso');
  decisionRec(store, 'after-auth/order', { title: 'Order', decision: 'd', why: 'w', session: 'session:me' });
  assert.equal(at(), 'change:web/after-auth', 'a decision moves focus to the change it sits on');
  assert.deepEqual(session('me').data.changes, ['change:web/auth']);
  assert.equal(sessionFocus(store, 'me', 'change:invoices').moved, true, 'reading it again after writing elsewhere moves back');
  assert.equal(at(), 'change:web/invoices');
  assert.equal(sessionFocus(store, 'me', 'change:invoices').moved, false, 'written only when it moves');
});

test('the CLI: a change filed by a session binds it; reading a change\'s context moves its focus; a brief by --session', () => {
  const env = { ...process.env, PJMAN_SESSION: 'session:me', PJMAN_WRITER: 'agent:claude-code' };
  const run = (...args: string[]) => execFileSync(process.execPath, [BIN, ...args], { cwd: dir, env, encoding: 'utf8' });
  const created = run('new', 'change', 'reset', '--name', 'Reset', '--gist', 'Reset', '--origin', 'asked', '--intent', 's', '--done-when', 'd');
  assert.match(created, /note: bound session:me \(created\)/);
  assert.equal((session('me').data.changes as string[]).at(-1), 'change:web/reset');
  run('context', 'change:sso');
  assert.equal((session('me').data.focus as { change: string }).change, 'change:web/sso');
  const b = JSON.parse(run('brief', '--session', 'me', '--json')) as { mode: string; text: string };
  assert.equal(b.mode, 'full');
  assert.match(b.text, /bound to change:reset;/, 'the text names records as the context does inside the product');
  assert.match(run('brief', '--session', 'me'), /nothing new for this session/);
});

test('the store stays valid, and a rebuilt stream keeps focus and briefed as sets on the session', () => {
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
  rebuildEvents(store);
  const ev = readEvents(store).filter((e) => e.key === 'session:me' && e.op === 'set');
  assert.ok(ev.some((e) => e.fields?.includes('focus')));
  assert.ok(ev.some((e) => e.fields?.includes('briefed')));
});
