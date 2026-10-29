import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { sessionBind, sessionLog } from '../commands/session.js';
import { findStore, type Store } from '../config.js';
import { readServeAddress, startServer } from '../server.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-server-'));
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

let store: Store;
let base = '';
let server: http.Server;

const getJson = async (route: string) => {
  const res = await fetch(base + route);
  return { status: res.status, seq: res.headers.get('x-pjman-seq'), body: (await res.json()) as { seq: number; data?: unknown; error?: { code: string; message: string; tried?: string[] } } };
};

before(async () => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ checkers: [], cwd: project, name: 'app' });
  store = findStore(project)!;
  newRecord(store, 'change', 'login', { title: 'Login', summary: 'Sign in.', binds: ['linear:APP-1'], links: ['file:README.md'] });
  newRecord(store, 'decision', 'login/magic-links', { title: 'Magic links', decision: 'Links.', why: 'No passwords.' });
  newRecord(store, 'session', 'sess-1', { agent: 'agent:claude-code', onBehalfOf: 'person:tester' });
  const ui = path.join(tmp, 'ui');
  fs.mkdirSync(ui);
  fs.writeFileSync(path.join(ui, 'index.html'), '<!doctype html><title>pjman</title>');
  fs.writeFileSync(path.join(ui, 'app.js'), 'console.log(1)');
  const started = await startServer(store, { staticDir: ui, register: true });
  server = started.server;
  base = started.address.url;
});

after(() => server.close());

test('the address file names the running server', () => {
  const a = readServeAddress();
  assert.ok(a);
  assert.equal(a.url, base);
  assert.equal(a.pid, process.pid);
});

test('PORT names the port when none is passed; a checkout does not register unless told to', async () => {
  const before = readServeAddress();
  process.env.PORT = '0';
  const free = await startServer(store, { staticDir: null });
  delete process.env.PORT;
  assert.equal(free.registered, false, 'the tests run from the checkout');
  assert.notEqual(free.address.port, before!.port);
  assert.equal(readServeAddress()?.pid, before!.pid, 'the address file still names the first server');
  free.server.close();
  const srv = http.createServer();
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
  const want = (srv.address() as { port: number }).port;
  srv.close();
  process.env.PORT = String(want);
  const pinned = await startServer(store, { staticDir: null, register: false });
  delete process.env.PORT;
  assert.equal(pinned.address.port, want);
  pinned.server.close();
});

