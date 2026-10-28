import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUserConfig, userDir, type Store } from './config.js';
import { follow, lastSeq, readEvents } from './events.js';
import { eventsBetween, loadAt, type Moment } from './moment.js';
import { findReferences, get } from './graph.js';
import { rootProductOf, tree } from './tree.js';
import { activity } from './activity.js';
import { bridge } from './bridge.js';
import { scope } from './scope.js';
import { loadStore, resolve } from './records.js';
import { viewData } from './commands/pane.js';
import { ls, row, storeContext } from './commands/view.js';
import { order } from './commands/order.js';
import { withStoreLock } from './lock.js';
import { intake } from './intake.js';
import { CliError } from './util.js';

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
export function createServer(store: Store, opts: ServeOpts = {}): http.Server {
  const staticDir = opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir;

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    const seq = lastSeq(store);
    const text = JSON.stringify({ seq, ...(body as object) });
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-pjman-seq': String(seq),
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(text);
  };
  const sendAll = send;
  const fail = (res: http.ServerResponse, e: unknown) => {
    if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message, tried: e.tried } });
    if (e instanceof CliError) return send(res, 400, { error: { code: 'bad-request', message: e.message } });
    send(res, 500, { error: { code: 'internal', message: (e as Error).message } });
  };

  /** The one write: reorder the roadmap, through the same function the command uses, as the person signed in. */
  const write = (req: http.IncomingMessage, res: http.ServerResponse, route: string): void => {
    if (route !== '/order') throw new HttpError(405, 'method-not-allowed', `${req.method} ${route} is not allowed; the only write is POST /order`);
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { text += chunk; });
    req.on('end', () => {
      try {
        const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
        const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
        if (!s(body.change)) throw new HttpError(400, 'bad-request', 'change is required');
        const writer = readUserConfig().actor;
        if (!writer) throw new HttpError(403, 'no-actor', 'no person is signed in: set actor in ~/.pjman/config.yaml');
        const r = withStoreLock(store.root, () => order(store, s(body.change)!, { before: s(body.before), after: s(body.after), first: body.first === true, last: body.last === true, later: body.later === true, writer }));
        send(res, 200, { data: r });
      } catch (e) {
        fail(res, e);
      }
    });
  };

  const api = (req: http.IncomingMessage, res: http.ServerResponse, route: string, url: URL): void => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
      res.end();
      return;
    }
    if (req.method === 'POST') return write(req, res, route);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed', `${req.method} is not allowed; the API reads, and writes only through POST /order`);
    // as of a moment (at=<event seq|instant>): the records at its commit, the stream cut after it, the clock set to it
    const atParam = url.searchParams.get('at');
    let moment: Moment | undefined;
    let loaded;
    if (atParam) ({ moment, loaded } = loadAt(store, atParam));
    else loaded = loadStore(store);
    const asOf = moment ? { now: Date.parse(moment.at), until: moment.seq } : {};
    const send = (r: http.ServerResponse, status: number, body: unknown) => sendAll(r, status, moment ? { moment, ...(body as object) } : body);
    // a bare key on a request resolves in the product the page is in (its node), else the current project's
    const at = url.searchParams.get('node') ?? url.searchParams.get('root') ?? url.searchParams.get('key');
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
      return send(res, 200, { data: ls(store, { type: q.get('type') ?? undefined, status: q.get('status') ?? undefined, project: q.get('project') ?? undefined }) });
    }
    if ((m = /^\/records\/([a-z][a-z0-9-]*)\/(.+?)(\/neighbourhood)?$/.exec(route))) {
      const key = `${m[1]}:${decodeURIComponent(m[2])}`;
      if (m[3]) {
        const n = get(loaded, key, getOpts);
        if (n.resolution.status === 'none') throw new HttpError(404, 'not-found', `${key} has no record`, n.resolution.tried);
        return send(res, 200, { data: n });
      }
      const r = resolve(loaded, key);
      if (r.status === 'ok' || r.status === 'alias' || r.status === 'invalid') {
        return send(res, 200, { data: { ...row(r.rec), body: r.rec.body, sections: Object.fromEntries(r.rec.sections), via: r.status === 'alias' ? r.via : undefined } });
      }
      throw new HttpError(404, 'not-found', `${key} has no record`);
    }
    if (route === '/resolve') {
      const ref = url.searchParams.get('ref');
      if (!ref) throw new HttpError(400, 'bad-request', 'ref is required');
      const n = get(loaded, ref, getOpts);
      if (n.resolution.status === 'none') throw new HttpError(404, 'not-found', `${ref} resolves to nothing`, n.resolution.tried);
      return send(res, 200, { data: n });
    }
    if (route === '/tree') {
      const root = url.searchParams.get('root') ?? undefined;
      const nodes = tree(loaded, root);
      if (root && !nodes.length) throw new HttpError(404, 'not-found', `${root} is not a product or a feature`);
      return send(res, 200, { data: nodes });
    }
    if (route === '/activity') {
      const key = url.searchParams.get('key');
      if (!key) throw new HttpError(400, 'bad-request', 'key is required');
      const r = resolve(loaded, key);
      if (r.status !== 'ok' && r.status !== 'alias') throw new HttpError(404, 'not-found', `${key} has no record`);
      const days = url.searchParams.get('days');
      return send(res, 200, { data: activity(store, loaded, r.rec.key, { days: days ? Number(days) : undefined, since: url.searchParams.get('since') ?? undefined, ...asOf }) });
    }
    if (route === '/scope') {
      const q = url.searchParams;
      const days = q.get('days');
      return send(res, 200, { data: scope(store, loaded, { lens: q.get('lens') ?? undefined, node: q.get('node') ?? undefined, days: days ? Number(days) : undefined, done: q.get('done') === '1', retired: q.get('retired') === '1', ...asOf }) });
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
      return send(res, 200, { data: viewData(store, { session: decodeURIComponent(m[1]), ...getOpts }, loaded) });
    }
    if ((m = /^\/projects\/([a-z0-9][a-z0-9-]*)\/board$/.exec(route))) {
      return send(res, 200, { data: storeContext(store, { project: `project:${m[1]}` }) });
    }
    if ((m = /^\/products\/([a-z0-9][a-z0-9-]*)\/bridge$/.exec(route)) || route === '/bridge') {
      const days = url.searchParams.get('days');
      const product = m ? `product:${m[1]}` : (url.searchParams.get('product') ?? undefined);
      return send(res, 200, { data: bridge(store, loaded, { product, days: days ? Number(days) : undefined, ...asOf }) });
    }
    if (route === '/board') {
      return send(res, 200, { data: storeContext(store, { project: url.searchParams.get('project') ?? null }) });
    }
    if (route === '/events') {
      const sinceParam = url.searchParams.get('since') ?? req.headers['last-event-id'];
      const since = sinceParam ? Number(sinceParam) : 0;
      if ((req.headers.accept ?? '').includes('text/event-stream') || url.searchParams.get('stream') === '1') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
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
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (!url.pathname.startsWith('/api/v1')) throw new HttpError(404, 'not-found', 'the API is under /api/v1');
        const route = url.pathname.slice('/api/v1'.length).replace(/\/+$/, '') || '/';
        if (route === '/') return send(res, 200, { data: { version: 1, routes: ['/store', '/records', '/records/{kind}/{rest}', '/records/{kind}/{rest}/neighbourhood', '/resolve?ref=', '/refs?text=', '/intake?text=', '/tree?root=', '/activity?key=&days=', '/scope?lens=&node=&days=&done=&retired=', '/sessions/{id}/view', '/projects/{slug}/board', '/products/{slug}/bridge', '/bridge?product=&days=', '/events?since=&until=', 'POST /order {change, before|after|first|last|later}'], asOf: 'every read takes at=<event seq|instant> and answers as of that moment, stamped with the moment it resolved to' } });
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
