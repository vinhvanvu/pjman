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
import { cmux, detectHost, hostOfRecord, hostPresent, inRange, sessionHost, versionIn } from '../hosts/host.js';
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

fs.writeFileSync(
  path.join(fakes, 'cmux'),
  `#!/bin/sh
echo "cmux $*" >> '${calls}'
case "$1" in
  --version) echo "cmux 0.62.2 (77) [6c203b514]";;
  set-status|clear-status|send|select-workspace|rename-workspace) echo "OK";;
  new-workspace) echo "OK workspace:9";;
  *) exit 1;;
esac
`,
  { mode: 0o755 },
);
const seen = () => fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CMUX_')));
const withCmux = {
  ...clean(),
  PATH: `${fakes}:${process.env.PATH ?? ''}`,
  CMUX_WORKSPACE_ID: 'workspace:3',
  CMUX_SURFACE_ID: 'surface:7',
  CMUX_BUNDLE_ID: 'com.cmuxterm.app',
};
// no host command anywhere on the PATH, the system's own tools still at hand
const none = { ...clean(), PATH: `${path.join(tmp, 'empty')}:/usr/bin:/bin` };
fs.mkdirSync(path.join(tmp, 'empty'), { recursive: true });

test('versions and ranges: the first semver in a text, and a range written as bounds', () => {
  assert.equal(versionIn('cmux 0.62.2 (77) [6c203b514]'), '0.62.2');
  assert.equal(versionIn('cmux 0.3.1-beta.2'), '0.3.1-beta.2');
  assert.equal(versionIn('no version here'), null);
  assert.ok(inRange('0.3.1', '>=0.1 <1'));
  assert.ok(!inRange('1.0.0', '>=0.1 <1'));
  assert.ok(!inRange('0.0.9', '>=0.1 <1'));
  assert.ok(inRange('0.62.2', '>=0.62 <1'));
  assert.ok(inRange('0.3.1-beta.2', '>=0.3 <0.4'), 'a pre-release tag is read by its numbers');
  assert.ok(!inRange('junk', '>=0.1'));
});

test('detection reads the environment: cmux by CMUX_WORKSPACE_ID, nothing outside it', () => {
  assert.deepEqual(detectHost(withCmux)?.id, { session: 'workspace:3', block: 'surface:7' });
  assert.equal(detectHost(withCmux)?.adapter, cmux);
  assert.equal(detectHost(none), null);
  assert.equal(
    detectHost({ ...none, CMUX_WORKSPACE_ID: 'workspace:x' })?.id.block,
    undefined,
    'a session with no block still identifies',
  );
});

test('what the session record carries: the ids, the version by the host command, and whether the adapter validated it', () => {
  assert.deepEqual(sessionHost(withCmux), {
    name: 'cmux',
    session: 'workspace:3',
    block: 'surface:7',
    version: '0.62.2',
    validated: true,
  });
  assert.equal(sessionHost(none), null);
  // the host present but its command gone: the ids still, no version, validated unknown
  const h = sessionHost({ ...withCmux, PATH: none.PATH });
  assert.deepEqual(h, {
    name: 'cmux',
    session: 'workspace:3',
    block: 'surface:7',
    version: undefined,
    validated: undefined,
  });
  assert.equal(hostPresent(withCmux)?.adapter, cmux, 'the first host whose command answers');
  assert.equal(hostPresent(none), null);
});

test('cmux: no program status at 0.62, the label as a sidebar pill, send with Enter, open by select-workspace, launch by new-workspace', () => {
  fs.writeFileSync(calls, '');
  const id = { session: 'workspace:3', block: 'surface:7' };
  assert.equal(cmux.status(id, withCmux), null);
  assert.ok(cmux.label(id, 'Rex adapter · 1/7', withCmux));
  assert.ok(cmux.send(id, 'carry on', withCmux));
  assert.ok(cmux.open(id, withCmux));
  assert.deepEqual(
    cmux.launch({ cwd: '/tmp/w', name: 'rex-adapter', command: ['claude', '--worktree', 'rex-adapter'] }, withCmux),
    { session: 'workspace:9' },
  );
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
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
});

test('a session started inside cmux records its host, version and validation; a start outside leaves it; --no-host refuses it', () => {
  const start = (id: string, env: NodeJS.ProcessEnv, ...more: string[]) =>
    execFileSync(
      process.execPath,
      [BIN, 'session', 'start', id, '--agent', 'agent:claude-code', '--log', 'session started', ...more],
      { cwd: store.projectDir, encoding: 'utf8', env: { ...env, PJMAN_HOME: process.env.PJMAN_HOME } },
    );
  start('in-host', withCmux);
  let rec = findSession(loadStore(store), 'in-host')!;
  assert.deepEqual(rec.data.host, {
    name: 'cmux',
    session: 'workspace:3',
    block: 'surface:7',
    version: '0.62.2',
    validated: true,
  });
  assert.match(rec.body, /runs in cmux 0\.62\.2\n/);
  // the host is a known field of a session: validate neither errs nor warns on it (change:host-field-unknown)
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error' || /host/.test(p.message)),
    [],
  );
  // a resume in the same terminal: the host is already there, written once
  start('in-host', withCmux, '--log', 'session resumed');
  rec = findSession(loadStore(store), 'in-host')!;
  assert.equal(rec.body.match(/runs in cmux/g)?.length, 1);
  // outside any host: no field, nothing said
  start('outside', none);
  rec = findSession(loadStore(store), 'outside')!;
  assert.equal(rec.data.host, undefined);
  assert.ok(!/runs in/.test(rec.body));
  // inside cmux, with --no-host: refused
  start('refused', withCmux, '--no-host');
  assert.equal(findSession(loadStore(store), 'refused')!.data.host, undefined);
  // the record's host read back through the registry
  const h = hostOfRecord(findSession(loadStore(store), 'in-host')!.data);
  assert.equal(h?.adapter, cmux);
  assert.deepEqual(h?.id, { session: 'workspace:3', block: 'surface:7' });
  assert.equal(hostOfRecord({ host: { name: 'unknown-host', session: 'x' } }), null, 'a host no adapter serves');
});

