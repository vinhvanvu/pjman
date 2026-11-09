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
import { change, decisionRec } from './shape.js';

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
  change(store, 'login', { title: 'Login', summary: 'Sign in.', binds: ['linear:APP-1'], links: ['file:README.md'] });
  decisionRec(store, 'login/magic-links', { title: 'Magic links', decision: 'Links.', why: 'No passwords.' });
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
  type SessionView = { showing: { key?: string; board?: string }; session: { key: string; on?: string; binds: string[]; product?: string; state: string; log: { at: string; text: string }[] } };
  sessionLog(store, 'sess-1', 'session started');
  const before = await getJson('/api/v1/sessions/sess-1/view');
  const fresh = before.body.data as SessionView;
  assert.equal(fresh.showing.board, 'project:app');
  // the session's facts ride along: no change yet, the project's product, live since it just wrote, its log
  assert.equal(fresh.session.on, undefined);
  assert.deepEqual(fresh.session.binds, []);
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
  // every change it bound, in order: the dock reads a milestone among them as its frame
  assert.deepEqual(bound.session.binds, ['change:app/login']);
  // on a change the session keeps its product: the change's key sits under it (change:bridge-lost-on-session-page)
  assert.equal(bound.session.product, 'product:app');
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
  change(store, 'signup', { title: 'Signup', summary: 's' });
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

test('the index is data, one style: a member in the path, a record viewed as key, filters named as the CLI flags; the aliases are gone', async () => {
  const index = (await getJson('/api/v1')).body.data as { routes: { method: string; path: string; query?: string[] }[]; conventions: Record<string, string> };
  assert.ok(index.routes.some((r) => r.method === 'GET' && r.path === '/records' && r.query?.includes('parent')));
  for (const r of index.routes.filter((x) => x.query?.includes('key'))) assert.ok(!r.query!.includes('node') && !r.query!.includes('root'), r.path);
  assert.match(index.conventions.errors, /ambiguous 409/);
  assert.equal((await getJson('/api/v1/bridge?product=app')).status, 404);
  assert.equal((await getJson('/api/v1/board')).status, 404);
  const tree = await getJson('/api/v1/tree?key=product:app');
  assert.equal(tree.status, 200);
  const ls = await getJson('/api/v1/records?type=change&status=bogus');
  assert.equal(ls.status, 400);
  assert.match((ls.body.error as { message: string }).message, /--status bogus is not a status of a change/);
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
  const at = await getJson('/api/v1/scope?lens=feature&key=change:login&days=7');
  assert.equal(at.status, 200);
  const d2 = at.body.data as { container: string; change?: { change: { key: string } }; health: { days: number } };
  assert.equal(d2.container, 'product:app'); // no feature names it: the project's product
  assert.equal(d2.change?.change.key, 'change:app/login');
  assert.equal(d2.health.days, 7);
  assert.equal((await getJson('/api/v1/scope?lens=colour')).status, 400);
  assert.equal((await getJson('/api/v1/scope?key=change:nope')).status, 404);
});

test('the one write: POST /order moves a change in its product\'s sequence as the person signed in; anything else is refused', async () => {
  change(store, 'second', { title: 'Second', summary: 's' });
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
  assert.equal(r.status, 404);
  assert.equal((r.body as { error?: { code: string } }).error?.code, 'not-found');
  r = await post({ change: 'change:login' });
  assert.equal(r.status, 400);
  assert.match(r.body.error?.message ?? '', /say where/);
  const other = await fetch(base + '/api/v1/records', { method: 'POST' });
  assert.equal(other.status, 405);
  const scope = await getJson('/api/v1/scope?key=product:app');
  assert.deepEqual((scope.body.data as { roadmap: { sequence: string[] } }).roadmap.sequence, ['change:app/login']);
});

