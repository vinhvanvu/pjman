import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUserConfig, userDir, type Store } from './config.js';
import { follow, lastSeq, readEvents } from './events.js';
import { eventsBetween, loadAt, type Moment } from './moment.js';
import { timeline } from './timeline.js';
import { findReferences, get } from './graph.js';
import { rootProductOf, tree } from './tree.js';
import { activity } from './activity.js';
import { rail, type RowKind } from './rail.js';
import { bridge } from './bridge.js';
import { scope } from './scope.js';
import { loadStore, resolve } from './records.js';
import { viewData } from './commands/pane.js';
import { ls, row, storeContext } from './commands/view.js';
import { order } from './commands/order.js';
import { decide, reopen } from './commands/decision.js';
import { withStoreLock } from './lock.js';
import { intake } from './intake.js';
import { CliError } from './util.js';

/** The kinds a `kinds=` filter may name; anything else is ignored. */
const ROW_KINDS: ReadonlySet<RowKind> = new Set<RowKind>(['write', 'decision', 'line', 'file', 'switch', 'bind']);

export interface ServeOpts {
  /** The port to listen on; else PORT from the environment (how a local proxy such as portless hands one down); else a free one. */
  port?: number;
  host?: string;
  /** The folder of built UI assets; the default is the app shipped with the tool. */
  staticDir?: string | null;
  /** Write the machine's address file (what the hook docks and `pjman start` reuses). Default: only when this is the
   *  installed tool, not a checkout, so a server started from a worktree prints its URL and claims nothing. */
  register?: boolean;
}

/** True when the tool runs from an installed package rather than a checkout: there is no .git beside it. */
export function installedTool(): boolean {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  return !fs.existsSync(path.join(root, '.git'));
}

export interface ServeAddress {
  url: string;
  host: string;
  port: number;
  pid: number;
  store: string;
  started: string;
}

export function serveAddressPath(): string {
  return path.join(userDir(), 'serve.json');
}

/** The running server's address, when one is running (its pid is alive). */
export function readServeAddress(): ServeAddress | null {
  try {
    const a = JSON.parse(fs.readFileSync(serveAddressPath(), 'utf8')) as ServeAddress;
    process.kill(a.pid, 0);
    return a;
  } catch {
    return null;
  }
}

/** The bundled app: dist/ui beside this file's folder. */
export function defaultStaticDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, 'ui');
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

/** The host name of an authority (`name`, `name:port`, `[v6]:port`), lower-cased and without a trailing dot; null when it is not one. */
export function hostnameOf(authority: string | undefined): string | null {
  if (!authority) return null;
  try {
    const name = new URL(`http://${authority}`).hostname;
    return name.endsWith('.') ? name.slice(0, -1) : name;
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public tried?: string[]) {
    super(message);
  }
}

/** The server: the library over HTTP. Every endpoint is a library call serialised; nothing is computed here. */
/** The routes that write; everything else reads. */
const WRITES = ['/order', '/decide', '/reopen'];

/** The API's index, as data (GET /api/v1): one style throughout (change:interface-audit). A collection's member is
 *  named in the path (/records/{kind}/{rest}, /products/{slug}/…, /projects/{slug}/…, /sessions/{id}/…); a view over
 *  any record takes it as `key`; filters are query parameters named as the CLI's flags. */
