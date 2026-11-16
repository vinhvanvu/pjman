// The scale budget (change:dashboard-reads-slow): a generated store ten times this project's own, every read the
// dashboard makes asked through the server, and the CLI's cold calls. The budgets sit well above what these reads take
// on a laptop and far below what a scan per node or a parse per read costs, so a regression of either kind fails here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { set } from '../ops/set.js';
import { createServer } from '../server/server.js';

interface Timing {
  name: string;
  ms: number;
}

type Generated = ReturnType<typeof generateStore>;

// --- the generated store ---------------------------------------------------------------------------------------------

const STATUSES = [
  'done',
  'done',
  'done',
  'done',
  'done',
  'active',
  'planning',
  'planning',
  'review',
  'blocked',
  'dropped',
  'open',
];

/** A small deterministic generator, so a run is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const yamlList = (name: string, items: string[]) =>
  items.length ? `${name}:\n${items.map((i) => `  - ${i}`).join('\n')}\n` : '';
const uuid = (u: number, i: number) => `${String(u).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** A synthetic store in the store's own layout: `scale` products the size of this project's own record (about 600
 *  records and 4,000 events each). Deterministic: the same scale writes the same store. */
function generateStore(root: string, scale: number) {
  const F = 60;
  const C = 140;
  const S = 90;
  const E = 25;
  const rand = rng(7);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  fs.rmSync(root, { recursive: true, force: true });
  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(
    'pjman.yaml',
    'name: bench\nlayers:\n  - core\n  - sources\n  - work\ntree_levels:\n  - feature\n  - capability\nversion: 0.2.0\n',
  );
  write('actors/person-bench.md', '---\nkind: person\nname: Bench\nwriter: person:bench\ncreated: 2026-01-01\n---\n');

  let records = 1;
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const span = Date.parse('2026-11-01T00:00:00.000Z') - base;
  const at = (t: number) => new Date(base + Math.floor(t * span)).toISOString();
  const stamps: { t: number; line: Omit<Record<string, unknown>, 'seq'> }[] = [];
  const event = (t: number, e: Record<string, unknown>) =>
    stamps.push({ t, line: { at: at(t), ...e, writer: 'person:bench' } });

  for (let u = 0; u < scale; u++) {
    const p = u === 0 ? 'bench' : `bench-${u}`;
    const project = `project:${p}`;
    write(
      `projects/${p}.md`,
      `---\ntitle: ${p}\nproduct: product:${p}\nwriter: person:bench\ncreated: 2026-01-01\n---\n`,
    );
    const features: string[] = [];
    for (let f = 0; f < F; f++) {
      const slug = `feature-${f}`;
      const top = f < 8;
      const parent = top
        ? `product: product:${p}`
        : `parent: feature:${p}/feature-${Math.floor(rand() * Math.min(f, 8 + (f - 8) / 2))}`;
      write(
        `products/${p}/features/${slug}/feature.md`,
        `---\ntitle: What feature ${f} does for a person\nname: Feature ${f}\n${parent}\nwriter: person:bench\ncreated: 2026-01-01\n---\n\n## Summary\n\nFeature ${f} of ${p}.\n`,
      );
      features.push(`feature:${p}/${slug}`);
      event(0, {
        op: 'created',
        key: `feature:${p}/${slug}`,
        type: 'feature',
        path: `products/${p}/features/${slug}/feature.md`,
      });
    }
    const changes: string[] = [];
    const milestones = Math.max(1, Math.floor(C / 12));
    for (let c = 0; c < C; c++) {
      const slug = `change-${c}`;
      const key = `change:${p}/${slug}`;
      const status = c < milestones ? pick(['active', 'planning', 'done']) : pick(STATUSES);
      // the first changes are the milestones, by their kind, with no plan of their own; the rest may file under one
      const parent =
        c < milestones
          ? 'kind: milestone\n'
          : rand() < 0.5
            ? `parent: change:${p}/change-${Math.floor(rand() * milestones)}\n`
            : '';
      const named = Array.from({ length: 1 + Math.floor(rand() * 2) }, () =>
        `${pick(['adds ', '', '', 'removes '])}${pick(features)}`.replace(/^removes /, rand() < 0.9 ? '' : 'removes '),
      );
      const deps = c > 0 && rand() < 0.15 ? [`change:${p}/change-${Math.floor(rand() * c)}`] : [];
      const steps = 2 + Math.floor(rand() * 6);
      const plan = Array.from({ length: steps }, (_, i) => {
        const state =
          status === 'done' || (status !== 'planning' && i < steps / 2)
            ? 'done'
            : status === 'active' && i === Math.floor(steps / 2)
              ? 'active'
              : 'open';
        return `  - text: Step ${i + 1} of change ${c}, said as the work it is\n    state: ${state}\n`;
      }).join('');
      const created = at(c / C);
      write(
        `products/${p}/changes/${slug}/change.md`,
        `---\nname: Change ${c}\ngist: What change ${c} does, in one line\nstatus: ${status}\nproject: ${project}\n${parent}${yamlList('depends_on', deps)}${yamlList('features', named)}${c < milestones ? '' : `plan:\n${plan}`}writer: person:bench\ncreated: ${created.slice(0, 10)}\n---\n\n## Origin\n\n> The request for change ${c}, as it was said.\n\n## Intent\n\nWhat change ${c} is for, at some length so the body weighs what a real one does. ${'The work reads as the work. '.repeat(20)}\n\n## Done when\n\nChange ${c} is done when its steps are.\n`,
      );
      changes.push(key);
      const t0 = c / C;
      event(t0, { op: 'created', key, type: 'change', path: `products/${p}/changes/${slug}/change.md` });
      for (let e = 1; e < E; e++) {
        const t = Math.min(0.999, t0 + rand() * (1 - t0) * 0.3);
        const moved = e % 6 === 0;
        event(t, {
          op: 'set',
          key,
          type: 'change',
          path: `products/${p}/changes/${slug}/change.md`,
          fields: moved ? ['status'] : ['plan', 'step done'],
          ...(moved ? { value: status } : {}),
        });
      }
      for (let d = 0; d < (rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0); d++) {
        const dslug = `decision-${d}`;
        const proposed = status !== 'done' && rand() < 0.4;
        write(
          `products/${p}/changes/${slug}/decisions/2026-06-01-${dslug}.md`,
          `---\nname: Decision ${d}\ngist: What is decided for change ${c}\nstatus: ${proposed ? 'proposed' : 'decided'}\n${proposed ? '' : 'decided_by: person:bench\ndecided_on: 2026-06-02\n'}thread:\n  - type: question\n    at: ${created}\n    by: person:bench\n    text: Which way for change ${c}?\n  - type: option\n    at: ${created}\n    by: person:bench\n    id: a\n    text: The first way\n    case: |-\n      One point\n      Another point\n  - type: option\n    at: ${created}\n    by: person:bench\n    id: b\n    text: The second way\n  - type: recommend\n    at: ${created}\n    by: person:bench\n    id: a\n    text: It is the simpler\n${proposed ? '' : `  - type: accept\n    at: ${created}\n    by: person:bench\n    option: a\n`}writer: person:bench\ncreated: 2026-06-01\n---\n`,
        );
        event(t0, {
          op: 'created',
          key: `decision:${p}/${slug}/${dslug}`,
          type: 'decision',
          path: `products/${p}/changes/${slug}/decisions/2026-06-01-${dslug}.md`,
        });
        records++;
      }
    }
    write(
      `products/${p}/product.md`,
      `---\ntitle: ${p}\nname: ${p}\n${yamlList(
        'sequence',
        changes.filter(() => rand() < 0.12),
      )}writer: person:bench\ncreated: 2026-01-01\n---\n\n## Summary\n\nThe product ${p}.\n`,
    );
    for (let s = 0; s < S; s++) {
      const id = uuid(u, s);
      const on = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(changes));
      const t = s / S;
      const observed = Array.from(
        { length: 10 + Math.floor(rand() * 30) },
        (_, i) => `  - edge: links\n    from: ${on[0]}\n    to: file:src/file-${i}.ts\n    at: ${at(t)}\n`,
      ).join('');
      write(
        `sessions/2026-06-01-${id}.md`,
        `---\nagent: agent:bench\nstarted: ${at(t)}\nproject: ${project}\n${yamlList('changes', [...new Set(on)])}observed:\n${observed}writer: agent:bench\ncreated: 2026-06-01\n---\n\n## Log\n\n${Array.from({ length: 8 }, (_, i) => `- ${at(t)} — line ${i} of what the session did`).join('\n')}\n`,
      );
      event(t, { op: 'created', key: `session:${id}`, type: 'session', path: `sessions/2026-06-01-${id}.md` });
      for (const c of on)
        event(t, { op: 'bind', key: `session:${id}`, type: 'session', path: `sessions/2026-06-01-${id}.md`, value: c });
      for (let l = 0; l < 6; l++)
        event(Math.min(0.999, t + l * 0.0005), {
          op: 'log',
          key: `session:${id}`,
          type: 'session',
          path: `sessions/2026-06-01-${id}.md`,
          fields: ['log'],
        });
    }
    records += 1 + 1 + F + C + S;
  }
  stamps.sort((a, b) => a.t - b.t);
  write('events.jsonl', stamps.map((s, i) => JSON.stringify({ seq: i + 1, ...s.line })).join('\n') + '\n');
  return {
    root,
    records,
    events: stamps.length,
    sample: {
      product: 'product:bench',
      feature: 'feature:bench/feature-3',
      change: `change:bench/change-${Math.max(1, Math.floor(C / 12))}`,
      milestone: 'change:bench/change-0',
      decision: 'decision:bench/change-0/decision-0',
      session: `session:${uuid(0, 0)}`,
    },
  };
}

