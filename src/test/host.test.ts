// The host interface (change:rex-adapter): adapters read from a fake environment and fake commands, so no test needs a
// terminal multiplexer installed. The fakes record every call; a test reads what the adapter asked of the host.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, type Store } from '../store/config.js';
import { cmux, detectHost, hostOfRecord, hostPresent, inRange, rex, rexEvent, rootStatus, sessionHost, statusOf, versionIn } from '../hosts/host.js';
import { findSession, loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { sessionBind } from '../ops/session.js';
import { step } from '../ops/step.js';
import { change, decisionRec } from './shape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(here, '..', '..', 'bin', 'pjman.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-host-'));
const fakes = path.join(tmp, 'bin');
const calls = path.join(tmp, 'calls');
fs.mkdirSync(fakes, { recursive: true });
fs.writeFileSync(calls, '');

// a rex that answers version, a block's program status, block ls after a new, and a few lines of events
fs.writeFileSync(path.join(fakes, 'rex'), `#!/bin/sh
echo "rex $*" >> '${calls}'
case "$1 $2 $3" in
  "version --json ") echo '{"version":"0.3.1","platform":"darwin_arm64"}';;
  "block call -s") echo '[{"id":"build/test","state":"working","app":"cargo"},{"state":"blocked","kind":"question","app":"claude-code","title":"Q"}]';;
  "block rename -s") echo "ok";;
  "send -s "*) echo "ok";;
  "focus -s "*) echo "ok";;
  "new "*) echo '{"session_id":"session:new1","label":"'$2'"}';;
  "block ls -s") echo '[{"block_id":"block:b1","label":"shell"}]';;
  "events -s "*) echo '{"type":"session_event","payload":{"session_id":"session:s1","event":{"type":"block_event","payload":{"block_id":"block:b1","creator_name":"com.superlogical.terminal","name":"program_status_changed","payload":{"id":"","record":{"state":"blocked","kind":"permission"},"reason":"report"}}}}}'
    echo '{"type":"session_event","payload":{"session_id":"session:s1","event":{"type":"block_event","payload":{"block_id":"block:b1","creator_name":"com.superlogical.terminal","name":"child_exited","payload":{"exit_code":0}}}}}';;
  *) exit 1;;
esac
`, { mode: 0o755 });
fs.writeFileSync(path.join(fakes, 'cmux'), `#!/bin/sh
echo "cmux $*" >> '${calls}'
case "$1" in
  --version) echo "cmux 0.62.2 (77) [6c203b514]";;
  set-status|send|select-workspace|rename-workspace) echo "OK";;
  new-workspace) echo "OK workspace:9";;
  *) exit 1;;
esac
`, { mode: 0o755 });
const seen = () => fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('REX_') && !k.startsWith('CMUX_'))) as NodeJS.ProcessEnv;
const withRex = { ...clean(), PATH: `${fakes}:${process.env.PATH ?? ''}`, REX_SESSION: 'session:s1', REX_BLOCK: 'block:b1' };
const withCmux = { ...clean(), PATH: `${fakes}:${process.env.PATH ?? ''}`, CMUX_WORKSPACE_ID: 'workspace:3', CMUX_SURFACE_ID: 'surface:7', CMUX_BUNDLE_ID: 'com.cmuxterm.app' };
// no host command anywhere on the PATH, the system's own tools still at hand
const none = { ...clean(), PATH: `${path.join(tmp, 'empty')}:/usr/bin:/bin` };
fs.mkdirSync(path.join(tmp, 'empty'), { recursive: true });

test('versions and ranges: the first semver in a text, and a range written as bounds', () => {
  assert.equal(versionIn('cmux 0.62.2 (77) [6c203b514]'), '0.62.2');
  assert.equal(versionIn('rex 0.3.1-beta.2'), '0.3.1-beta.2');
  assert.equal(versionIn('no version here'), null);
  assert.ok(inRange('0.3.1', '>=0.1 <1'));
  assert.ok(!inRange('1.0.0', '>=0.1 <1'));
  assert.ok(!inRange('0.0.9', '>=0.1 <1'));
  assert.ok(inRange('0.62.2', '>=0.62 <1'));
  assert.ok(inRange('0.3.1-beta.2', '>=0.3 <0.4'), 'a pre-release tag is read by its numbers');
  assert.ok(!inRange('junk', '>=0.1'));
});

