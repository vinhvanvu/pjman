import fs from 'node:fs';
import type { Store } from '../config.js';
import { loadStore, resolve, type Loaded, type Rec, type RecordType } from '../records.js';
import { CliError } from '../util.js';

export interface Row {
  type: RecordType;
  key: string;
  path: string;
  valid: boolean;
  title?: string;
  status?: string;
  created?: string;
  writer?: string;
  session?: string;
  data: Record<string, unknown>;
}

export function row(r: Rec): Row {
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    type: r.type, key: r.key, path: r.path, valid: r.valid,
    title: s(r.data.title), status: s(r.data.status), created: s(r.data.created),
    writer: s(r.data.writer), session: s(r.data.session), data: r.data,
  };
}

const TYPE_ALIASES: Record<string, RecordType> = {
  project: 'project', projects: 'project', change: 'change', changes: 'change', decision: 'decision', decisions: 'decision',
  source: 'source', sources: 'source', session: 'session', sessions: 'session', actor: 'actor', actors: 'actor',
};

export function ls(store: Store, opts: { type?: string; status?: string; project?: string }): Row[] {
  const loaded = loadStore(store);
  let recs = loaded.records;
  if (opts.type) {
    const t = TYPE_ALIASES[opts.type];
    if (!t) throw new CliError(`unknown type '${opts.type}' (project, change, decision, source, session, actor)`);
    recs = recs.filter((r) => r.type === t);
  }
  if (opts.status) recs = recs.filter((r) => r.data.status === opts.status);
  if (opts.project) recs = recs.filter((r) => r.type !== 'change' || r.data.project === opts.project);
  const typeOrder: RecordType[] = ['project', 'change', 'decision', 'source', 'session', 'actor'];
  const dateOf = (r: Rec) => r.fileDate ?? (typeof r.data.created === 'string' ? r.data.created : '');
  return [...recs]
    .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || dateOf(a).localeCompare(dateOf(b)) || a.key.localeCompare(b.key))
    .map(row);
}

export function formatLs(rows: Row[]): string {
  if (rows.length === 0) return '(no records)';
  const w = Math.min(48, Math.max(...rows.map((r) => r.key.length)));
  return rows
    .map((r) => `${r.type.padEnd(8)} ${r.key.padEnd(w)}  ${(r.status ?? '').padEnd(10)} ${r.title ?? (r.valid ? '' : '(invalid)')}`)
    .join('\n');
}

export function show(store: Store, key: string): { rec: Rec; text: string } {
  const loaded = loadStore(store);
  const res = resolve(loaded, key);
  if (res.status === 'ok' || res.status === 'alias' || res.status === 'invalid') {
    return { rec: res.rec, text: fs.readFileSync(res.rec.abs, 'utf8') };
  }
  if (res.status === 'malformed') throw new CliError(`'${key}' is not a key`);
  throw new CliError(`${key} has no record`);
}

// --- context ---------------------------------------------------------------

export interface ChangeContext {
  change: Row;
  summary?: string;
  plan?: string;
  sections: Record<string, string>;
  decisions: (Row & { decision?: string; why?: string; supersededBy?: string })[];
  sources: { key: string; record?: Row; via: 'binds' | 'links' }[];
  sessions: (Row & { last?: string })[];
}

export interface StoreContext {
  store: { name: string; mode: string; root: string };
  /** The project the board is scoped to, or null for the whole store. */
  project: Row | null;
  projects: Row[];
  changes: Row[];
  proposed: Row[];
  counts: Record<string, number>;
}

function sessionsOf(loaded: Loaded, changeKey: string): Rec[] {
  return loaded.records
    .filter((r) => r.type === 'session' && r.valid && Array.isArray(r.data.changes))
    .filter((r) => (r.data.changes as unknown[]).some((k) => {
      const res = typeof k === 'string' ? resolve(loaded, k) : null;
      return res && (res.status === 'ok' || res.status === 'alias') && res.rec.key === changeKey;
    }))
    .sort((a, b) => String(a.data.started).localeCompare(String(b.data.started)));
}

