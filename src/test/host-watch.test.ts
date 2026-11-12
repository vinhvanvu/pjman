// A session's state from its host (change:rex-adapter): the rule, the watch over a fake adapter, and the server handing
// what the host says to the bridge and the stream.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { sessionBind, sessionStart } from '../ops/session.js';
import { findStore, type Store } from '../store/config.js';
import { HostWatch } from '../hosts/host-watch.js';
import type { HostAdapter, HostEvent, HostStatus } from '../hosts/host.js';
import { startServer } from '../server/server.js';
import { sessionState } from '../model/session-state.js';
import { change, decisionRec } from './shape.js';

const at = (m: number) => new Date(Date.UTC(2026, 10, 10, 12, m)).toISOString();
const NOW = Date.UTC(2026, 10, 10, 12, 40);

test('the host decides: blocked waits, working works, at rest waits only on a proposed decision; ended stays ended', () => {
  const quiet = { ended: false, line: at(0), act: at(0), proposed: false }; // 40 minutes of silence: stopped by the record alone
  assert.equal(sessionState(quiet, NOW), 'stopped');
  assert.equal(sessionState({ ...quiet, host: { state: 'working', at: at(39) } }, NOW), 'working');
  assert.equal(sessionState({ ...quiet, host: { state: 'blocked', kind: 'question', at: at(39) } }, NOW), 'waiting');
  assert.equal(sessionState({ ...quiet, host: { state: 'blocked', kind: 'permission', at: at(39) } }, NOW), 'waiting');
  assert.equal(sessionState({ ...quiet, host: { state: 'idle', at: at(39) } }, NOW), 'stopped');
  assert.equal(sessionState({ ...quiet, host: { state: 'done', at: at(39) }, proposed: true }, NOW), 'waiting');
  assert.equal(sessionState({ ...quiet, host: { state: 'error', at: at(39) } }, NOW), 'stopped');
  // a record that reads working by the silence rule but whose host says idle: the host is first-hand
  const busy = { ended: false, line: at(30), act: at(39), proposed: false };
  assert.equal(sessionState(busy, NOW), 'working');
  assert.equal(sessionState({ ...busy, host: { state: 'idle', at: at(39) } }, NOW), 'stopped');
  assert.equal(sessionState({ ...busy, ended: true, host: { state: 'working', at: at(39) } }, NOW), 'ended');
});