test('a status record is read by its state; blocked carries its kind; the root record stands for the program', () => {
  assert.deepEqual(statusOf({ state: 'working', app: 'claude-code' })?.state, 'working');
  const b = statusOf({ state: 'blocked', kind: 'question', title: 'Q', msg: 'which?' });
  assert.equal(b?.kind, 'question');
  assert.equal(b?.title, 'Q');
  assert.equal(statusOf({ state: 'working', kind: 'question' })?.kind, undefined, 'a kind means something only on blocked');
  assert.equal(statusOf({ state: 'clear' }), null, 'clear is not a state');
  assert.equal(statusOf('working'), null);
  // among several records the one with no id is the program's own; the children (build/test) are its parts
  assert.equal(rootStatus([{ id: 'build/test', state: 'working' }, { state: 'blocked', kind: 'permission' }])?.kind, 'permission');
  assert.equal(rootStatus({ records: [{ id: 'a', state: 'idle' }, { id: 'b', state: 'done' }] })?.state, 'done', 'no root: the last reported');
  assert.equal(rootStatus([]), null);
});

test('detection reads the environment: Rex by REX_SESSION, cmux by CMUX_WORKSPACE_ID, nothing outside both', () => {
  assert.deepEqual(detectHost(withRex)?.id, { session: 'session:s1', block: 'block:b1' });
  assert.equal(detectHost(withRex)?.adapter, rex);
  assert.deepEqual(detectHost(withCmux)?.id, { session: 'workspace:3', block: 'surface:7' });
  assert.equal(detectHost(withCmux)?.adapter, cmux);
  assert.equal(detectHost(none), null);
  assert.equal(detectHost({ ...none, REX_SESSION: 'session:x' })?.id.block, undefined, 'a session with no block still identifies');
});

test('what the session record carries: the ids, the version by the host command, and whether the adapter validated it', () => {
  assert.deepEqual(sessionHost(withRex), { name: 'rex', session: 'session:s1', block: 'block:b1', version: '0.3.1', validated: true });
  assert.deepEqual(sessionHost(withCmux), { name: 'cmux', session: 'workspace:3', block: 'surface:7', version: '0.62.2', validated: true });
  assert.equal(sessionHost(none), null);
  // the host present but its command gone: the ids still, no version, validated unknown
  const h = sessionHost({ ...withRex, PATH: none.PATH });
  assert.deepEqual(h, { name: 'rex', session: 'session:s1', block: 'block:b1', version: undefined, validated: undefined });
  assert.equal(hostPresent(withRex)?.adapter, rex, 'the first host whose command answers');
  assert.equal(hostPresent(none), null);
});

test('Rex: status by the block method, the label by block rename, send with Enter, open by focus, launch by new', () => {
  fs.writeFileSync(calls, '');
  const id = { session: 'session:s1', block: 'block:b1' };
  const s = rex.status(id, withRex);
  assert.equal(s?.state, 'blocked');
  assert.equal(s?.kind, 'question');
  assert.ok(rex.label(id, 'Rex adapter · 1/7', withRex));
  assert.ok(rex.send(id, 'carry on', withRex));
  assert.ok(rex.open(id, withRex));
  assert.deepEqual(rex.launch({ cwd: '/tmp/w', name: 'rex-adapter', command: ['claude', '--worktree', 'rex-adapter'] }, withRex), { session: 'session:new1', block: 'block:b1' });
  assert.deepEqual(seen(), [
    'rex block call -s session:s1 -b block:b1 program_status',
    'rex block rename -s session:s1 block:b1 Rex adapter · 1/7',
    'rex send -s session:s1 -b block:b1 carry on\r',
    'rex focus -s session:s1 block:b1',
    'rex new rex-adapter -c /tmp/w --json -- claude --worktree rex-adapter',
    'rex block ls -s session:new1 --json',
  ]);
  assert.equal(rex.status({ session: 'session:s1' }, withRex), null, 'no block, no program to ask');
  assert.equal(rex.status(id, none), null, 'no command, no status');
  assert.ok(!rex.label(id, 'x', none));
});

