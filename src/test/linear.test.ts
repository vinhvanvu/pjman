import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { init } from '../commands/init.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { readEvents } from '../events.js';
import { McpClient } from '../mcp/client.js';
import { loadStore } from '../records.js';
import { mapStatus, pageOf, syncLinear, toIssue } from '../sync/linear.js';
import { validate } from '../validate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-linear-'));
const project = path.join(tmp, 'app');
process.env.PJMAN_HOME = path.join(tmp, 'home');
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
delete process.env.PJMAN_LINEAR_TOKEN;

// --- a fake Linear MCP server: JSON-RPC over HTTP, tools/list as an event stream, list_issues paged --------------------
type Raw = { identifier: string; title: string; url: string; state: { name: string; type: string }; parent?: { identifier: string }; updatedAt: string; team: { key: string } };
const issues: Raw[] = [
  { identifier: 'APP-1', title: 'Login', url: 'https://linear.app/acme/issue/APP-1/login', state: { name: 'In Progress', type: 'started' }, updatedAt: '2026-10-20T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'APP-2', title: 'Signup form', url: 'https://linear.app/acme/issue/APP-2/signup', state: { name: 'Todo', type: 'unstarted' }, parent: { identifier: 'APP-1' }, updatedAt: '2026-10-21T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'APP-3', title: 'Old thing', url: 'https://linear.app/acme/issue/APP-3/old', state: { name: 'Done', type: 'completed' }, updatedAt: '2026-10-01T10:00:00Z', team: { key: 'APP' } },
  { identifier: 'XYZ-9', title: 'Other team', url: 'https://linear.app/acme/issue/XYZ-9/x', state: { name: 'Todo', type: 'unstarted' }, updatedAt: '2026-10-21T10:00:00Z', team: { key: 'XYZ' } },
];
let seenAuth = '';
let seenArgs: unknown[] = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seenAuth = req.headers.authorization ?? '';
    if (seenAuth !== 'Bearer good') {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
      return;
    }
    const msg = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    const reply = (result: unknown, sse = false) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
      if (sse) res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' }).end(`event: message\ndata: ${payload}\n\n`);
      else res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }).end(payload);
    };
    switch (msg.method) {
      case 'initialize': return reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'fake-linear', version: '1' }, capabilities: { tools: {} } });
      case 'notifications/initialized': return void res.writeHead(202).end();
      case 'tools/list': return reply({ tools: [
        { name: 'list_teams', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
        { name: 'list_issues', inputSchema: { type: 'object', properties: { team: { type: 'string' }, limit: { type: 'number' }, cursor: { type: 'string' }, updatedAt: { type: 'string' } } } },
        { name: 'get_issue', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
      ] }, true);
      case 'tools/call': {
        const args = msg.params?.arguments ?? {};
        seenArgs.push(args);
        if (msg.params?.name === 'list_teams') return reply({ content: [{ type: 'text', text: JSON.stringify([{ key: 'APP', name: 'App' }, { key: 'XYZ', name: 'Other' }]) }] });
        if (msg.params?.name === 'list_issues') {
          const all = issues.filter((i) => !args.team || i.team.key === args.team);
          const page = args.cursor === 'p2' ? all.slice(2) : all.slice(0, 2);
          const next = args.cursor === 'p2' || all.length <= 2 ? undefined : 'p2';
          return reply({ content: [{ type: 'text', text: JSON.stringify({ issues: page, nextCursor: next }) }] });
        }
        return reply({ content: [{ type: 'text', text: 'unknown tool' }], isError: true });
      }
      default: return reply(null);
    }
  });
});

let store: Store;
let url = '';