/** A fake adapter: the status it answers, and the events its stream delivers, under the test's control. */
function fakeAdapter(name: string): {
  adapter: HostAdapter;
  answer: (s: HostStatus | null) => void;
  emit: (e: HostEvent) => void;
  followed: string[];
  stopped: string[];
} {
  let status: HostStatus | null = null;
  const listeners = new Map<string, (e: HostEvent) => void>();
  const followed: string[] = [];
  const stopped: string[] = [];
  const adapter: HostAdapter = {
    manifest: { environment: name, interface: 1, validated: '>=0 <1', command: name },
    identify: () => null,
    version: () => '0.0.1',
    status: () => status,
    label: () => true,
    send: () => true,
    open: () => true,
    launch: () => null,
    follow: (id, fn) => {
      followed.push(id.session);
      listeners.set(id.session, fn);
      return () => {
        stopped.push(id.session);
        listeners.delete(id.session);
      };
    },
  };
  return { adapter, answer: (s) => (status = s), emit: (e) => listeners.forEach((fn) => fn(e)), followed, stopped };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

test('the watch follows a session on its host, polls until the stream speaks, says when the state changed, and lets go', async () => {
  const fake = fakeAdapter('fake');
  const changes: string[] = [];
  const watch = new HostWatch({
    pollMs: 20,
    onChange: (key, s) => changes.push(`${key}=${s?.state ?? '-'}${s?.kind ? `/${s.kind}` : ''}`),
  });
  fake.answer({ state: 'working', at: at(1) });
  watch.track('session:a', fake.adapter, { session: 'host-a', block: 'b' });
  await tick();
  assert.deepEqual(fake.followed, ['host-a']);
  assert.equal(watch.status('session:a')?.state, 'working');
  assert.deepEqual(changes, ['session:a=working']);
  // the poll reads the status again while nothing streamed; the same state is no change
  fake.answer({ state: 'idle', at: at(2) });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(watch.status('session:a')?.state, 'idle');
  assert.deepEqual(changes, ['session:a=working', 'session:a=idle']);
  // once the stream speaks, it is the word; the poll no longer overrides it
  fake.emit({ kind: 'status', status: { state: 'blocked', kind: 'question', at: at(3) } });
  fake.answer({ state: 'working', at: at(4) });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(watch.status('session:a')?.kind, 'question');
  assert.deepEqual(changes.at(-1), 'session:a=blocked/question');
  // the process exiting reads as done
  fake.emit({ kind: 'exited', code: 0 });
  assert.equal(watch.status('session:a')?.state, 'done');
  assert.deepEqual([...watch.states().keys()], ['session:a']);
  // keep: the ones named stay, the rest are let go
  watch.keep([{ key: 'session:b', adapter: fake.adapter, id: { session: 'host-b' } }]);
  assert.deepEqual(fake.stopped, ['host-a']);
  assert.ok(watch.has('session:b') && !watch.has('session:a'));
  watch.close();
  assert.deepEqual(fake.stopped, ['host-a', 'host-b']);
});

// --- the server ---------------------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-host-watch-'));
const project = path.join(tmp, 'project');
const fakes = path.join(tmp, 'bin');
let store: Store;
let server: http.Server;
let base = '';
const savedPath = process.env.PATH;

before(async () => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_STORE;
  fs.mkdirSync(fakes, { recursive: true });
  // a rex whose program is blocked on a question, and whose stream says so once then stays open a while
  fs.writeFileSync(
    path.join(fakes, 'rex'),
    `#!/bin/sh
case "$1 $2" in
  "version --json") echo '{"version":"0.3.1"}';;
  "block call") echo '[{"state":"blocked","kind":"question","app":"claude-code"}]';;
  "focus -s") echo "focused $*" >> '${tmp}/rex-focus';;
  "send -s") printf '%s\n' "sent $*" >> '${tmp}/rex-send';;
  "new login") echo "launched $*" >> '${tmp}/rex-new'; echo '{"session_id":"session:new9"}';;
  "block ls") echo '[{"block_id":"block:b9"}]';;
  "events -s") echo '{"type":"session_event","payload":{"session_id":"session:s1","event":{"type":"block_event","payload":{"block_id":"block:b1","creator_name":"com.superlogical.terminal","name":"program_status_changed","payload":{"record":{"state":"blocked","kind":"question"}}}}}}'; sleep 5;;
  *) exit 1;;
esac
`,
    { mode: 0o755 },
  );
  process.env.PATH = `${fakes}:${savedPath ?? ''}`;
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
  change(store, 'login', { title: 'Login', summary: 'Sign in.' });
  // a session that ran in Rex, bound to the change, quiet for an hour by the record: stopped by the record alone
  sessionStart(store, 'in-rex', {
    agent: 'agent:claude-code',
    onBehalfOf: 'person:tester',
    log: 'session started',
    host: { name: 'rex', session: 'session:s1', block: 'block:b1', version: '0.3.1', validated: true },
  });
  // one outside any host, for contrast
  newRecord(store, 'session', 'plain', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  const ui = path.join(tmp, 'ui');
  fs.mkdirSync(ui);
  fs.writeFileSync(path.join(ui, 'index.html'), '<html></html>');
  const started = await startServer(store, { staticDir: ui, register: false });
  server = started.server;
  base = `${started.address.url}/api/v1`;
});

after(() => {
  server?.close();
  process.env.PATH = savedPath;
});

test('the server hands what the host says to the bridge: a session blocked on a question waits, and the stream carries a host frame', async () => {
  await new Promise((r) => setTimeout(r, 900)); // the sweep after the first event, then the stream's first line
  const res = await fetch(`${base}/products/app/bridge?days=1`);
  const body = (await res.json()) as {
    data: {
      sessions: { key: string; state: string; host?: { name: string; status?: { state: string; kind?: string } } }[];
    };
  };
  const row = body.data.sessions.find((s) => s.key === 'session:in-rex');
  assert.ok(row, 'the hosted session is on the bridge');
  assert.equal(row.state, 'waiting');
  assert.equal(row.host?.name, 'rex');
  assert.equal(row.host?.status?.state, 'blocked');
  assert.equal(row.host?.status?.kind, 'question');
  const plain = body.data.sessions.find((s) => s.key === 'session:plain');
  assert.equal(plain?.host, undefined);
  // the session page carries it too
  const view = (await (await fetch(`${base}/sessions/in-rex/view`)).json()) as {
    data: { session: { host?: { status?: { kind?: string } }; working: boolean } };
  };
  assert.equal(view.data.session.host?.status?.kind, 'question');
  assert.equal(view.data.session.working, false);
});

test('a host frame reaches an open stream when the host speaks', async () => {
  // a fresh watch starts on a new session: its first status is a change, which the stream carries as `event: host`
  const ctl = new AbortController();
  const res = await fetch(`${base}/events?stream=1`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = (pred: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`no host frame; saw:\n${seen}`)), 6000);
      const pump = (): void => {
        void reader.read().then(({ value, done }) => {
          if (done) return;
          seen += decoder.decode(value);
          if (pred()) {
            clearTimeout(deadline);
            resolve();
          } else pump();
        }, reject);
      };
      pump();
    });
  sessionStart(store, 'in-rex-2', {
    agent: 'agent:claude-code',
    onBehalfOf: 'person:tester',
    log: 'session started',
    host: { name: 'rex', session: 'session:s1', block: 'block:b1' },
  });
  await until(() => /event: host\ndata: \{[^\n]*"key":"session:in-rex-2"[^\n]*"state":"blocked"/.test(seen));
  ctl.abort();
});