test('a host whose version the adapter has not validated is recorded as such, and the log says so', () => {
  const env = { ...withCmux, PATH: `${path.join(tmp, 'old')}:${none.PATH}` };
  fs.mkdirSync(path.join(tmp, 'old'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'old', 'cmux'),
    `#!/bin/sh\ncase "$1" in --version) echo "cmux 1.4.0";; *) exit 1;; esac\n`,
    { mode: 0o755 },
  );
  execFileSync(process.execPath, [BIN, 'session', 'start', 'on-new-host', '--agent', 'agent:claude-code'], {
    cwd: store.projectDir,
    encoding: 'utf8',
    env: { ...env, PJMAN_HOME: process.env.PJMAN_HOME },
  });
  const rec = findSession(loadStore(store), 'on-new-host')!;
  assert.deepEqual(rec.data.host, {
    name: 'cmux',
    session: 'workspace:3',
    block: 'surface:7',
    version: '1.4.0',
    validated: false,
  });
  assert.match(rec.body, /runs in cmux 1\.4\.0 \(a version the adapter has not validated\)/);
  assert.deepEqual(
    validate(loadStore(store)).filter((p) => p.level === 'error'),
    [],
  );
});

test('the label: the change and where the work stands, written onto the workspace through the host (pjman host label)', () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [BIN, ...args], {
      cwd: store.projectDir,
      encoding: 'utf8',
      env: { ...withCmux, PJMAN_HOME: process.env.PJMAN_HOME },
    }).trim();
  change(store, 'host-adapter', { title: 'Host adapter', summary: 'A host interface.' });
  step(store, 'change:host-adapter', 'add', undefined, { texts: ['The interface', 'Bind', 'State'] });
  step(store, 'change:host-adapter', 'done', 1);
  fs.writeFileSync(calls, '');
  // a session on no change carries the tool's name
  assert.equal(run('host', 'label', 'in-host'), 'cmux: labelled "pjman"');
  sessionBind(store, 'in-host', 'change:host-adapter', 'by hand');
  assert.equal(run('host', 'label', 'in-host'), 'cmux: labelled "Host adapter · 2/3"');
  // a decision proposed on the change comes first: it waits on the person
  decisionRec(store, 'host-adapter/adapter-versioning', {
    title: 'How adapters are versioned',
    name: 'Adapter versioning',
  });
  assert.equal(run('host', 'label', 'in-host'), 'cmux: labelled "Host adapter · waits: Adapter versioning"');
  assert.equal(run('host', 'label', 'in-host', '--clear'), 'cmux: label cleared');
  assert.deepEqual(
    seen().filter((l) => /^cmux (set|clear)-status/.test(l)),
    [
      'cmux set-status pjman pjman --icon point.3.connected.trianglepath.dotted --workspace workspace:3',
      'cmux set-status pjman Host adapter · 2/3 --icon point.3.connected.trianglepath.dotted --workspace workspace:3',
      'cmux set-status pjman Host adapter · waits: Adapter versioning --icon point.3.connected.trianglepath.dotted --workspace workspace:3',
      'cmux clear-status pjman --workspace workspace:3',
    ],
  );
  // the other verbs, and a session in no host
  assert.equal(run('host', 'send', 'in-host', 'carry on'), 'cmux: sent');
  assert.equal(run('host', 'open', 'in-host'), 'cmux: opened');
  assert.equal(run('host', 'status', 'in-host'), 'cmux: no program status');
  assert.equal(run('host'), 'cmux 0.62.2: validated; interface 1');
  // a session launched for the change: the harness in its worktree, from the project's directory, named for it
  fs.writeFileSync(calls, '');
  assert.match(
    run('host', 'launch', 'host-adapter'),
    /^cmux: session workspace:9 launched for change:.*host-adapter in .* \(claude --worktree host-adapter\)$/,
  );
  assert.deepEqual(seen(), [
    'cmux --version',
    `cmux new-workspace --cwd ${store.projectDir} --command claude --worktree host-adapter`,
    'cmux rename-workspace --workspace workspace:9 -- host-adapter',
  ]); // the host present is told by its version first
  assert.throws(() => run('host', 'launch', 'no-such-change'), /no-such-change/);
  assert.throws(() => run('host', 'label', 'outside'), /runs in no host the tool knows/);
});