export const ROUTES: { method: 'GET' | 'POST'; path: string; query?: string[]; body?: string; about: string }[] = [
  { method: 'GET', path: '/store', about: 'the store: its root, mode, projects, products with their open counts, source kinds, vocabulary' },
  { method: 'GET', path: '/records', query: ['type', 'status', 'kind', 'project', 'product', 'parent', 'feature'], about: 'records, as pjman ls lists them' },
  { method: 'GET', path: '/records/{kind}/{rest}', about: 'one record, as pjman show reads it, with its body and sections' },
  { method: 'GET', path: '/records/{kind}/{rest}/neighbourhood', about: 'the record, its edges both ways and the changes in reach, as pjman get' },
  { method: 'GET', path: '/resolve', query: ['ref'], about: 'anything in (a key, a slug, a ticket, a URL, a file): what pjman get answers' },
  { method: 'GET', path: '/refs', query: ['text'], about: 'every reference in a text and the change it leads to' },
  { method: 'GET', path: '/intake', query: ['text'], about: 'what already exists for a request before it is filed' },
  { method: 'GET', path: '/tree', query: ['key'], about: 'the product tree, from a product or a feature' },
  { method: 'GET', path: '/activity', query: ['key', 'days', 'since'], about: 'the events beneath a record and what they say about health' },
  { method: 'GET', path: '/rail', query: ['key', 'limit', 'before', 'from', 'to', 'lanes', 'kinds', 'fold'], about: 'the activity rail at a record: lanes, a page of rows, day buckets' },
  { method: 'GET', path: '/scope', query: ['lens', 'key', 'days', 'done', 'retired'], about: 'one page as data: a record seen through a lens' },
  { method: 'GET', path: '/sessions/{id}/view', about: "what a session is on, the dashboard's session page" },
  { method: 'GET', path: '/projects/{slug}/board', about: "a project's board, as pjman context prints it" },
  { method: 'GET', path: '/products/{slug}/bridge', query: ['days'], about: "the product's changes in motion and their sessions" },
  { method: 'GET', path: '/products/{slug}/timeline', query: ['from', 'to', 'after'], about: "the product's events over a window, always as of now" },
  { method: 'GET', path: '/events', query: ['since', 'until'], about: 'the event stream; live as server-sent events with Accept: text/event-stream' },
  { method: 'POST', path: '/order', body: '{change, before|after|first|last|later}', about: "move a change in its product's order, as pjman order" },
  { method: 'POST', path: '/decide', body: '{decision, option?, words?}', about: 'a proposed decision accepted by the person signed in' },
  { method: 'POST', path: '/reopen', body: '{decision}', about: 'a decided decision back to proposed' },
];

const CONVENTIONS = {
  at: 'every read takes at=<event seq|instant> and answers as of that moment, stamped with the moment it resolved to',
  envelope: 'every answer is {seq, data} or {seq, error: {code, message, tried?}}; seq is the stream position, also in X-Pjman-Seq',
  errors: 'not-found 404, ambiguous 409, bad-request 400, method-not-allowed 405, forbidden-host and forbidden-origin 403, unsupported-media-type 415',
};

