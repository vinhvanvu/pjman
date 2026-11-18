// pjman why says why a line exists as far down as the record goes (change:pjman-why): git's commit, Entire's
// checkpoint, session and prompt where the project opted in, and the store's change, intent and decisions. Intake
// lists past sessions like the request, from the store and from Entire's search. Both stand without Entire.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { decision } from '../ops/decision.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionLog, sessionName } from '../ops/session.js';
import { set } from '../ops/set.js';
import { formatIntake, intake } from '../model/intake.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { syncEntire } from '../sync/entire.js';
import { formatWhy, parseWhere, searchPast, why } from '../sync/why.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-why-')));
const dir = path.join(tmp, 'web');
const CP = '01WHYWHYWHYWHYWHYWHYWHYWHY';
let store: Store;
let bin: string;
const g = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tess', '-c', 'user.email=t@example.com', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'cart.ts'), 'export const TAX = 0.2;\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: start');
  fs.appendFileSync(path.join(dir, 'cart.ts'), 'export const round = (n) => Math.round(n);\n');
  g('add', '-A');
  g('commit', '-q', '-m', `feat: the cart rounds half to even (change:cart)\n\nEntire-Checkpoint: ${CP}`);
  fs.appendFileSync(path.join(dir, 'cart.ts'), 'export const fee = 1;\n');
  g('add', '-A');
  g('commit', '-q', '-m', `feat: a fee\n\nEntire-Checkpoint: 01FEEFEEFEEFEEFEEFEEFEEFEE`);
  fs.appendFileSync(path.join(dir, 'cart.ts'), 'export const draft = true;\n');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  set(store, 'project:web', ['ext.github.repo=acme/web'], {});
  change(store, 'cart', {
    name: 'Cart',
    gist: 'The cart totals what a shopper picked',
    intent: 'A shopper sees what they owe.',
    project: 'project:web',
  });
  change(store, 'fees', { name: 'Fees', gist: 'A flat fee per order', project: 'project:web' });
  decision(store, 'cart/rounding', {
    name: 'Rounding',
    gist: 'How the total rounds',
    entries: [
      { type: 'question', text: 'How does the total round?' },
      { type: 'option', id: 'half-even', text: 'Half to even, per line' },
      { type: 'accept', option: 'half-even', by: 'person:tester' },
    ],
  });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code', project: 'project:web' });
  sessionName(store, 's1', { name: 'Cart rounding', kind: 'chat' });
  sessionLog(store, 's1', 'made the cart total round half to even per line');
  sessionBind(store, 's1', 'change:fees');
  bin = path.join(tmp, 'entire');
  fs.writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> ${path.join(tmp, 'calls.log')}
case "$1" in
  why) case "$2" in
    cart.ts:2) echo '{"file":"cart.ts","line":{"line_number":2,"status":"checkpoint","checkpoint_id":"${CP}","session_id":"s1","agent":"Claude Code","prompt":"make the total round the way finance asked","intent":"Round per line"}}' ;;
    cart.ts:3) echo '{"file":"cart.ts","line":{"line_number":3,"status":"checkpoint","checkpoint_id":"01FEEFEEFEEFEEFEEFEEFEEFEE","session_id":"s1","prompt":"first words","prompt_session_level":true}}' ;;
    *) echo '{"file":"cart.ts","line":{"line_number":1,"status":"commit"}}' ;;
  esac ;;
  search) echo '{"results":[{"type":"session","data":{"sessionId":"s1","prompt":"p","createdAt":"2026-11-01T00:00:00Z"},"searchMeta":{"snippet":"dup of the store"}},{"type":"session","data":{"sessionId":"elsewhere","displayName":"Totals spike","createdAt":"2026-10-02T00:00:00Z"},"searchMeta":{"snippet":"tried rounding totals in the cart"}},{"type":"commit","data":{}}],"total":3}' ;;
  checkpoint) echo '{"sessions":[{"session_id":"s1"}]}' ;;
  trail) echo 'branch has no discoverable project trail' >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
});

test('without Entire the answer starts at git and reaches the change, its intent and its decisions', () => {
  const w = why(store, parseWhere('cart.ts:2'), { cwd: dir, entire: { bin } });
  assert.equal(w.content, 'export const round = (n) => Math.round(n);');
  assert.equal(w.commit?.subject, 'feat: the cart rounds half to even (change:cart)');
  assert.equal(w.entire, undefined);
  assert.deepEqual(
    w.changes.map((c) => [c.key, c.by, c.intent, c.decisions.map((d) => d.accepted)]),
    [['change:web/cart', 'commit', 'A shopper sees what they owe.', ['Half to even, per line']]],
  );
  assert.ok(!fs.existsSync(path.join(tmp, 'calls.log')), 'nothing of Entire ran');
  assert.match(
    formatWhy(w),
    /^cart\.ts:2 {2}export const round.*\n\ncommit [0-9a-f]{8} \d{4}-\d\d-\d\d Tess\n {2}feat: the cart rounds.*\n\nchange:web\/cart — Cart: The cart totals what a shopper picked\n {2}intent: A shopper sees what they owe\.\n(?: {2}done when: .*\n)? {2}decided \(Rounding\): Half to even, per line\n {2}the rest \(origin, plan, sources\): pjman context change:web\/cart$/,
  );
  assert.deepEqual(why(store, parseWhere('cart.ts', '1'), { cwd: dir }).changes, [], 'a commit that names no change');
  assert.equal(why(store, parseWhere('cart.ts:4'), { cwd: dir }).commit, undefined, 'not committed yet');
  assert.match(formatWhy(why(store, parseWhere('cart.ts:4'), { cwd: dir })), /not committed yet/);
  assert.throws(() => parseWhere('cart.ts'), /usage: pjman why <file>:<line>/);
  assert.throws(() => why(store, parseWhere('cart.ts:99'), { cwd: dir }), /cart\.ts:99 could not be read/);
});