test('POST /decide decides a proposed decision as the person signed in, and POST /reopen is its reverse', async () => {
  decisionRec(store, 'login/sessions', { title: 'Sessions', decision: 'Cookies.', why: 'Simple.' });
  decisionRec(store, 'login/rotation', { title: 'Rotation', decision: 'Rotate.', why: 'Safe.' });
  const post = async (route: string, body: unknown) => {
    const res = await fetch(base + '/api/v1' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { error?: { message: string } } };
  };
  const show = async (slug: string) => ((await getJson(`/api/v1/records/decision/app/login/${slug}`)).body.data as { data: Record<string, unknown> }).data;
  let r = await post('/decide', { decision: 'decision:login/sessions' });
  assert.equal(r.status, 200, r.body.error?.message);
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

test('a session the store does not hold is a 404 with its own code, so the page can wait for it', async () => {
  const r = await getJson('/api/v1/sessions/not-yet/view');
  assert.equal(r.status, 404);
  assert.equal(r.body.error?.code, 'no-session');
  assert.equal(r.body.error?.message, 'session:not-yet resolves to nothing');
});

test('who may call: the server answers to its own names and *.localhost, refuses any other Host or Origin, sends no CORS header, and a write is JSON', async () => {
  // http.request, not fetch: the Host header is set by hand
  const raw = (method: string, route: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: { error?: { code: string; message: string } } }>((resolve, reject) => {
      const u = new URL(base + route);
      const req = http.request({ host: u.hostname, port: u.port, method, path: u.pathname + u.search, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text.startsWith('{') ? JSON.parse(text) : {} }));
      });
      req.on('error', reject);
      req.end(body);
    });
  // the Host: loopback, the proxy's names (port ignored), a trailing dot; a rebound site is not one of this server's names
  for (const host of ['127.0.0.1:1', 'localhost', '[::1]:7331', 'api.pjman.localhost:1355', 'worktree-x.api.pjman.localhost:1355', 'LOCALHOST.']) {
    const r = await raw('GET', '/api/v1/store', { host });
    assert.equal(r.status, 200, `${host}: ${r.body.error?.message}`);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'no CORS header on a read');
  }
  for (const host of ['evil.example:7331', 'evil.example', '10.0.0.5:7331', 'localhost.evil.example']) {
    const r = await raw('GET', '/api/v1/store', { host });
    assert.equal(r.status, 403, host);
    assert.equal(r.body.error?.code, 'forbidden-host');
  }
  assert.equal((await raw('GET', '/', { host: 'evil.example' })).status, 403, 'the app is refused too');
  assert.equal((await raw('GET', '/', { host: 'localhost' })).status, 200);
  // the Origin: the dev proxy's page and the server's own pass; another site's page, or an opaque one, is refused, on reads and writes alike
  const order = JSON.stringify({ change: 'change:login', last: true });
  const json = { 'content-type': 'application/json' };
  for (const origin of ['http://pjman.localhost:1355', 'http://worktree-x.pjman.localhost:1355', base, 'http://localhost:7331']) {
    const r = await raw('POST', '/api/v1/order', { ...json, origin }, order);
    assert.equal(r.status, 200, `${origin}: ${r.body.error?.message}`);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'no CORS header on a write');
  }
  for (const origin of ['https://evil.example', 'http://evil.example:7331', 'null', 'http://localhost.evil.example', 'file://']) {
    const r = await raw('POST', '/api/v1/order', { ...json, origin }, order);
    assert.equal(r.status, 403, origin);
    assert.equal(r.body.error?.code, 'forbidden-origin');
    assert.equal((await raw('GET', '/api/v1/store', { origin })).status, 403, `a read from ${origin}`);
  }
  // no Origin at all (curl, the CLI) writes
  assert.equal((await raw('POST', '/api/v1/order', json, order)).status, 200);
  // a write says it is JSON; a cross-site form or text/plain fetch does not
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
    const r = await raw('POST', '/api/v1/order', type ? { 'content-type': type } : {}, order);
    assert.equal(r.status, 415, type);
    assert.equal(r.body.error?.code, 'unsupported-media-type');
  }
  assert.equal((await raw('POST', '/api/v1/order', { 'content-type': 'Application/JSON; charset=utf-8' }, order)).status, 200);
  // no preflight: OPTIONS is not a method the API answers
  assert.equal((await raw('OPTIONS', '/api/v1/order', {})).status, 405);
  // the event stream carries no CORS header either
  const stream = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const u = new URL(base + '/api/v1/events');
    http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { accept: 'text/event-stream' } }, resolve).on('error', reject);
  });
  assert.equal(stream.statusCode, 200);
  assert.equal(stream.headers['access-control-allow-origin'], undefined);
  stream.destroy();
});