export function createServer(store: Store, opts: ServeOpts = {}): http.Server {
  const staticDir = opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir;
  const bound = opts.host ?? '127.0.0.1';
  /** The names this server answers to: the loopback names, the address it binds (the machine's name when it binds
   *  every interface), and any *.localhost name, which a browser resolves to loopback itself, so none of these can be
   *  another site rebound to this address. The port is not compared: behind a proxy such as portless it is the proxy's. */
  const ownNames = new Set(['localhost', '127.0.0.1', '[::1]', bound.includes(':') && !bound.startsWith('[') ? `[${bound}]` : bound, ...(bound === '0.0.0.0' || bound === '::' ? [os.hostname().toLowerCase()] : [])]);
  const own = (name: string) => ownNames.has(name) || name.endsWith('.localhost');

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    const seq = lastSeq(store);
    const text = JSON.stringify({ seq, ...(body as object) });
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-pjman-seq': String(seq),
      'cache-control': 'no-store',
    });
    res.end(text);
  };
  const sendAll = send;
  const fail = (res: http.ServerResponse, e: unknown) => {
    if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message, tried: e.tried } });
    // a refusal from the library answers with the CLI's code: not found 404, ambiguous 409, anything else 400
    if (e instanceof CliError) return send(res, e.code === 'not-found' ? 404 : e.code === 'ambiguous' ? 409 : 400, { error: { code: e.code === 'usage' || e.code === 'refused' ? 'bad-request' : e.code, message: e.message, ...(e.tried ? { tried: e.tried } : {}) } });
    send(res, 500, { error: { code: 'internal', message: (e as Error).message } });
  };

  /** The writes, each through the same function the command uses, as the person signed in: reorder the roadmap, and
   *  decide a proposed decision or reopen a decided one (decision decide-in-place/decide-route-and-reopen). */
  const write = (req: http.IncomingMessage, res: http.ServerResponse, route: string): void => {
    if (!WRITES.includes(route)) throw new HttpError(405, 'method-not-allowed', `${req.method} ${route} is not allowed; the writes are ${WRITES.map((w) => `POST ${w}`).join(', ')}`);
    // a write is JSON and says so: a cross-site form or a text/plain fetch, which a browser sends without asking, is not one
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'unsupported-media-type', `a write is JSON: send Content-Type application/json${type ? `, not ${type}` : ''}`);
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { text += chunk; });
    req.on('end', () => {
      try {
        const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
        const writer = readUserConfig().actor;
        if (!writer) throw new HttpError(403, 'no-actor', 'no person is signed in: set actor in ~/.pjman/config.yaml');
        if (route === '/order') {
          if (!s(body.change)) throw new HttpError(400, 'bad-request', 'change is required');
          const r = withStoreLock(store.root, () => order(store, s(body.change)!, { before: s(body.before), after: s(body.after), first: body.first === true, last: body.last === true, later: body.later === true, writer }));
          return send(res, 200, { data: r });
        }
        const key = s(body.decision);
        if (!key) throw new HttpError(400, 'bad-request', 'decision is required');
        // deciding takes the option the person chose and their words, else the recommendation (decision detail-pages/decision-card)
        const r = withStoreLock(store.root, () => (route === '/decide' ? decide(store, key, { by: writer, option: s(body.option), words: s(body.words)?.trim() || undefined }) : reopen(store, key)));
        send(res, 200, { data: r });
      } catch (e) {
        fail(res, e);
      }
    });
  };

  const api = (req: http.IncomingMessage, res: http.ServerResponse, route: string, url: URL): void => {
    if (req.method === 'POST') return write(req, res, route);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed', `${req.method} is not allowed; the API reads, and writes only through ${WRITES.map((w) => `POST ${w}`).join(', ')}`);
    // as of a moment (at=<event seq|instant>): the records at its commit, the stream cut after it, the clock set to it
    const atParam = url.searchParams.get('at');
    let moment: Moment | undefined;
    let loaded;
    if (atParam) ({ moment, loaded } = loadAt(store, atParam));
    else loaded = loadStore(store);
    const asOf = moment ? { now: Date.parse(moment.at), until: moment.seq } : {};
    const send = (r: http.ServerResponse, status: number, body: unknown) => sendAll(r, status, moment ? { moment, ...(body as object) } : body);
    // a bare key on a request resolves in the product the page is in (the record it is about), else the current project's
    const at = url.searchParams.get('key');
    if (at) {
      const res = resolve(loaded, at);
      const rec = res.status === 'ok' || res.status === 'alias' ? res.rec : undefined;
      const p = rec ? (rec.type === 'product' ? rec.productSlug : rec.productSlug ?? rootProductOf(loaded, rec)?.productSlug) : undefined;
      if (p) loaded.scope = p;
    }
    const getOpts = { cwd: store.projectDir ?? process.cwd(), projectDir: store.projectDir, project: store.project };
    let m: RegExpExecArray | null;

    if (route === '/store') {
      const cfg = store.config;
      return send(res, 200, { data: {
        root: store.root, mode: store.mode, name: cfg.name, project: store.project ?? null, actor: readUserConfig().actor ?? null,
        source_kinds: cfg.source_kinds, vocabulary: cfg.vocabulary,
        projects: loaded.records.filter((r) => r.type === 'project').map(row),
        products: loaded.records.filter((r) => r.type === 'product').map((p) => {
          const projects = new Set(loaded.records.filter((r) => r.type === 'project' && r.data.product === p.key).map((r) => r.key));
          const changes = loaded.records.filter((r) => r.type === 'change' && projects.has(String(r.data.project)) && r.data.status !== 'done' && r.data.status !== 'dropped');
          return {
            ...row(p),
            name: typeof p.data.name === 'string' ? p.data.name : undefined,
            open: changes.length,
            inFlight: changes.filter((r) => ['active', 'review', 'blocked'].includes(String(r.data.status))).length,
            loud: changes.filter((r) => r.data.kind === 'bug' && (r.data.severity === 'product' || r.data.severity === 'feature')).length,
          };
        }),
      } });
    }
    if (route === '/records') {
      const q = url.searchParams;
      const opt = (name: string) => q.get(name) ?? undefined;
      return send(res, 200, { data: ls(store, { type: opt('type'), status: opt('status'), kind: opt('kind'), project: opt('project'), product: opt('product'), parent: opt('parent'), feature: opt('feature') }) });
    }
    if ((m = /^\/records\/([a-z][a-z0-9-]*)\/(.+?)(\/neighbourhood)?$/.exec(route))) {
      const key = `${m[1]}:${decodeURIComponent(m[2])}`;
      if (m[3]) {
        const n = get(loaded, key, getOpts);
        if (n.resolution.status === 'none') throw new HttpError(404, 'not-found', `${key} resolves to nothing`, n.resolution.tried);
        return send(res, 200, { data: n });
      }
      const r = resolve(loaded, key);
      if (r.status === 'ok' || r.status === 'alias' || r.status === 'invalid') {
        return send(res, 200, { data: { ...row(r.rec), body: r.rec.body, sections: Object.fromEntries(r.rec.sections), via: r.status === 'alias' ? r.via : undefined } });
      }
      throw new HttpError(404, 'not-found', `${key} resolves to nothing`);
    }
    if (route === '/resolve') {
      const ref = url.searchParams.get('ref');
      if (!ref) throw new HttpError(400, 'bad-request', 'ref is required');
      const n = get(loaded, ref, getOpts);
      if (n.resolution.status === 'none') throw new HttpError(404, 'not-found', `${ref} resolves to nothing`, n.resolution.tried);
      return send(res, 200, { data: n });
    }
    if (route === '/tree') {
      const root = url.searchParams.get('key') ?? undefined;
      const nodes = tree(loaded, root);
      if (root && !nodes.length) throw new HttpError(404, 'not-found', `${root} resolves to no product or feature`);
      return send(res, 200, { data: nodes });
    }
    if (route === '/activity') {
      const key = url.searchParams.get('key');
      if (!key) throw new HttpError(400, 'bad-request', 'key is required');
      const r = resolve(loaded, key);
      if (r.status !== 'ok' && r.status !== 'alias') throw new HttpError(404, 'not-found', `${key} resolves to nothing`);
      const days = url.searchParams.get('days');
      return send(res, 200, { data: activity(store, loaded, r.rec.key, { days: days ? Number(days) : undefined, since: url.searchParams.get('since') ?? undefined, ...asOf }) });
    }
    if (route === '/rail') {
      const key = url.searchParams.get('key');
      if (!key) throw new HttpError(400, 'bad-request', 'key is required');
      const r = resolve(loaded, key);
      if (r.status !== 'ok' && r.status !== 'alias') throw new HttpError(404, 'not-found', `${key} resolves to nothing`);
      const q = url.searchParams;
      const num = (name: string) => (q.get(name) ? Number(q.get(name)) : undefined);
      const list = (name: string) => (q.get(name) === null ? undefined : q.get(name)!.split(',').filter(Boolean));
      const kinds = list('kinds')?.filter((k): k is RowKind => ROW_KINDS.has(k as RowKind));
      return send(res, 200, { data: rail(store, loaded, r.rec.key, { limit: num('limit'), before: num('before'), from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, fold: num('fold'), lanes: list('lanes'), kinds, ...asOf }) });
    }
    if (route === '/scope') {
      const q = url.searchParams;
      const days = q.get('days');
      return send(res, 200, { data: scope(store, loaded, { lens: q.get('lens') ?? undefined, node: q.get('key') ?? undefined, days: days ? Number(days) : undefined, done: q.get('done') === '1', retired: q.get('retired') === '1', ...asOf }) });
    }
    if (route === '/intake') {
      const text = url.searchParams.get('text');
      if (text === null) throw new HttpError(400, 'bad-request', 'text is required');
      return send(res, 200, { data: intake(store, loaded, text, getOpts) });
    }
    if (route === '/refs') {
      const text = url.searchParams.get('text');
      if (text === null) throw new HttpError(400, 'bad-request', 'text is required');
      return send(res, 200, { data: findReferences(loaded, text, getOpts) });
    }
    if ((m = /^\/sessions\/([^/]+)\/view$/.exec(route))) {
      const id = decodeURIComponent(m[1]);
      const key = id.startsWith('session:') ? id : `session:${id}`;
      // its own code, since a session the store does not hold yet is one the page waits for: the pane is pointed at
      // the page before the record is written (change:session-page-before-record)
      if (resolve(loaded, key).status !== 'ok') throw new HttpError(404, 'no-session', `${key} resolves to nothing`);
      return send(res, 200, { data: viewData(store, { session: id, ...getOpts }, loaded) });
    }
    if ((m = /^\/projects\/([a-z0-9][a-z0-9-]*)\/board$/.exec(route))) {
      return send(res, 200, { data: storeContext(store, { project: `project:${m[1]}` }) });
    }
    if ((m = /^\/products\/([a-z0-9][a-z0-9-]*)\/bridge$/.exec(route))) {
      const days = url.searchParams.get('days');
      const product = `product:${m[1]}`;
      return send(res, 200, { data: bridge(store, loaded, { product, days: days ? Number(days) : undefined, ...asOf }) });
    }
    if ((m = /^\/products\/([a-z0-9][a-z0-9-]*)\/timeline$/.exec(route))) {
      // the axis a moment is placed on: always as of now, whatever at= says
      const q = url.searchParams;
      return send(res, 200, { data: timeline(store, moment ? loadStore(store) : loaded, { product: `product:${m[1]}`, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, after: q.get('after') ? Number(q.get('after')) : undefined }) });
    }
    if (route === '/events') {
      const sinceParam = url.searchParams.get('since') ?? req.headers['last-event-id'];
      const since = sinceParam ? Number(sinceParam) : 0;
      if ((req.headers.accept ?? '').includes('text/event-stream') || url.searchParams.get('stream') === '1') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-pjman-seq': String(lastSeq(store)),
        });
        res.write(`retry: 2000\n\n`);
        const stop = follow(store, sinceParam ? since : lastSeq(store), (e) => res.write(`id: ${e.seq}\nevent: ${e.op}\ndata: ${JSON.stringify(e)}\n\n`));
        const beat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
        req.on('close', () => {
          stop();
          clearInterval(beat);
        });
        return;
      }
      const until = url.searchParams.get('until');
      return send(res, 200, { data: until ? eventsBetween(store, since, Number(until)) : readEvents(store, since) });
    }
    throw new HttpError(404, 'not-found', `no route ${route}`);
  };

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void => {
    if (!staticDir) {
      send(res, 404, { error: { code: 'no-ui', message: 'no UI assets are built; the API is under /api/v1' } });
      return;
    }
    const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(staticDir, safe);
    if (!file.startsWith(staticDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  };

  return http.createServer((req, res) => {
    try {
      // who may call (decision local-server-cross-origin/who-may-call): the request names this server by one of its own
      // names, and a page that sends an Origin was loaded from one; no CORS header is ever sent, so another site's page
      // reads nothing and writes nothing, and a site rebound to this address is refused by its Host
      const host = hostnameOf(req.headers.host);
      if (!host || !own(host)) throw new HttpError(403, 'forbidden-host', `${req.headers.host ?? 'no Host'} is not a name of this server; it answers to ${[...ownNames].join(', ')} and any *.localhost name`);
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const from = /^https?:\/\//.test(origin) ? hostnameOf(origin.replace(/^https?:\/\//, '')) : null;
        if (!from || !own(from)) throw new HttpError(403, 'forbidden-origin', `a page at ${origin} may not call this server; only its own pages (${[...ownNames].join(', ')} and any *.localhost name) may`);
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!url.pathname.startsWith('/api/v1')) throw new HttpError(404, 'not-found', 'the API is under /api/v1');
        const route = url.pathname.slice('/api/v1'.length).replace(/\/+$/, '') || '/';
        if (route === '/') return send(res, 200, { data: { version: 1, routes: ROUTES, conventions: CONVENTIONS } });
        return api(req, res, route, url);
      }
      serveStatic(req, res, url.pathname);
    } catch (e) {
      fail(res, e);
    }
  });
}

