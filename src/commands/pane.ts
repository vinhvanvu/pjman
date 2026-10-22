import type { Store } from '../config.js';
import { follow, lastSeq } from '../events.js';
import { get, type GetOpts, type Neighbourhood } from '../graph.js';
import { loadStore, resolve, type Loaded } from '../records.js';
import { CliError } from '../util.js';
import { decisionLine, storeContext, type ChangeContext, type Row } from './view.js';

export interface ViewOpts extends GetOpts {
  /** A reference to show, and not follow. */
  ref?: string;
  /** A session to follow: its last bound change, else the project's board. */
  session?: string;
}

export interface View {
  markdown: string;
  /** What the document shows: the key rendered, and the session followed when one was. */
  showing: { key?: string; session?: string; board?: string | null };
}

const MARK: Record<string, string> = { proposed: '○', decided: '●', superseded: '◌', reverted: '⊘' };

function esc(s: unknown): string {
  return String(s ?? '').replace(/\|/g, '\\|');
}

function link(key: string, url?: unknown, title?: unknown): string {
  const label = title ? `${key} — ${esc(title)}` : key;
  return typeof url === 'string' ? `[${label}](${url})` : `\`${key}\`${title ? ` — ${esc(title)}` : ''}`;
}

function changeDoc(c: ChangeContext, loaded: Loaded): string[] {
  const out: string[] = [];
  const d = c.change.data;
  out.push(`# ${c.change.key}`);
  out.push(`## ${esc(c.change.title)}`);
  const facts: string[] = [`**${c.change.status ?? '?'}**`];
  if (typeof d.project === 'string') facts.push(d.project);
  if (c.parent) facts.push(`part of \`${c.parent.key}\``);
  for (const s of c.sources.filter((s) => s.via === 'binds')) facts.push(`binds ${link(s.key, s.record?.data.url)}`);
  out.push(facts.join(' · '));
  if (d.next) out.push(`\n> **next:** ${esc(d.next)}`);
  if (c.summary) out.push(`\n${c.summary}`);
  if (c.plan) out.push(`\n### Plan\n\n${c.plan}`);
  if (c.decisions.length) {
    out.push('\n### Decisions');
    for (const dec of c.decisions) {
      const slug = dec.key.slice(dec.key.indexOf('/') + 1);
      out.push(`- ${MARK[dec.status ?? ''] ?? '•'} **${esc(dec.title)}** \`${slug}\` — ${decisionLine(dec)}`);
    }
  }
  if (c.children.length) {
    out.push('\n### Children');
    for (const ch of c.children) out.push(`- \`${ch.key}\` **${ch.status ?? '?'}** — ${esc(ch.title)}`);
  }
  const links = c.sources.filter((s) => s.via === 'links');
  if (links.length) {
    out.push('\n### Sources');
    for (const s of links) out.push(`- ${link(s.key, s.record?.data.url, s.record?.title)}`);
  }
  if (c.observed.length) {
    out.push('\n### Files touched');
    for (const o of c.observed) out.push(`- \`${o.to.replace(/^file:/, '')}\`${o.at ? ` · ${o.at.slice(0, 10)}` : ''}`);
  }
  if (c.sessions.length) {
    out.push('\n### Sessions');
    for (const s of c.sessions.slice(-5)) {
      const rec = loaded.byKey.get(s.key)?.[0];
      const log = (rec?.sections.get('Log') ?? '').split('\n').filter((l) => l.trim()).length;
      out.push(`- ${String(s.data.started).slice(0, 10)} \`${s.key.slice(0, 16)}\` ${String(s.data.agent)} for ${String(s.data.on_behalf_of)} · ${log} log line${log === 1 ? '' : 's'}${s.last ? `\n  - ${esc(s.last)}` : ''}`);
    }
  }
  return out;
}