before(async () => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  fs.mkdirSync(process.env.PJMAN_HOME!, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME!, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  init({ cwd: project, name: 'app' });
  store = findStore(project)!;
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const a = fake.address();
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/mcp`;
});

after(() => fake.close());

test('the client: initialize, a tool list from an event stream, arguments trimmed to the schema', async () => {
  const c = await new McpClient({ url, token: 'good' }).connect();
  assert.equal(c.serverInfo?.name, 'fake-linear');
  assert.deepEqual(c.tools.map((t) => t.name), ['list_teams', 'list_issues', 'get_issue']);
  assert.deepEqual(c.argsFor('list_issues', { team: 'APP', teamId: 'x', limit: 5, cursor: undefined }), { team: 'APP', limit: 5 });
  await assert.rejects(new McpClient({ url, token: 'bad' }).connect(), /401|not authorised/);
});

test('shapes: issues from several field names, pages, status mapping', () => {
  assert.equal(toIssue({ identifier: 'A-1', title: 't', state: { name: 'In Review', type: 'started' } })?.stateType, 'started');
  assert.equal(toIssue({ key: 'A-2', name: 't', status: 'Done' })?.state, 'Done');
  assert.equal(toIssue({ id: 'uuid', title: 't' }), null);
  assert.deepEqual(pageOf({ nodes: [1], pageInfo: { hasNextPage: true, endCursor: 'c' } }), { items: [1], next: 'c' });
  assert.deepEqual(pageOf([1, 2]), { items: [1, 2] });
  assert.equal(mapStatus(store, 'In Progress', 'started'), 'active');
  assert.equal(mapStatus(store, 'Canceled', 'canceled'), 'dropped');
  assert.equal(mapStatus(store, 'Weird', undefined), 'open');
  assert.equal(mapStatus({ ...store, config: { ...store.config, vocabulary: { 'in review': 'review' } } }, 'In Review', 'started'), 'review');
});

test('a probe lists tools and teams and writes nothing; a project without a tracker is refused', async () => {
  const before = readEvents(store).length;
  const p = await syncLinear(store, { url, token: 'good', probe: true });
  assert.deepEqual(p.probe?.tools, ['list_teams', 'list_issues', 'get_issue']);
  assert.equal(readEvents(store).length, before);
  await assert.rejects(syncLinear(store, { url, token: 'good', team: 'APP' }), /tracker=linear/);
});

test('a sync pulls the bound team: sources, changes, status, parent; a second run changes nothing; pjman fields survive', async () => {
  set(store, 'project:app', ['tracker=linear', 'ext.linear.team=APP'], {});
  await assert.rejects(syncLinear(store, { url, token: 'nope' }), /401|not authorised/);
  const r = await syncLinear(store, { url, token: 'good' });
  assert.equal(r.team, 'APP');
  assert.equal(r.issues, 3);
  assert.deepEqual(r.created.sort(), ['change:app-1', 'change:app-2', 'change:app-3']);
  assert.ok(r.commit);
  assert.ok(seenArgs.some((a) => (a as { team?: string }).team === 'APP'));
  const loaded = loadStore(store);
  const c1 = loaded.byKey.get('change:app-1')![0];
  assert.equal(c1.data.status, 'active');
  assert.deepEqual(c1.data.binds, ['linear:APP-1']);
  assert.equal(c1.data.project, 'project:app');
  assert.equal(c1.data.writer, 'agent:linear-sync');
  const c2 = loaded.byKey.get('change:app-2')![0];
  assert.equal(c2.data.parent, 'change:app-1');
  assert.equal(c2.data.status, 'planning');
  assert.equal(loaded.byKey.get('change:app-3')![0].data.status, 'done');
  assert.ok(!loaded.byKey.has('change:xyz-9'));
  const s1 = loaded.byKey.get('linear:APP-1')![0];
  assert.equal(s1.data.title, 'Login');
  assert.equal((s1.data.ext as { linear: { state: string } }).linear.state, 'In Progress');
  assert.ok(r.session && loaded.byKey.has(r.session));
  assert.deepEqual(validate(loaded).filter((p) => p.level === 'error'), []);

  const events = readEvents(store).length;
  const again = await syncLinear(store, { url, token: 'good' });
  assert.deepEqual(again.created, []);
  assert.deepEqual(again.updated, []);
  assert.equal(again.unchanged.length, 3);
  assert.equal(again.commit, null);
  // only the session record of the run is new
  assert.ok(readEvents(store).length - events <= 2);

  set(store, 'change:app-1', ['next=write the tests', 'summary=Our own words.'], {});
  issues[0].state = { name: 'Done', type: 'completed' };
  issues[0].title = 'Login (renamed)';
  const third = await syncLinear(store, { url, token: 'good' });
  assert.deepEqual(third.updated, ['change:app-1']);
  const after = loadStore(store).byKey.get('change:app-1')![0];
  assert.equal(after.data.status, 'done');
  assert.equal(after.data.title, 'Login (renamed)');
  assert.equal(after.data.next, 'write the tests');
  assert.match(after.sections.get('Summary')!, /Our own words/);
});