/** Listen; when registering, write the address file and remove it on exit. Resolves with the address and whether it registered. */
export function startServer(store: Store, opts: ServeOpts = {}): Promise<{ server: http.Server; address: ServeAddress; registered: boolean }> {
  const server = createServer(store, opts);
  const host = opts.host ?? '127.0.0.1';
  const register = opts.register ?? installedTool();
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(opts.port ?? (Number(process.env.PORT) || 0), host, () => {
      const a = server.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      const address: ServeAddress = { url: `http://${host === '0.0.0.0' ? os.hostname() : host}:${port}`, host, port, pid: process.pid, store: store.root, started: new Date().toISOString() };
      if (!register) return res({ server, address, registered: false });
      fs.mkdirSync(userDir(), { recursive: true });
      fs.writeFileSync(serveAddressPath(), JSON.stringify(address, null, 2) + '\n');
      const cleanup = () => {
        try {
          const cur = JSON.parse(fs.readFileSync(serveAddressPath(), 'utf8')) as ServeAddress;
          if (cur.pid === process.pid) fs.rmSync(serveAddressPath(), { force: true });
        } catch {
          // already gone
        }
      };
      process.on('exit', cleanup);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { cleanup(); process.exit(0); });
      res({ server, address, registered: true });
    });
  });
}