test('records by key, the listing, the store', async () => {
  const one = await getJson('/api/v1/records/change/app/login');
  assert.equal(one.status, 200);
  assert.equal((one.body.data as { key: string }).key, 'change:app/login');
  // the bare form still opens it: the project's product is the scope
  assert.equal(((await getJson('/api/v1/records/change/login')).body.data as { key: string }).key, 'change:app/login');
  assert.equal(String(one.body.seq), one.seq);
  const dec = await getJson('/api/v1/records/decision/app/login/magic-links');
  assert.equal((dec.body.data as { key: string }).key, 'decision:app/login/magic-links');
  const missing = await getJson('/api/v1/records/change/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error?.code, 'not-found');
  const list = await getJson('/api/v1/records?type=change');
  assert.deepEqual((list.body.data as { key: string }[]).map((r) => r.key), ['change:app/login']);
  const s = await getJson('/api/v1/store');
  assert.equal((s.body.data as { name: string }).name, 'global');
  assert.deepEqual((s.body.data as { projects: { key: string }[] }).projects.map((p) => p.key), ['project:app']);
});

test('the getter: a neighbourhood by key, and resolve for anything', async () => {
  const n = await getJson('/api/v1/records/linear/APP-1/neighbourhood');
  assert.equal(n.status, 200);
  assert.deepEqual((n.body.data as { changes: { change: { key: string } }[] }).changes.map((c) => c.change.key), ['change:app/login']);
  const r = await getJson('/api/v1/resolve?ref=' + encodeURIComponent('https://linear.app/acme/issue/APP-1/login'));
  assert.equal((r.body.data as { resolution: { key: string } }).resolution.key, 'linear:APP-1');
  const refs = await getJson('/api/v1/refs?text=' + encodeURIComponent('start APP-1 now'));
  assert.equal(refs.status, 200);
  assert.deepEqual((refs.body.data as { key: string; change?: string }[]).map((r) => [r.key, r.change]), [['linear:APP-1', 'change:app/login']]);
  const none = await getJson('/api/v1/resolve?ref=zzz');
  assert.equal(none.status, 404);
  assert.ok(none.body.error?.tried?.length);
});

test("a session's view and a project's board", async () => {
  type SessionView = { showing: { key?: string; board?: string }; session: { key: string; on?: string; product?: string; state: string; log: { at: string; text: string }[] } };
  sessionLog(store, 'sess-1', 'session started');
  const before = await getJson('/api/v1/sessions/sess-1/view');
  const fresh = before.body.data as SessionView;
  assert.equal(fresh.showing.board, 'project:app');
  // the session's facts ride along: no change yet, the project's product, live since it just wrote, its log
  assert.equal(fresh.session.on, undefined);
  assert.equal(fresh.session.product, 'product:app');
  assert.equal(fresh.session.state, 'live');
  assert.deepEqual(fresh.session.log.map((l) => l.text), ['session started']);
  assert.match(fresh.session.log[0].at, /^\d{4}-\d{2}-\d{2}T/);
  sessionBind(store, 'sess-1', 'change:login');
  sessionLog(store, 'sess-1', 'session ended (other)');
  const after = await getJson('/api/v1/sessions/sess-1/view');
  const bound = after.body.data as SessionView;
  assert.equal(bound.showing.key, 'change:app/login');
  assert.equal(bound.session.on, 'change:app/login');
  assert.equal(bound.session.state, 'ended');
  assert.deepEqual(bound.session.log.map((l) => l.text), ['session started', 'bound change:app/login (by hand)', 'session ended (other)']);
  const board = await getJson('/api/v1/projects/app/board');
  assert.deepEqual((board.body.data as { changes: { key: string }[] }).changes.map((r) => r.key), ['change:app/login']);
});

test('as of a moment: at= answers from the commit of that event, stamped with the moment; events between two points', async () => {
  const events = (await getJson('/api/v1/events')).body.data as { seq: number; at: string; key: string; op: string }[];
  const created = events.find((e) => e.key === 'change:app/login' && e.op === 'created')!;
  const then = await getJson(`/api/v1/records/change/app/login?at=${created.seq}`);
  assert.equal(then.status, 200);
  const stamp = (then.body as { moment?: { seq: number; at: string; commit: string } }).moment;
  assert.equal(stamp?.seq, created.seq);
  assert.equal(stamp?.at, created.at);
  assert.ok(stamp?.commit);
  assert.equal((then.body.data as { key: string }).key, 'change:app/login');
  // the decision did not exist yet at that event
  const noDecision = await getJson(`/api/v1/records/decision/app/login/magic-links?at=${created.seq}`);
  assert.equal(noDecision.status, 404);
  assert.equal((await getJson('/api/v1/records/decision/app/login/magic-links')).status, 200);
  // an instant resolves to the last event at or before it; a nonsense one is a bad request
  const byInstant = await getJson(`/api/v1/scope?lens=feature&at=${encodeURIComponent(created.at)}`);
  assert.equal((byInstant.body as { moment?: { seq: number } }).moment?.seq, created.seq);
  assert.equal((await getJson('/api/v1/scope?lens=feature&at=yesterday')).status, 400);
  const between = (await getJson(`/api/v1/events?since=${created.seq - 1}&until=${created.seq}`)).body.data as { seq: number }[];
  assert.deepEqual(between.map((e) => e.seq), [created.seq]);
  assert.equal((((await getJson('/api/v1/records/change/app/login')).body as { moment?: unknown }).moment), undefined, 'a live read carries no moment');
});

test('the event stream: a list, and server-sent events with ids', async () => {
  const list = await getJson('/api/v1/events');
  const events = list.body.data as { seq: number; op: string }[];
  assert.equal(events[0].op, 'init');
  const last = events.at(-1)!.seq;
  const received: string[] = [];
  const res = await fetch(`${base}/api/v1/events`, { headers: { accept: 'text/event-stream' } });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const done = new Promise<void>((resolve) => {
    const pump = async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return resolve();
        received.push(new TextDecoder().decode(value));
        if (received.join('').includes('event: set')) return resolve();
      }
    };
    void pump();
  });
  newRecord(store, 'change', 'signup', { title: 'Signup', summary: 's' });
  const { set } = await import('../commands/set.js');
  set(store, 'change:signup', ['status=active'], {});
  await done;
  await reader.cancel();
  const text = received.join('');
  assert.match(text, new RegExp(`id: ${last + 1}\\nevent: created\\ndata: `));
  assert.match(text, /event: set\n/);
});

test('the app is served with a history fallback; unknown api routes are 404 json', async () => {
  const index = await fetch(base + '/session/sess-1');
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await index.text(), /<title>pjman<\/title>/);
  const js = await fetch(base + '/app.js');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const bad = await getJson('/api/v1/nope');
  assert.equal(bad.status, 404);
  const old = await getJson('/api/records');
  assert.equal(old.status, 404);
});