test('Rex events: a block event read for one block; another block or session is not it', async () => {
  const id = { session: 'session:s1', block: 'block:b1' };
  const wrap = (name: string, payload: unknown, block = 'block:b1', session = 'session:s1') => ({ type: 'session_event', payload: { session_id: session, event: { type: 'block_event', payload: { block_id: block, creator_name: 'com.superlogical.terminal', name, payload } } } });
  assert.deepEqual(rexEvent(wrap('program_status_changed', { id: '', record: { state: 'working' }, reason: 'report' }), id)?.kind, 'status');
  assert.equal((rexEvent(wrap('program_status_changed', { record: { state: 'blocked', kind: 'auth' } }), id) as { status: { kind: string } }).status.kind, 'auth');
  assert.deepEqual(rexEvent(wrap('child_exited', { exit_code: 2, error: 'exit status 2' }), id), { kind: 'exited', code: 2 });
  assert.equal(rexEvent(wrap('program_status_changed', { record: { state: 'working' } }, 'block:other'), id), null);
  assert.equal(rexEvent(wrap('program_status_changed', { record: { state: 'working' } }, 'block:b1', 'session:other'), id), null);
  assert.equal(rexEvent(wrap('title_changed', { title: 'x' }), id), null);
  assert.equal(rexEvent({ type: 'session_created', payload: {} }, id), null);
  // the stream: the fake prints two lines and exits; both arrive, then the stop is harmless
  const got: string[] = [];
  const stop = rex.follow(id, (e) => got.push(e.kind === 'status' ? `${e.status.state}/${e.status.kind}` : `exited/${e.code}`), withRex);
  await new Promise((r) => setTimeout(r, 400));
  stop();
  assert.deepEqual(got, ['blocked/permission', 'exited/0']);
});

test('cmux: no program status at 0.62, the label as a sidebar pill, send with Enter, open by select-workspace, launch by new-workspace', () => {
  fs.writeFileSync(calls, '');
  const id = { session: 'workspace:3', block: 'surface:7' };
  assert.equal(cmux.status(id, withCmux), null);
  assert.ok(cmux.label(id, 'Rex adapter · 1/7', withCmux));
  assert.ok(cmux.send(id, 'carry on', withCmux));
  assert.ok(cmux.open(id, withCmux));
  assert.deepEqual(cmux.launch({ cwd: '/tmp/w', name: 'rex-adapter', command: ['claude', '--worktree', 'rex-adapter'] }, withCmux), { session: 'workspace:9' });
  assert.deepEqual(seen(), [
    'cmux set-status pjman Rex adapter · 1/7 --icon point.3.connected.trianglepath.dotted --workspace workspace:3',
    'cmux send --workspace workspace:3 --surface surface:7 -- carry on', // the Enter it carries is the line break the fake's log splits on
    'cmux select-workspace --workspace workspace:3',
    'cmux new-workspace --cwd /tmp/w --command claude --worktree rex-adapter',
    'cmux rename-workspace --workspace workspace:9 -- rex-adapter',
  ]);
  const stop = cmux.follow(id, () => assert.fail('cmux streams nothing at 0.62'), withCmux);
  stop();
});

// --- the record -------------------------------------------------------------------------------------------------------

let store: Store;
before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'web' });
  store = findStore(dir)!;
});

test('a session started inside Rex records its host, version and validation; a start outside leaves it; --no-host refuses it', () => {
  const start = (id: string, env: NodeJS.ProcessEnv, ...more: string[]) =>
    execFileSync(process.execPath, [BIN, 'session', 'start', id, '--agent', 'agent:claude-code', '--on-behalf-of', 'person:tester', '--log', 'session started', ...more], { cwd: store.projectDir, encoding: 'utf8', env: { ...env, PJMAN_HOME: process.env.PJMAN_HOME } });
  start('in-rex', withRex);
  let rec = findSession(loadStore(store), 'in-rex')!;
  assert.deepEqual(rec.data.host, { name: 'rex', session: 'session:s1', block: 'block:b1', version: '0.3.1', validated: true });
  assert.match(rec.body, /runs in rex 0\.3\.1\n/);
  // the host is a known field of a session: validate neither errs nor warns on it (change:host-field-unknown)
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error' || /host/.test(p.message)), []);
  // a resume in the same terminal: the host is already there, written once
  start('in-rex', withRex, '--log', 'session resumed');
  rec = findSession(loadStore(store), 'in-rex')!;
  assert.equal(rec.body.match(/runs in rex/g)?.length, 1);
  // outside any host: no field, nothing said
  start('outside', none);
  rec = findSession(loadStore(store), 'outside')!;
  assert.equal(rec.data.host, undefined);
  assert.ok(!/runs in/.test(rec.body));
  // inside cmux, with --no-host: refused
  start('refused', withCmux, '--no-host');
  assert.equal(findSession(loadStore(store), 'refused')!.data.host, undefined);
  // the record's host read back through the registry
  const h = hostOfRecord(findSession(loadStore(store), 'in-rex')!.data);
  assert.equal(h?.adapter, rex);
  assert.deepEqual(h?.id, { session: 'session:s1', block: 'block:b1' });
  assert.equal(hostOfRecord({ host: { name: 'unknown-host', session: 'x' } }), null, 'a host no adapter serves');
});