function boardDoc(store: Store, project: string | null): string[] {
  const c = storeContext(store, { project });
  const out: string[] = [c.project ? `# ${c.project.key}` : `# ${c.store.name}`];
  if (c.project?.title) out.push(`## ${esc(c.project.title)}`);
  const order = ['active', 'blocked', 'review', 'planning', 'open'];
  const groups = new Map<string, Row[]>();
  for (const r of c.changes) groups.set(r.status ?? '?', [...(groups.get(r.status ?? '?') ?? []), r]);
  for (const s of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
    const rows = groups.get(s);
    if (!rows?.length) continue;
    out.push(`\n### ${s}`);
    for (const r of rows) out.push(`- \`${r.key}\` — ${esc(r.title)}${!c.project && r.data.project ? ` · ${String(r.data.project)}` : ''}${r.data.next ? `\n  - next: ${esc(r.data.next)}` : ''}`);
  }
  if (c.proposed.length) {
    out.push('\n### Proposed decisions');
    for (const r of c.proposed) out.push(`- ○ \`${r.key}\` — ${esc(r.title)}`);
  }
  return out;
}

function neighbourhoodDoc(n: Neighbourhood, loaded: Loaded): string[] {
  const r = n.resolution;
  if (r.status === 'none') return [`# ${esc(n.input)}`, `\nresolves to nothing; tried: ${r.tried.join('; ')}`];
  const out: string[] = [];
  if (n.record?.type === 'change') {
    const c = n.changes.find((c) => c.change.key === n.record!.key);
    if (c) out.push(...changeDoc(c, loaded));
  } else {
    out.push(`# ${r.key}`);
    if (n.record) out.push(`## ${esc(n.record.title ?? n.record.type)}${n.record.status ? ` · ${n.record.status}` : ''}`);
    else out.push(`_${r.status === 'key' ? 'a source key with no record' : r.status}_`);
    const cite = n.in.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
    const refs = n.out.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
    if (cite.length) out.push(`\n### Referenced by\n${cite.map((e) => `- ${e.edge} \`${e.from}\`${e.observed ? ' _(observed)_' : ''}`).join('\n')}`);
    if (refs.length) out.push(`\n### Refers to\n${refs.map((e) => `- ${e.edge} \`${e.to}\`${e.observed ? ' _(observed)_' : ''}`).join('\n')}`);
    if (n.members.length) out.push(`\n### Members\n${n.members.map((m) => `- \`${m.key}\`${m.status ? ` **${m.status}**` : ''} — ${esc(m.title)}`).join('\n')}`);
  }
  for (const c of n.changes) {
    if (c.change.key === n.record?.key) continue;
    out.push(`\n---\n\n_reached through ${n.via[c.change.key]}_\n`);
    out.push(...changeDoc(c, loaded));
  }
  return out;
}

/** Render the view: one reference, or what a session is on. */
export function renderView(store: Store, opts: ViewOpts): View {
  const loaded = loadStore(store);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let body: string[];
  const showing: View['showing'] = {};
  if (opts.ref) {
    const n = get(loaded, opts.ref, opts);
    body = neighbourhoodDoc(n, loaded);
    showing.key = n.resolution.key;
  } else if (opts.session) {
    const id = opts.session.startsWith('session:') ? opts.session : `session:${opts.session}`;
    const res = resolve(loaded, id);
    if (res.status !== 'ok') throw new CliError(`${id} does not resolve to a session`);
    showing.session = res.rec.key;
    const changes = Array.isArray(res.rec.data.changes) ? (res.rec.data.changes as string[]) : [];
    const last = changes.length ? changes[changes.length - 1] : undefined;
    if (last) {
      const n = get(loaded, last, opts);
      body = neighbourhoodDoc(n, loaded);
      showing.key = n.resolution.key;
    } else {
      showing.board = opts.project ?? null;
      body = boardDoc(store, opts.project ?? null);
    }
  } else {
    showing.board = opts.project ?? null;
    body = boardDoc(store, opts.project ?? null);
  }
  const foot = `\n---\n_${stamp}${showing.session ? ` · following ${showing.session.slice(0, 24)}` : ''} · pjman view_\n`;
  return { markdown: body.join('\n') + '\n' + foot, showing };
}

/** Call `fn` on every new event in the store's stream (debounced). Returns a stop function. */
export function watchStore(store: Store, fn: () => void, debounceMs = 150): () => void {
  let timer: NodeJS.Timeout | null = null;
  return follow(store, lastSeq(store), () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, debounceMs);
  });
}
