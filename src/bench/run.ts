// The scale bench (change:dashboard-reads-slow): a generated store at each scale, every read route asked through the
// server as the dashboard asks it (first and again), and the CLI's cold calls as a hook makes them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { openStore } from '../config.js';
import { loadStore } from '../records.js';
import { createServer } from '../server.js';
import { generateStore, type Generated } from './generate.js';

export interface Timing {
  name: string;
  ms: number;
}

export interface BenchResult {
  scale: number;
  records: number;
  events: number;
  timings: Timing[];
}

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pjman.js');

/** The reads the dashboard and the CLI make, by name, against the generated store's sample. */
export function routes(g: Generated): [string, string][] {
  const s = g.sample;
  const product = s.product.slice('product:'.length);
  return [
    ['store', '/store'],
    ['bridge', `/products/${product}/bridge`],
    ['map', `/scope?lens=feature&key=${s.product}`],
    ['roadmap', `/scope?lens=roadmap&key=${s.product}&done=1`],
    ['change page', `/scope?key=${s.change}`],
    ['milestone page', `/scope?key=${s.milestone}`],
    ['feature page', `/scope?lens=feature&key=${s.feature}`],
    ['session view', `/sessions/${s.session.slice('session:'.length)}/view`],
    ['rail', `/rail?key=${s.product}&limit=50`],
    ['tree', `/tree?key=${s.product}`],
    ['records', '/records?type=change'],
    ['record', `/records/${s.change.replace(':', '/')}`],
    ['timeline', `/products/${product}/timeline`],
  ];
}

function get(port: number, route: string): Promise<number> {
  return new Promise((res, rej) => {
    const t = performance.now();
    http
      .get({ host: '127.0.0.1', port, path: `/api/v1${route}`, headers: { host: 'localhost' } }, (r) => {
        r.resume();
        r.on('end', () => (r.statusCode === 200 ? res(performance.now() - t) : rej(new Error(`${route}: ${r.statusCode}`))));
      })
      .on('error', rej);
  });
}

/** Time every route through a server on the store: the first read, then the same read again with no write between. */
export async function benchServer(g: Generated): Promise<Timing[]> {
  const store = openStore(g.root);
  const server = createServer(store, { staticDir: null });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const out: Timing[] = [];
  try {
    for (const [name, route] of routes(g)) {
      out.push({ name, ms: await get(port, route) });
      out.push({ name: `${name} again`, ms: await get(port, route) });
    }
  } finally {
    server.close();
  }
  return out;
}

/** Time the CLI's cold calls: a fresh process each, as a hook runs it. */
export function benchCli(g: Generated): Timing[] {
  const env = { ...process.env, PJMAN_STORE: g.root, PJMAN_SESSION: '', PJMAN_WRITER: 'person:bench' };
  const run = (args: string[]) => {
    const t = performance.now();
    execFileSync(process.execPath, [bin, ...args], { env, stdio: 'ignore' });
    return performance.now() - t;
  };
  return [
    { name: 'cli show', ms: run(['show', g.sample.change]) },
    { name: 'cli context', ms: run(['context', g.sample.change]) },
    { name: 'cli get', ms: run(['get', g.sample.change]) },
  ];
}

export async function bench(root: string, scale: number, opts: { cli?: boolean } = {}): Promise<BenchResult> {
  // the bench's indexes live beside its stores, never in the person's pjman folder
  process.env.PJMAN_HOME = `${root}.home`;
  fs.rmSync(process.env.PJMAN_HOME, { recursive: true, force: true });
  const g = generateStore(root, { scale });
  const timings: Timing[] = [];
  // the first read builds the index, as the first command after an install does
  const store = openStore(g.root);
  let t = performance.now();
  loadStore(store);
  timings.push({ name: 'index built', ms: performance.now() - t });
  t = performance.now();
  loadStore(store);
  timings.push({ name: 'load from index', ms: performance.now() - t });
  timings.push(...(await benchServer(g)));
  if (opts.cli !== false) timings.push(...benchCli(g));
  return { scale, records: g.records, events: g.events, timings };
}