test('a host whose version the adapter has not validated is recorded as such, and the log says so', () => {
  const env = { ...withRex, PATH: `${path.join(tmp, 'old')}:${none.PATH}` };
  fs.mkdirSync(path.join(tmp, 'old'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'old', 'rex'), `#!/bin/sh\ncase "$1 $2" in "version --json") echo '{"version":"1.4.0"}';; *) exit 1;; esac\n`, { mode: 0o755 });
  execFileSync(process.execPath, [BIN, 'session', 'start', 'on-new-rex', '--agent', 'agent:claude-code', '--on-behalf-of', 'person:tester'], { cwd: store.projectDir, encoding: 'utf8', env: { ...env, PJMAN_HOME: process.env.PJMAN_HOME } });
  const rec = findSession(loadStore(store), 'on-new-rex')!;
  assert.deepEqual(rec.data.host, { name: 'rex', session: 'session:s1', block: 'block:b1', version: '1.4.0', validated: false });
  assert.match(rec.body, /runs in rex 1\.4\.0 \(a version the adapter has not validated\)/);
  assert.deepEqual(validate(loadStore(store)).filter((p) => p.level === 'error'), []);
});

test('the label: the change and where the work stands, written onto the block through the host (pjman host label)', () => {
  const run = (...args: string[]) => execFileSync(process.execPath, [BIN, ...args], { cwd: store.projectDir, encoding: 'utf8', env: { ...withRex, PJMAN_HOME: process.env.PJMAN_HOME } }).trim();
  change(store, 'rex-adapter', { title: 'Rex adapter', summary: 'A host interface.' });
  step(store, 'change:rex-adapter', 'add', undefined, { texts: ['The interface', 'Bind', 'State'] });
  step(store, 'change:rex-adapter', 'done', 1);
  fs.writeFileSync(calls, '');
  // a session on no change carries the tool's name
  assert.equal(run('host', 'label', 'in-rex'), 'rex: labelled "pjman"');
  sessionBind(store, 'in-rex', 'change:rex-adapter', 'by hand');
  assert.equal(run('host', 'label', 'in-rex'), 'rex: labelled "Rex adapter · 2/3"');
  // a decision proposed on the change comes first: it waits on the person
  decisionRec(store, 'rex-adapter/adapter-versioning', { title: 'How adapters are versioned', name: 'Adapter versioning' });
  assert.equal(run('host', 'label', 'in-rex'), 'rex: labelled "Rex adapter · waits: Adapter versioning"');
  assert.equal(run('host', 'label', 'in-rex', '--clear'), 'rex: label cleared');
  assert.deepEqual(seen().filter((l) => l.startsWith('rex block rename')), [
    'rex block rename -s session:s1 block:b1 pjman',
    'rex block rename -s session:s1 block:b1 Rex adapter · 2/3',
    'rex block rename -s session:s1 block:b1 Rex adapter · waits: Adapter versioning',
    'rex block rename -s session:s1 block:b1 pjman',
  ]);
  // the other verbs, and a session in no host
  assert.equal(run('host', 'send', 'in-rex', 'carry on'), 'rex: sent');
  assert.equal(run('host', 'open', 'in-rex'), 'rex: opened');
  assert.equal(run('host', 'status', 'in-rex'), 'rex: blocked (question) — Q');
  assert.equal(run('host'), 'rex 0.3.1: validated; interface 1');
  // a session launched for the change: the harness in its worktree, from the project's directory, named for it
  fs.writeFileSync(calls, '');
  assert.match(run('host', 'launch', 'rex-adapter'), /^rex: session session:new1 launched for change:.*rex-adapter in .* \(claude --worktree rex-adapter\)$/);
  assert.deepEqual(seen(), ['rex version --json', `rex new rex-adapter -c ${store.projectDir} --json -- claude --worktree rex-adapter`, 'rex block ls -s session:new1 --json']); // the host present is told by its version first
  assert.throws(() => run('host', 'launch', 'no-such-change'), /no-such-change/);
  assert.throws(() => run('host', 'label', 'outside'), /runs in no host the tool knows/);
});
