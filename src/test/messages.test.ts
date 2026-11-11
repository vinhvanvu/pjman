import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { note, notesOf } from '../commands/note.js';
import { sessionBind } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { readEvents, rebuildEvents } from '../events.js';
import { brief, wakeOf } from '../hydrate.js';
import { findSession, loadStore, resolve } from '../records.js';
import { receiptLines } from '../receipt.js';
import { validate } from '../validate.js';
import { accept, change, decisionRec, next } from './shape.js';
import { decision as writeDecision } from '../commands/decision.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '..', '..', 'bin', 'pjman.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-messages-'));
const dir = path.join(tmp, 'web');
let store: Store;

const session = (id: string) => findSession(loadStore(store), id)!;
const wakes = (id: string, since: number) => {
  const loaded = loadStore(store);
  return readEvents(store, since).map((e) => wakeOf(loaded, findSession(loaded, id)!, e)).filter(Boolean);
};

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
  change(store, 'auth', { title: 'Auth', summary: 's', project: 'project:web' });
  change(store, 'billing', { title: 'Billing', summary: 's', project: 'project:web' });
  decisionRec(store, 'auth/tokens', { title: 'Tokens', decision: 'd', why: 'w' });
  decisionRec(store, 'billing/cards', { title: 'Cards', decision: 'd', why: 'w' });
  for (const id of ['me', 'idle', 'peer']) newRecord(store, 'session', id, { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  sessionBind(store, 'me', 'change:auth', 'prompt');
  brief(store, 'me');
});

test('a note is one line under Notes on its change or session, an event of its own, and validates', () => {
  const r = note(store, 'change:auth', 'try the refresh token first', { writer: 'person:tester' });
  assert.equal(r.key, 'change:web/auth');
  const rec = resolve(loadStore(store), 'change:auth');
  assert.ok(rec.status === 'ok');
  const notes = notesOf(rec.rec.sections.get('Notes'));
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.writer, 'person:tester');
  assert.equal(notes[0]!.text, 'try the refresh token first');
  const e = readEvents(store).at(-1)!;
  assert.equal(e.op, 'log');
  assert.deepEqual(e.fields, ['notes']);
  assert.deepEqual(receiptLines([e], loadStore(store)), ['noted change:web/auth — Auth']);
  assert.throws(() => note(store, 'decision:auth/tokens', 'x'), /addressed to a change or a session/);
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
});

test('the brief gives a note in full, never as a count, and not the session its own', () => {
  const b = brief(store, 'me');
  assert.equal(b.mode, 'delta');
  assert.deepEqual(b.lines, []);
  assert.equal(b.notes?.length, 1);
  assert.match(b.notes![0]!, /^person:tester on change:web\/auth, \d{4}-\d\d-\d\d \d\d:\d\d: try the refresh token first$/);
  assert.match(b.text, /\nNotes:\n- person:tester on change:web\/auth/);
  note(store, 'change:auth', 'my own aside', { session: 'session:me' });
  note(store, 'session:me', 'look at billing after', { writer: 'person:tester' });
  const next = brief(store, 'me');
  assert.deepEqual(next.notes?.map((n) => n.replace(/, .*: /, ': ')), ['person:tester to this session: look at billing after']);
});

test('an unbound session is still given a note addressed to it, and its watermark stands on no change', () => {
  note(store, 'session:idle', 'pick up change:billing when free', { writer: 'person:tester' });
  const b = brief(store, 'idle');
  assert.equal(b.mode, 'delta');
  assert.equal(b.change, undefined);
  assert.match(b.text, /^pjman brief: notes for this session:\n- person:tester to this session/);
  const mark = session('idle').data.briefed as { change?: string; seq: number };
  assert.equal(mark.change, undefined);
  assert.equal(brief(store, 'idle').mode, 'none');
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
  // binding later gives the change in full
  sessionBind(store, 'idle', 'change:billing', 'prompt');
  assert.equal(brief(store, 'idle').mode, 'full');
});

test('what wakes a session: a decision on its bound change decided, a note on that change or to it, by anyone but itself', () => {
  const from = readEvents(store).at(-1)!.seq;
  writeDecision(store, 'decision:auth/tokens', { entries: [{ type: 'comment', text: 'd2' }] }); // not a decision being decided
  accept(store, 'decision:billing/cards', 'person:tester', '2026-10-29'); // another change
  next(store, 'change:auth', 'n', {}); // an ordinary write
  note(store, 'change:billing', 'for billing'); // a note elsewhere
  note(store, 'session:me', 'mine', { session: 'session:me' }); // its own
  assert.deepEqual(wakes('me', from), []);
  accept(store, 'decision:auth/tokens', 'person:tester', '2026-10-29');
  note(store, 'change:auth', 'go');
  note(store, 'session:me', 'and you', { session: 'session:peer' });
  assert.deepEqual(wakes('me', from), ['decision:web/auth/tokens decided by person:tester', 'a note on change:web/auth', 'a note to this session']);
  // the other session bound to billing is woken by billing's
  assert.deepEqual(wakes('idle', from), ['decision:web/billing/cards decided by person:tester', 'a note on change:web/billing']);
});

test('the events rebuilt from history keep a note a note', () => {
  const before = readEvents(store).filter((e) => e.fields?.includes('notes')).length;
  rebuildEvents(store);
  const after = readEvents(store).filter((e) => e.op === 'log' && e.fields?.includes('notes')).length;
  assert.equal(after, before);
});

test('pjman wakes --follow prints a line for each wake as it lands, and nothing for the rest', async () => {
  const env = { ...process.env, PJMAN_SESSION: '', PJMAN_WRITER: '' };
  const child = spawn(process.execPath, [BIN, 'wakes', '--session', 'me', '--follow', '--json'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  try {
    await new Promise((r) => setTimeout(r, 600));
    execFileSync(process.execPath, [BIN, 'step', 'change:auth', 'add', 'quiet'], { cwd: dir, env });
    execFileSync(process.execPath, [BIN, 'note', 'change:auth', 'wake up'], { cwd: dir, env });
    const deadline = Date.now() + 5000;
    while (!out.includes('\n') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const lines = out.trim().split('\n').map((l) => JSON.parse(l) as { why: string; key: string });
    assert.deepEqual(lines.map((l) => l.why), ['a note on change:auth']); // the command names records as the context does inside the product
  } finally {
    child.kill();
  }
});