export function changeContext(store: Store, key: string): ChangeContext {
  const loaded = loadStore(store);
  const raw = key.startsWith('change:') ? key : `change:${key}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`${raw} does not resolve`);
  const rec = res.rec;
  const sections: Record<string, string> = {};
  for (const [k, v] of rec.sections) if (k && k !== 'Summary' && k !== 'Plan') sections[k] = v;
  let plan = rec.sections.get('Plan');
  const planFile = rec.abs.replace(/change\.md$/, 'plan.md');
  if (!plan && fs.existsSync(planFile)) plan = fs.readFileSync(planFile, 'utf8').trim();

  const supersededBy = new Map<string, string>();
  for (const r of loaded.records) {
    if (r.type !== 'decision' || typeof r.data.supersedes !== 'string') continue;
    const t = resolve(loaded, r.data.supersedes);
    if (t.status === 'ok' || t.status === 'alias') supersededBy.set(t.rec.key, r.key);
  }
  const decisions = loaded.records
    .filter((r) => r.type === 'decision' && r.changeSlug === rec.changeSlug)
    .sort((a, b) => (a.fileDate! + a.path).localeCompare(b.fileDate! + b.path))
    .map((r) => ({ ...row(r), decision: r.sections.get('Decision'), why: r.sections.get('Why'), supersededBy: supersededBy.get(r.key) }));

  const sources: ChangeContext['sources'] = [];
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  for (const via of ['binds', 'links'] as const) {
    for (const k of list(rec.data[via])) {
      const r = resolve(loaded, k);
      sources.push({ key: k, via, record: r.status === 'ok' || r.status === 'alias' || r.status === 'invalid' ? row(r.rec) : undefined });
    }
  }
  const sessions = sessionsOf(loaded, rec.key).map((r) => {
    const log = r.sections.get('Log') ?? '';
    const lines = log.split('\n').filter((l) => l.trim());
    return { ...row(r), last: lines.length ? lines[lines.length - 1].replace(/^-\s*/, '').replace(/^\S+Z\s+—\s+/, '') : undefined };
  });
  return { change: row(rec), summary: rec.sections.get('Summary'), plan, sections, decisions, sources, sessions };
}

/** "decided by X on Y", "superseded by Z (decided by X on Y)", "proposed", "reverted (decided by X on Y)". */
export function decisionLine(dec: Row & { supersededBy?: string }): string {
  const by = dec.data.decided_by ? `decided by ${String(dec.data.decided_by)}${dec.data.decided_on ? ` on ${String(dec.data.decided_on)}` : ''}` : '';
  const parts: string[] = [];
  if (dec.status === 'decided') parts.push(by || 'decided');
  else if (dec.status === 'superseded') parts.push(`superseded${dec.supersededBy ? ` by ${dec.supersededBy}` : ''}${by ? ` (${by})` : ''}`);
  else if (dec.status === 'reverted') parts.push(`reverted${by ? ` (${by})` : ''}`);
  else parts.push(dec.status ?? '?');
  if (dec.data.supersedes) parts.push(`supersedes ${String(dec.data.supersedes)}`);
  return parts.join('; ');
}

export function formatChangeContext(c: ChangeContext): string {
  const out: string[] = [];
  const d = c.change.data;
  out.push(`# ${c.change.key} — ${c.change.title ?? ''}`);
  out.push(`status: ${c.change.status ?? '?'}${d.project ? `\nproject: ${String(d.project)}` : ''}${d.next ? `\nnext: ${String(d.next)}` : ''}`);
  if (c.summary) out.push(`\n## Summary\n\n${c.summary}`);
  if (c.plan) out.push(`\n## Plan\n\n${c.plan}`);
  for (const [k, v] of Object.entries(c.sections)) if (v) out.push(`\n## ${k}\n\n${v}`);
  if (c.decisions.length) {
    out.push('\n## Decisions');
    for (const dec of c.decisions) {
      out.push(`\n### ${dec.key} — ${dec.title ?? ''}\n${decisionLine(dec)}`);
      if (dec.decision) out.push(`\n${dec.decision}`);
      if (dec.why) out.push(`\nWhy: ${dec.why}`);
    }
  }
  if (c.sources.length) {
    out.push('\n## Sources');
    for (const s of c.sources) {
      const t = s.record?.title ? ` — ${s.record.title}` : '';
      const u = typeof s.record?.data.url === 'string' ? ` (${s.record.data.url})` : '';
      out.push(`- ${s.via} ${s.key}${t}${u}`);
    }
  }
  if (c.sessions.length) {
    out.push('\n## Sessions');
    for (const s of c.sessions.slice(-5)) {
      out.push(`- ${String(s.data.started).slice(0, 10)} ${s.key} ${String(s.data.agent)} for ${String(s.data.on_behalf_of)}${s.last ? ` — ${s.last}` : ''}`);
    }
  }
  return out.join('\n') + '\n';
}