test('the scope: one page as data, in a lens, at a node; a bad lens or node is a bad request', async () => {
  const root = await getJson('/api/v1/scope?lens=project');
  assert.equal(root.status, 200);
  const data = root.body.data as { lens: string; node: null; tree: { key: string; children: { key: string; row?: { ticket?: { label: string } } }[] }[]; changes: { key: string }[] };
  assert.equal(data.lens, 'project');
  assert.equal(data.node, null);
  // the product init made with the project is the root; the project sits beneath it with its changes
  assert.deepEqual(data.tree.map((n) => n.key), ['product:app']);
  const project = data.tree[0].children[0] as unknown as { key: string; children: { key: string; row?: { ticket?: { label: string } } }[] };
  assert.equal(project.key, 'project:app');
  assert.deepEqual(project.children.map((n) => n.key), ['change:app/login', 'change:app/signup']);
  assert.equal(project.children[0].row?.ticket?.label, 'APP-1');
  const at = await getJson('/api/v1/scope?lens=feature&node=change:login&days=7');
  assert.equal(at.status, 200);
  const d2 = at.body.data as { container: string; change?: { change: { key: string } }; health: { days: number } };
  assert.equal(d2.container, 'product:app'); // no feature names it: the project's product
  assert.equal(d2.change?.change.key, 'change:app/login');
  assert.equal(d2.health.days, 7);
  assert.equal((await getJson('/api/v1/scope?lens=colour')).status, 400);
  assert.equal((await getJson('/api/v1/scope?node=change:nope')).status, 400);
});

test('the one write: POST /order moves a change in its product\'s sequence as the person signed in; anything else is refused', async () => {
  newRecord(store, 'change', 'second', { title: 'Second', summary: 's' });
  const post = async (body: unknown) => {
    const res = await fetch(base + '/api/v1/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { data?: { sequence: string[] }; error?: { code: string; message: string } } };
  };
  let r = await post({ change: 'change:login', last: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data?.sequence, ['change:app/login']);
  r = await post({ change: 'change:second', before: 'change:login' });
  assert.deepEqual(r.body.data?.sequence, ['change:app/second', 'change:app/login']);
  r = await post({ change: 'change:second', later: true });
  assert.deepEqual(r.body.data?.sequence, ['change:app/login']);
  r = await post({ change: 'change:nope', first: true });
  assert.equal(r.status, 400);
  r = await post({ change: 'change:login' });
  assert.equal(r.status, 400);
  assert.match(r.body.error?.message ?? '', /say where/);
  const other = await fetch(base + '/api/v1/records', { method: 'POST' });
  assert.equal(other.status, 405);
  const scope = await getJson('/api/v1/scope?node=product:app');
  assert.deepEqual((scope.body.data as { roadmap: { sequence: string[] } }).roadmap.sequence, ['change:app/login']);
});

test('POST /decide decides a proposed decision as the person signed in, and POST /reopen is its reverse', async () => {
  newRecord(store, 'decision', 'login/sessions', { title: 'Sessions', decision: 'Cookies.', why: 'Simple.' });
  newRecord(store, 'decision', 'login/rotation', { title: 'Rotation', decision: 'Rotate.', why: 'Safe.' });
  const post = async (route: string, body: unknown) => {
    const res = await fetch(base + '/api/v1' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { error?: { message: string } } };
  };
  const show = async (slug: string) => ((await getJson(`/api/v1/records/decision/app/login/${slug}`)).body.data as { data: Record<string, unknown> }).data;
  let r = await post('/decide', { decision: 'decision:login/sessions' });
  assert.equal(r.status, 200);
  let d = await show('sessions');
  assert.equal(d.status, 'decided');
  assert.equal(d.decided_by, 'person:tester');
  assert.match(String(d.decided_on), /^\d{4}-\d\d-\d\d$/);
  r = await post('/decide', { decision: 'decision:login/sessions' });
  assert.equal(r.status, 400);
  assert.match(r.body.error?.message ?? '', /not proposed/);
  r = await post('/reopen', { decision: 'decision:login/sessions' });
  assert.equal(r.status, 200);
  d = await show('sessions');
  assert.equal(d.status, 'proposed');
  assert.equal(d.decided_by, undefined);
  assert.equal(d.decided_on, undefined);
  r = await post('/reopen', { decision: 'decision:login/rotation' });
  assert.equal(r.status, 400);
  assert.match(r.body.error?.message ?? '', /not decided/);
  r = await post('/decide', {});
  assert.equal(r.status, 400);
});