// --- the reads ------------------------------------------------------------------------------------------------------

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'pjman.js');

/** The reads the dashboard and the CLI make, by name, against the generated store's sample. */
function routes(g: Generated): [string, string][] {
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
        r.on('end', () =>
          r.statusCode === 200 ? res(performance.now() - t) : rej(new Error(`${route}: ${r.statusCode}`)),
        );
      })
      .on('error', rej);
  });
}

/** Time every route through a server on the store: the first read, then the same read again with no write between. */
async function benchServer(g: Generated): Promise<Timing[]> {
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
    // a write, as a session or an accept makes one, then each page as it is asked again after it
    const t = performance.now();
    set(store, g.sample.change, [`gist=Written at ${new Date().toISOString()}`], {});
    out.push({ name: 'a write', ms: performance.now() - t });
    for (const [name, route] of routes(g)) out.push({ name: `${name} after a write`, ms: await get(port, route) });
  } finally {
    server.close();
  }
  return out;
}

/** Time the CLI's cold calls: a fresh process each, as a hook runs it. */
function benchCli(g: Generated): Timing[] {
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

async function bench(root: string, scale: number): Promise<Timing[]> {
  // the generated store's index lives beside it, never in the person's pjman folder
  process.env.PJMAN_HOME = `${root}.home`;
  process.env.PJMAN_WRITER = 'person:bench';
  fs.rmSync(process.env.PJMAN_HOME, { recursive: true, force: true });
  const g = generateStore(root, scale);
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
  timings.push(...benchCli(g));
  return timings;
}

const BUDGET = {
  /** A read asked again with nothing written between: served from the held store and its lookups. */
  again: 150,
  /** A read after a write: the store loaded again from the index and the page's lookups built again. */
  afterWrite: 1000,
  /** A cold CLI call, as a hook makes one: the process, the index, the command. */
  cli: 2000,
};

test('at ten times this project, every read stays inside its budget', { timeout: 300_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-scale-'));
  const home = process.env.PJMAN_HOME;
  try {
    const timings = await bench(path.join(root, 'x10'), 10);
    const over = timings.filter((t) => {
      if (t.name.endsWith(' again')) return t.ms > BUDGET.again;
      if (t.name.endsWith(' after a write')) return t.ms > BUDGET.afterWrite;
      if (t.name.startsWith('cli ')) return t.ms > BUDGET.cli;
      return false;
    });
    assert.deepEqual(
      over.map((t) => `${t.name}: ${t.ms.toFixed(0)}ms`),
      [],
    );
  } finally {
    if (home === undefined) delete process.env.PJMAN_HOME;
    else process.env.PJMAN_HOME = home;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