/** The board: the open changes of one project (`opts.project`), or of the whole store. */
export function storeContext(store: Store, opts: { project?: string | null } = {}): StoreContext {
  const loaded = loadStore(store);
  const counts: Record<string, number> = {};
  for (const r of loaded.records) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const projects = loaded.records.filter((r) => r.type === 'project').map(row);
  let project: Row | null = null;
  if (opts.project) {
    const res = resolve(loaded, opts.project.startsWith('project:') ? opts.project : `project:${opts.project}`);
    if (res.status !== 'ok') throw new CliError(`${opts.project} does not resolve to a project`);
    project = row(res.rec);
  }
  const changes = loaded.records
    .filter((r) => r.type === 'change' && r.data.status !== 'done' && r.data.status !== 'dropped')
    .filter((r) => !project || r.data.project === project.key)
    .map(row);
  const proposed = loaded.records
    .filter((r) => r.type === 'decision' && r.data.status === 'proposed')
    .filter((r) => !project || !r.changeSlug || loaded.byKey.get(`change:${r.changeSlug}`)?.[0]?.data.project === project.key)
    .map(row);
  return { store: { name: store.config.name, mode: store.mode, root: store.root }, project, projects, changes, proposed, counts };
}

export function formatStoreContext(c: StoreContext): string {
  const head = c.project
    ? `# ${c.project.key} — ${c.project.title ?? ''} (${c.store.name} store)`
    : `# ${c.store.name} (${c.store.mode} store)${c.projects.length ? `\nprojects: ${c.projects.map((p) => p.key).join(', ')}` : ''}`;
  const out: string[] = [head];
  const tag = (r: Row) => (!c.project && r.data.project ? ` [${String(r.data.project)}]` : '');
  const order = ['active', 'blocked', 'review', 'planning', 'open'];
  const groups = new Map<string, Row[]>();
  for (const r of c.changes) groups.set(r.status ?? '?', [...(groups.get(r.status ?? '?') ?? []), r]);
  for (const s of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
    const rows = groups.get(s);
    if (!rows?.length) continue;
    out.push(`\n## ${s}`);
    for (const r of rows) out.push(`- ${r.key} — ${r.title ?? ''}${tag(r)}${r.data.next ? `\n  next: ${String(r.data.next)}` : ''}`);
  }
  if (c.project && c.projects.length > 1) out.push(`\nother projects: ${c.projects.filter((p) => p.key !== c.project!.key).map((p) => p.key).join(', ')} (pjman context --all)`);
  if (c.proposed.length) {
    out.push('\n## proposed decisions');
    for (const r of c.proposed) out.push(`- ${r.key} — ${r.title ?? ''}`);
  }
  out.push(`\n${Object.entries(c.counts).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ') || 'no records'}`);
  return out.join('\n') + '\n';
}
