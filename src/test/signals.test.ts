// The live signals the dock reads beside the record: what a session's agent is doing now, and when the person last
// prompted it. Both are held in the server's memory and never written to the store.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { init } from '../cli/init.js';
import { sessionStart } from '../ops/session.js';
import { findStore, type Store } from '../store/config.js';
import { startServer } from '../server/server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-signals-'));
let store: Store;
let server: http.Server | undefined;
let base = '';

before(async () => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const project = path.join(tmp, 'app');
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ cwd: project, name: 'app' });
  store = findStore(project)!;
  sessionStart(store, 'one', { agent: 'agent:claude-code', log: 'session started' });
  sessionStart(store, 'two', { agent: 'agent:claude-code', log: 'session started' });
  const ui = path.join(tmp, 'ui');
  fs.mkdirSync(ui);
  fs.writeFileSync(path.join(ui, 'index.html'), '<html></html>');
  const started = await startServer(store, { staticDir: ui, register: false });
  server = started.server;
  base = `${started.address.url}/api/v1`;
});

after(() => {
  server?.close();
});

const post = (route: string, body: unknown = {}) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** An open stream and a way to wait for what it says. */
async function stream(route: string) {
  const ctl = new AbortController();
  const res = await fetch(`${base}${route}?stream=1`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = (pred: (s: string) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`not seen; saw:\n${seen}`)), 4000);
      const pump = (): void => {
        if (pred(seen)) {
          clearTimeout(deadline);
          return resolve();
        }
        void reader.read().then(
          ({ value, done }) => {
            if (done) return;
            seen += decoder.decode(value);
            pump();
          },
          () => {},
        );
      };
      pump();
    });
  return { until, close: () => ctl.abort() };
}

test("now: a session's latest action is held in memory, sent on the stream and to a stream that opens; no text clears it (decision dock-redesign/agent-signal)", async () => {
  const events = path.join(store.root, 'events.jsonl');
  const written = fs.existsSync(events) ? fs.readFileSync(events, 'utf8') : '';
  const page = await stream('/events');
  assert.equal((await post('/now', { session: 'one', text: 'Reading src/a.ts', tool: 'Read' })).status, 200);
  await page.until((s) => /event: now\ndata: \{[^\n]*"key":"session:one"[^\n]*"text":"Reading src\/a.ts"/.test(s));
  page.close();
  assert.equal((await post('/now', {})).status, 400);
  // a page that opens mid-turn reads the action standing now
  const late = await stream('/events');
  await late.until((s) => s.includes('"text":"Reading src/a.ts"'));
  await post('/now', { session: 'session:one' });
  await late.until((s) => /event: now\ndata: \{"op":"now","type":"session","key":"session:one","at":"[^"]+"\}/.test(s));
  late.close();
  // nothing reached the store
  assert.equal(fs.existsSync(events) ? fs.readFileSync(events, 'utf8') : '', written);
});

test("prompted: a prompt is held in memory as the session's last prompt, told to open pages, and read on its page (decision pjman-24/name-the-shown-session)", async () => {
  const events = path.join(store.root, 'events.jsonl');
  const written = fs.existsSync(events) ? fs.readFileSync(events, 'utf8') : '';
  const view = async () =>
    ((await (await fetch(`${base}/sessions/two/view`)).json()) as { data: { session?: { prompted?: string } } }).data
      .session?.prompted;
  const page = await stream('/events');
  const before = Date.now();
  assert.equal((await post('/prompted', { session: 'two' })).status, 200);
  assert.equal((await post('/prompted', { session: 'nobody' })).status, 404);
  assert.equal((await post('/prompted', {})).status, 400);
  await page.until((s) => /event: prompted\ndata: \{[^\n]*"key":"session:two"/.test(s));
  page.close();
  const prompted = await view();
  assert.ok(prompted && Date.parse(prompted) >= before - 1000, `prompted: ${prompted}`);
  // nothing reached the store
  assert.equal(fs.existsSync(events) ? fs.readFileSync(events, 'utf8') : '', written);
});