test("opted in, Entire's checkpoint, session and prompt join it, and a commit naming no change is reached through them", () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  const w = why(store, parseWhere('cart.ts:2'), { cwd: dir, entire: { bin } });
  assert.deepEqual(w.entire, {
    checkpoint: CP,
    session: 's1',
    agent: 'Claude Code',
    prompt: 'make the total round the way finance asked',
    intent: 'Round per line',
  });
  assert.deepEqual(w.session, { key: 'session:s1', name: 'Cart rounding' });
  assert.match(
    formatWhy(w),
    /\nsession session:s1 "Cart rounding" · Claude Code · checkpoint 01WHY\w+\n {2}asked: make the total round the way finance asked\n {2}meant: Round per line\n\nchange:web\/cart/,
  );
  // the fee commit names no change: its session worked on fees
  const fee = why(store, parseWhere('cart.ts:3'), { cwd: dir, entire: { bin } });
  assert.deepEqual(
    fee.changes.map((c) => [c.key, c.by]),
    [['change:web/fees', 'session']],
  );
  assert.match(formatWhy(fee), /the session opened with: first words/);
  // once synced, the checkpoint's own link is the stronger lead, and it carries where it opens
  syncEntire(store, { entire: { bin } });
  const linked = why(store, parseWhere('cart.ts:2'), { cwd: dir, entire: { bin } });
  assert.match(String(linked.entire?.url), /^https:\/\/entire\.com\/gh\/acme\/web\/commit\/[0-9a-f]{40}$/);
  // Entire not answering leaves git's answer and the change standing
  const down = why(store, parseWhere('cart.ts:2'), { cwd: dir, entire: { bin: path.join(tmp, 'gone') } });
  assert.deepEqual(down.pending, [`no entire at ${path.join(tmp, 'gone')}`]);
  assert.deepEqual(
    down.changes.map((c) => c.key),
    ['change:web/cart'],
  );
});

test("intake lists past sessions like the request: the store's own, and Entire's search where opted in", () => {
  const loaded = loadStore(store);
  const own = intake(store, loaded, 'round the cart total', { project: 'project:web' });
  assert.deepEqual(
    own.sessions.map((s) => [s.session, s.name, s.from]),
    [['session:s1', 'Cart rounding', 'store']],
  );
  const found = searchPast(store, own, { entire: { bin } });
  assert.deepEqual(
    found.sessions.map((s) => [s.session, s.name, s.from]),
    [
      ['session:s1', 'Cart rounding', 'store'],
      [undefined, 'Totals spike', 'entire'],
    ],
    'a session the store already listed is not listed twice',
  );
  assert.match(
    formatIntake(found),
    /## Past sessions .*\n- session:s1 "Cart rounding" \d{4}-\d\d-\d\d · worked on change:web\/fees · round, cart, total\n- \(a session Entire holds, not in this store\) "Totals spike" 2026-10-02 · Entire: tried rounding totals in the cart \(elsewhere\)/,
  );
  const down = searchPast(store, own, { entire: { bin: path.join(tmp, 'gone') } });
  assert.equal(down.searchPending, `no entire at ${path.join(tmp, 'gone')}`);
  assert.equal(down.sessions.length, 1);
  set(store, 'project:web', ['ext.entire.enabled='], {});
  assert.equal(searchPast(store, own, { entire: { bin } }), own, 'off: Entire is not asked');
  assert.doesNotMatch(formatIntake(intake(store, loadStore(store), 'ship the invoices')), /Past sessions/);
});

test('a path through a symlink is blamed as the file it is', () => {
  const link = path.join(os.tmpdir(), `pjman-why-link-${process.pid}`);
  fs.symlinkSync(dir, link);
  try {
    const w = why(store, parseWhere('cart.ts:2'), { cwd: link, entire: { bin } });
    assert.equal(w.file, 'cart.ts');
    assert.equal(w.commit?.subject, 'feat: the cart rounds half to even (change:cart)');
  } finally {
    fs.rmSync(link);
  }
});

test('the decisions made on the milestones above the change are its reasons too', () => {
  change(store, 'checkout', { name: 'Checkout', gist: 'A shopper can pay', project: 'project:web', kind: 'milestone' });
  set(store, 'change:cart', ['parent=change:checkout'], {});
  decision(store, 'checkout/currency', {
    name: 'Currency',
    gist: 'What the shop charges in',
    entries: [
      { type: 'question', text: 'Which currency?' },
      { type: 'option', id: 'eur', text: 'Euros only' },
      { type: 'accept', option: 'eur', by: 'person:tester' },
    ],
  });
  const w = why(store, parseWhere('cart.ts:2'), { cwd: dir, entire: { bin: path.join(tmp, 'gone') } });
  assert.deepEqual(w.changes[0].parent, { key: 'change:web/checkout', name: 'Checkout' });
  assert.deepEqual(
    w.changes[0].decisions.map((d) => [d.name, d.accepted, d.on]),
    [
      ['Rounding', 'Half to even, per line', undefined],
      ['Currency', 'Euros only', 'change:web/checkout'],
    ],
  );
  const text = formatWhy(w);
  assert.match(text, /\n {2}under: change:web\/checkout — Checkout\n/);
  assert.match(text, /\n {2}decided on change:web\/checkout \(Currency\): Euros only\n/);
});
