// A synthetic store at any size, in the store's own layout, for the scale bench (change:dashboard-reads-slow). One
// unit is about the size of this project's own record (a product of ~600 records and ~4,000 events); `scale` units
// are written as that many products, so a 100x store holds what a large organization's would. Deterministic: the
// same scale writes the same store.
import fs from 'node:fs';
import path from 'node:path';

export interface GenerateOpts {
  /** How many units: one product with its features, changes, decisions and sessions, and their events. */
  scale: number;
  features?: number;
  changes?: number;
  sessions?: number;
  /** Events per change, on average. */
  eventsPerChange?: number;
}

export interface Generated {
  root: string;
  records: number;
  events: number;
  /** A product, a feature, a change, a decision and a session to read, all in the first unit. */
  sample: { product: string; feature: string; change: string; milestone: string; decision: string; session: string };
}

const STATUSES = ['done', 'done', 'done', 'done', 'done', 'active', 'planning', 'planning', 'review', 'blocked', 'dropped', 'open'];

/** A small deterministic generator, so a run is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const yamlList = (name: string, items: string[]) => (items.length ? `${name}:\n${items.map((i) => `  - ${i}`).join('\n')}\n` : '');
const uuid = (u: number, i: number) => `${String(u).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;

export function generateStore(root: string, opts: GenerateOpts): Generated {
  const F = opts.features ?? 60;
  const C = opts.changes ?? 140;
  const S = opts.sessions ?? 90;
  const E = opts.eventsPerChange ?? 25;
  const rand = rng(7);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  fs.rmSync(root, { recursive: true, force: true });
  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('pjman.yaml', 'name: bench\nlayers:\n  - core\n  - sources\n  - work\ntree_levels:\n  - feature\n  - capability\nversion: 0.2.0\n');
  write('actors/person-bench.md', '---\nkind: person\nname: Bench\nwriter: person:bench\ncreated: 2026-01-01\n---\n');

  let records = 1;
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  const span = Date.parse('2026-11-01T00:00:00.000Z') - base;
  const at = (t: number) => new Date(base + Math.floor(t * span)).toISOString();
  const stamps: { t: number; line: Omit<Record<string, unknown>, 'seq'> }[] = [];
  const event = (t: number, e: Record<string, unknown>) => stamps.push({ t, line: { at: at(t), ...e, writer: 'person:bench' } });

  for (let u = 0; u < opts.scale; u++) {
    const p = u === 0 ? 'bench' : `bench-${u}`;
    const project = `project:${p}`;
    write(`projects/${p}.md`, `---\ntitle: ${p}\nproduct: product:${p}\nwriter: person:bench\ncreated: 2026-01-01\n---\n`);
    const features: string[] = [];
    for (let f = 0; f < F; f++) {
      const slug = `feature-${f}`;
      const top = f < 8;
      const parent = top ? `product: product:${p}` : `parent: feature:${p}/feature-${Math.floor(rand() * Math.min(f, 8 + (f - 8) / 2))}`;
      write(`products/${p}/features/${slug}/feature.md`, `---\ntitle: What feature ${f} does for a person\nname: Feature ${f}\n${parent}\nwriter: person:bench\ncreated: 2026-01-01\n---\n\n## Summary\n\nFeature ${f} of ${p}.\n`);
      features.push(`feature:${p}/${slug}`);
      event(0, { op: 'created', key: `feature:${p}/${slug}`, type: 'feature', path: `products/${p}/features/${slug}/feature.md` });
    }
    const changes: string[] = [];
    const milestones = Math.max(1, Math.floor(C / 12));
    for (let c = 0; c < C; c++) {
      const slug = `change-${c}`;
      const key = `change:${p}/${slug}`;
      const status = c < milestones ? pick(['active', 'planning', 'done']) : pick(STATUSES);
      // the first changes are the milestones, by their kind, with no plan of their own; the rest may file under one
      const parent = c < milestones ? 'kind: milestone\n' : rand() < 0.5 ? `parent: change:${p}/change-${Math.floor(rand() * milestones)}\n` : '';
      const named = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => `${pick(['adds ', '', '', 'removes '])}${pick(features)}`.replace(/^removes /, rand() < 0.9 ? '' : 'removes '));
      const deps = c > 0 && rand() < 0.15 ? [`change:${p}/change-${Math.floor(rand() * c)}`] : [];
      const steps = 2 + Math.floor(rand() * 6);
      const plan = Array.from({ length: steps }, (_, i) => {
        const state = status === 'done' || (status !== 'planning' && i < steps / 2) ? 'done' : status === 'active' && i === Math.floor(steps / 2) ? 'active' : 'open';
        return `  - text: Step ${i + 1} of change ${c}, said as the work it is\n    state: ${state}\n`;
      }).join('');
      const created = at(c / C);
      write(`products/${p}/changes/${slug}/change.md`, `---\nname: Change ${c}\ngist: What change ${c} does, in one line\nstatus: ${status}\nproject: ${project}\n${parent}${yamlList('depends_on', deps)}${yamlList('features', named)}${c < milestones ? '' : `plan:\n${plan}`}writer: person:bench\ncreated: ${created.slice(0, 10)}\n---\n\n## Origin\n\n> The request for change ${c}, as it was said.\n\n## Intent\n\nWhat change ${c} is for, at some length so the body weighs what a real one does. ${'The work reads as the work. '.repeat(20)}\n\n## Done when\n\nChange ${c} is done when its steps are.\n`);
      changes.push(key);
      const t0 = c / C;
      event(t0, { op: 'created', key, type: 'change', path: `products/${p}/changes/${slug}/change.md` });
      for (let e = 1; e < E; e++) {
        const t = Math.min(0.999, t0 + rand() * (1 - t0) * 0.3);
        const moved = e % 6 === 0;
        event(t, { op: 'set', key, type: 'change', path: `products/${p}/changes/${slug}/change.md`, fields: moved ? ['status'] : ['plan', 'step done'], ...(moved ? { value: status } : {}) });
      }
      for (let d = 0; d < (rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0); d++) {
        const dslug = `decision-${d}`;
        const proposed = status !== 'done' && rand() < 0.4;
        write(`products/${p}/changes/${slug}/decisions/2026-06-01-${dslug}.md`, `---\nname: Decision ${d}\ngist: What is decided for change ${c}\nstatus: ${proposed ? 'proposed' : 'decided'}\n${proposed ? '' : 'decided_by: person:bench\ndecided_on: 2026-06-02\n'}thread:\n  - type: question\n    at: ${created}\n    by: person:bench\n    text: Which way for change ${c}?\n  - type: option\n    at: ${created}\n    by: person:bench\n    id: a\n    text: The first way\n    case: |-\n      One point\n      Another point\n  - type: option\n    at: ${created}\n    by: person:bench\n    id: b\n    text: The second way\n  - type: recommend\n    at: ${created}\n    by: person:bench\n    id: a\n    text: It is the simpler\n${proposed ? '' : `  - type: accept\n    at: ${created}\n    by: person:bench\n    option: a\n`}writer: person:bench\ncreated: 2026-06-01\n---\n`);
        event(t0, { op: 'created', key: `decision:${p}/${slug}/${dslug}`, type: 'decision', path: `products/${p}/changes/${slug}/decisions/2026-06-01-${dslug}.md` });
        records++;
      }
    }
    write(`products/${p}/product.md`, `---\ntitle: ${p}\nname: ${p}\nowners:\n  - person:bench\n${yamlList('sequence', changes.filter(() => rand() < 0.12))}writer: person:bench\ncreated: 2026-01-01\n---\n\n## Summary\n\nThe product ${p}.\n`);
    for (let s = 0; s < S; s++) {
      const id = uuid(u, s);
      const on = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(changes));
      const t = s / S;
      const observed = Array.from({ length: 10 + Math.floor(rand() * 30) }, (_, i) => `  - edge: links\n    from: ${on[0]}\n    to: file:src/file-${i}.ts\n    at: ${at(t)}\n`).join('');
      write(`sessions/2026-06-01-${id}.md`, `---\nagent: agent:bench\non_behalf_of: person:bench\nstarted: ${at(t)}\nproject: ${project}\n${yamlList('changes', [...new Set(on)])}observed:\n${observed}writer: agent:bench\ncreated: 2026-06-01\n---\n\n## Log\n\n${Array.from({ length: 8 }, (_, i) => `- ${at(t)} — line ${i} of what the session did`).join('\n')}\n`);
      event(t, { op: 'created', key: `session:${id}`, type: 'session', path: `sessions/2026-06-01-${id}.md` });
      for (const c of on) event(t, { op: 'bind', key: `session:${id}`, type: 'session', path: `sessions/2026-06-01-${id}.md`, value: c });
      for (let l = 0; l < 6; l++) event(Math.min(0.999, t + l * 0.0005), { op: 'log', key: `session:${id}`, type: 'session', path: `sessions/2026-06-01-${id}.md`, fields: ['log'] });
    }
    records += 1 + 1 + F + C + S;
  }
  stamps.sort((a, b) => a.t - b.t);
  write('events.jsonl', stamps.map((s, i) => JSON.stringify({ seq: i + 1, ...s.line })).join('\n') + '\n');
  return {
    root,
    records,
    events: stamps.length,
    sample: { product: 'product:bench', feature: 'feature:bench/feature-3', change: `change:bench/change-${Math.max(1, Math.floor(C / 12))}`, milestone: 'change:bench/change-0', decision: 'decision:bench/change-0/decision-0', session: `session:${uuid(0, 0)}` },
  };
}