test("POST /open asks the host to bring the session's block to the front; a session in no host is refused", async () => {
  const post = (body: unknown) =>
    fetch(`${base}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const ok = await post({ session: 'session:in-rex' });
  assert.equal(ok.status, 200);
  const r = (await ok.json()) as { data: { did: string; ok: boolean; host: { name: string } } };
  assert.equal(r.data.did, 'open');
  assert.equal(r.data.ok, true);
  assert.equal(r.data.host.name, 'rex');
  assert.match(fs.readFileSync(path.join(tmp, 'rex-focus'), 'utf8'), /focused focus -s session:s1 block:b1/);
  const no = await post({ session: 'session:plain' });
  assert.equal(no.status, 400);
  assert.match(((await no.json()) as { error: { message: string } }).error.message, /runs in no host/);
  assert.equal((await post({})).status, 400);
});

test('POST /launch opens a session for a change on the host this machine runs; the store says which host that is', async () => {
  const info = (await (await fetch(`${base}/store`)).json()) as {
    data: { host: { name: string; version: string | null; validated: boolean | null } | null };
  };
  assert.deepEqual(info.data.host, { name: 'rex', version: '0.3.1', validated: true, interface: 1, range: '>=0.1 <1' });
  const res = await fetch(`${base}/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ change: 'change:login' }),
  });
  assert.equal(res.status, 200);
  const r = (await res.json()) as {
    data: { host: string; id: { session: string; block?: string }; command: string[] };
  };
  assert.equal(r.data.host, 'rex');
  assert.deepEqual(r.data.id, { session: 'session:new9', block: 'block:b9' });
  assert.deepEqual(r.data.command, ['claude', '--worktree', 'login']);
  assert.match(
    fs.readFileSync(path.join(tmp, 'rex-new'), 'utf8'),
    new RegExp(`launched new login -c ${store.projectDir} --json -- claude --worktree login`),
  );
  assert.equal(
    (
      await fetch(`${base}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).status,
    400,
  );
});

test('an acceptance is delivered through the host to the sessions on the change whose agent has no waking adapter; a Claude Code session hears it from its wake module instead', async () => {
  // a Codex session in Rex on the change, beside the Claude Code one already there (in-rex, bound to nothing yet)
  sessionStart(store, 'codex-in-rex', {
    agent: 'agent:codex',
    onBehalfOf: 'person:tester',
    log: 'session started',
    host: { name: 'rex', session: 'session:s2', block: 'block:b2' },
  });
  sessionBind(store, 'codex-in-rex', 'change:login', 'by hand');
  sessionBind(store, 'in-rex', 'change:login', 'by hand');
  decisionRec(store, 'login/passwordless', { title: 'Passwordless or not', name: 'Passwordless' });
  const res = await fetch(`${base}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'decision:login/passwordless', words: 'yes, links' }),
  });
  assert.equal(res.status, 200);
  const r = (await res.json()) as {
    data: { status: string; delivered?: { session: string; host: string; ok: boolean }[] };
  };
  assert.equal(r.data.status, 'decided');
  assert.deepEqual(r.data.delivered, [{ session: 'session:codex-in-rex', host: 'rex', ok: true }]);
  const sent = fs.readFileSync(path.join(tmp, 'rex-send'), 'utf8');
  assert.match(
    sent,
    /^sent send -s session:s2 -b block:b2 pjman: decision:[^ ]*login\/passwordless decided by person:\S+: it — yes, links\. Read pjman context change:[^ ]*login and act on it as the record now says\.\r$/m,
  );
  assert.ok(!/session:s1/.test(sent), 'the Claude Code session is left to its wake module');
});
