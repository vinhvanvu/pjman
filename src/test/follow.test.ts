// The follow window (change:follow-window): the session followed, the windows counted, one opener at a time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { init } from '../commands/init.js';
import { sessionStart } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { CLAIM_MS, FollowState, RECONNECT_MS, type Followed } from '../follow.js';
import { startServer } from '../server.js';

test('one caller opens a window: the next waits on its claim, a connected window answers all, a closed one lets the next open', () => {
  const t0 = 1_000_000;
  const f = new FollowState(() => {}, t0);
  assert.equal(f.waitFor(t0), RECONNECT_MS);
  assert.equal(f.waitFor(t0 + RECONNECT_MS + 1), 0);
  const now = t0 + RECONNECT_MS;
  assert.deepEqual(f.ensure(now), { open: true, windows: 0 });
  assert.deepEqual(f.ensure(now + 10), { open: false, reason: 'opening', windows: 0 });
  // the page loads and connects
  f.connected();
  assert.deepEqual(f.ensure(now + 20), { open: false, reason: 'open', windows: 1 });
  f.disconnected();
  assert.deepEqual(f.ensure(now + 30), { open: true, windows: 0 });
  // a claim whose page never connected lapses
  assert.deepEqual(f.ensure(now + 30 + CLAIM_MS + 1), { open: true, windows: 0 });
});

test('the followed session moves on a prompt into another session; the same session again sends nothing', () => {
  const seen: Followed[] = [];
  const f = new FollowState((x) => seen.push(x));
  assert.equal(f.get(), null);
  f.set('session:a', 'prompt', Date.UTC(2026, 10, 11));
  f.set('session:a', 'prompt', Date.UTC(2026, 10, 11, 0, 1));
  f.set('session:b');
  assert.deepEqual(seen.map((x) => x.session), ['session:a', 'session:b']);
  assert.equal(f.get()?.session, 'session:b');
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-follow-'));
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
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
  sessionStart(store, 'one', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', log: 'session started' });
  sessionStart(store, 'two', { agent: 'agent:claude-code', onBehalfOf: 'person:tester', log: 'session started' });
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

const post = (route: string, body: unknown = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** An open stream and a way to wait for what it says. */
async function stream(route: string) {
  const ctl = new AbortController();
  const res = await fetch(`${base}${route}?stream=1`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  const until = (pred: (s: string) => boolean) => new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`not seen; saw:\n${seen}`)), 4000);
    const pump = (): void => {
      if (pred(seen)) {
        clearTimeout(deadline);
        return resolve();
      }
      void reader.read().then(({ value, done }) => {
        if (done) return;
        seen += decoder.decode(value);
        pump();
      }, () => {});
    };
    pump();
  });
  return { until, close: () => ctl.abort() };
}

test('a prompt moves the follow windows to the session; a window is counted, and told at once on connecting', async () => {
  const page = await stream('/follow');
  assert.equal((await post('/follow', { session: 'one' })).status, 200);
  await page.until((s) => /event: follow\ndata: \{[^\n]*"key":"session:one"/.test(s));
  assert.equal((await post('/follow', { session: 'nobody' })).status, 404);
  assert.equal((await post('/follow', {})).status, 400);
  page.close();
  await new Promise((r) => setTimeout(r, 100));
  const win = await stream('/follow');
  await win.until((s) => /event: follow\ndata: \{[^\n]*"key":"session:one"/.test(s));
  const got = (await (await fetch(`${base}/follow`)).json()) as { data: { followed: Followed; windows: number } };
  assert.equal(got.data.followed.session, 'session:one');
  assert.equal(got.data.windows, 1);
  await post('/follow', { session: 'session:two' });
  await win.until((s) => s.includes('"key":"session:two"'));
  win.close();
});

test('ensure: while a window is open nobody opens one; once it closes one caller is told to, the next is not', async () => {
  const win = await stream('/follow');
  await new Promise((r) => setTimeout(r, 100));
  const ensure = async () => ((await (await post('/follow/ensure')).json()) as { data: { open: boolean; reason?: string } }).data;
  // a server just started answers after a window that was open has had its reconnect
  assert.deepEqual(await ensure(), { open: false, reason: 'open', windows: 1 });
  win.close();
  await new Promise((r) => setTimeout(r, 100));
  const [a, b] = await Promise.all([ensure(), ensure()]);
  assert.deepEqual([a.open, b.open].sort(), [false, true]);
  assert.equal((a.open ? b : a).reason, 'opening');
});
