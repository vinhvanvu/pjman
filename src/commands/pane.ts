import type { Store } from '../config.js';
import { eventsBySession, follow, lastSeq, readEvents } from '../events.js';
import { get, type GetOpts, type Neighbourhood } from '../graph.js';
import { loadStore, resolve, type Loaded, type Rec } from '../records.js';
import { lastActs, LIVE_MINUTES, sessionLogOf, sessionState } from '../session-state.js';
import { live, rootProductOf } from '../tree.js';
import { focusOf } from '../hydrate.js';
import { CliError, notFound } from '../util.js';
import { decisionLine, lineOfRow, nextLine, readinessLines, storeContext, type ChangeContext, type Row, type StoreContext } from './view.js';
import { formatStep, nextStep, stepsOf } from '../foundation.js';

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

/** The session followed, as the dock beside it needs it: its log, what it is on, and whether it is live. */
export interface SessionFacts {
  key: string;
  agent?: string;
  onBehalfOf?: string;
  started?: string;
  /** The log as written, oldest first: the instant and the line. */
  log: { at: string; text: string }[];
  /** What it is on, the change the dock follows: its focus (the change whose context it last read or that it last
   *  wrote), else its last bound change that still resolves. */
  on?: string;
  /** What it is credited with working on: its last bound change that still resolves. */
  bound?: string;
  /** Every change it bound that still resolves, in the order it bound them: the dock reads a milestone among them as
   *  the frame the session works inside (decision milestone-detail/milestone-leads-the-dock). */
  binds: string[];
  /** The product that change is in, else the current project's; absent when neither is known. */
  product?: string;
  /** live: something it did reached the stream inside the live window; ended: its closing line was written; quiet
   *  otherwise. */
  state: 'live' | 'quiet' | 'ended';
  /** Working, by the rule the bridge reads a session by: its last act reached the stream inside the live window and
   *  was not a stop line. A live session that stopped at a line is not working. */
  working: boolean;
  /** The last instant it reached the stream. */
  last?: string;
}

/** What a view shows, as data: a neighbourhood, or a board; the session followed, when one is. */
export interface ViewData {
  showing: View['showing'];
  neighbourhood?: Neighbourhood;
  board?: StoreContext;
  session?: SessionFacts;
}

const LOG_LINE = /^-\s*(\S+)\s+—\s+(.*)$/;

/** The session's facts from its record and the stream. */
export function sessionFacts(store: Store, loaded: Loaded, rec: Rec, opts: ViewOpts, now = Date.now()): SessionFacts {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const log = (rec.sections.get('Log') ?? '')
    .split('\n')
    .map((l) => LOG_LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ at: m[1], text: m[2] }));
  const bound = (Array.isArray(rec.data.changes) ? (rec.data.changes as unknown[]) : []).map((k) => live(loaded, k)).filter((r): r is Rec => !!r);
  const events = readEvents(store);
  const binding = bound[bound.length - 1];
  const on = live(loaded, focusOf(loaded, rec, events)?.change) ?? binding;
  const project = live(loaded, rec.data.project ?? opts.project);
  const product = rootProductOf(loaded, on ?? project ?? rec);
  // the last instant the session itself wrote: its own log lines and the writes stamped with it. A write that merely
  // touched its file (a migration, a format) is not the session acting
  let last = log.length ? log[log.length - 1].at : undefined;
  for (const e of eventsBySession(events).get(rec.key) ?? []) if (!last || e.at > last) last = e.at;
  const ended = log.length > 0 && log[log.length - 1].text.startsWith('session ended');
  const liveSince = new Date(now - LIVE_MINUTES * 60_000).toISOString();
  const state = ended ? 'ended' : last && last >= liveSince ? 'live' : 'quiet';
  const read = sessionLogOf(rec);
  const working = sessionState({ ended: !!read.ended, line: read.line?.at, act: lastActs(events).get(rec.key), proposed: false }, now) === 'working';
  return { key: rec.key, agent: str(rec.data.agent), onBehalfOf: str(rec.data.on_behalf_of), started: str(rec.data.started), log, on: on?.key, bound: binding?.key, binds: bound.map((r) => r.key), product: product?.key, state, working, last };
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
  out.push(`## ${esc(c.change.name ?? c.change.key)}`);
  if (lineOfRow(c.change)) out.push(esc(lineOfRow(c.change)));
  const facts: string[] = [`**${c.change.status ?? '?'}**`];
  if (typeof d.project === 'string') facts.push(d.project);
  if (c.parent) facts.push(`part of \`${c.parent.key}\``);
  for (const s of c.sources.filter((s) => s.via === 'binds')) facts.push(`binds ${link(s.key, s.url)}`);
  out.push(facts.join(' · '));
  for (const l of readinessLines(c, 'change')) out.push(`\n> ${esc(l)}`);
  if (c.next) out.push(`\n> **next:** ${esc(nextLine(c.next))}`);
  for (const [k, v] of Object.entries(c.sections)) {
    if (k === 'Notes') continue;
    out.push(`\n### ${k}\n\n${v}`);
  }
  if (c.plan.length) out.push(`\n### Plan${c.planProgress ? ` (${c.planProgress.done}/${c.planProgress.total} done)` : ''}\n\n${c.plan.map((s, i) => formatStep(i + 1, s)).join('\n')}`);
  if (c.decisions.length) {
    out.push('\n### Decisions');
    for (const dec of c.decisions) {
      const slug = dec.key.slice(dec.key.indexOf('/') + 1);
      out.push(`- ${MARK[dec.status ?? ''] ?? '•'} **${esc(dec.name ?? slug)}** \`${slug}\` — ${esc(lineOfRow(dec))} — ${decisionLine(dec)}`);
    }
  }
  if (c.children.length) {
    out.push('\n### Children');
    for (const ch of c.children) out.push(`- \`${ch.key}\` **${ch.status ?? '?'}** — ${esc(lineOfRow(ch))}`);
  }
  const links = c.sources.filter((s) => s.via === 'links');
  if (links.length) {
    out.push('\n### Sources');
    for (const s of links) out.push(`- ${link(s.key, s.url, s.record?.title)}`);
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
    for (const r of rows) {
      const next = nextLine(nextStep(stepsOf(r.data)));
      out.push(`- \`${r.key}\` — ${r.name ? `**${esc(r.name)}** ` : ''}${esc(lineOfRow(r))}${!c.project && r.data.project ? ` · ${String(r.data.project)}` : ''}${next ? `\n  - next: ${esc(next)}` : ''}`);
    }
  }
  if (c.proposed.length) {
    out.push('\n### Proposed decisions');
    for (const r of c.proposed) out.push(`- ○ \`${r.key}\` — ${esc(lineOfRow(r))}`);
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
    if (n.record) out.push(`## ${esc(lineOfRow(n.record) ?? n.record.type)}${n.record.status ? ` · ${n.record.status}` : ''}`);
    else out.push(`_${r.status === 'key' ? 'a source key with no record' : r.status}_`);
    const cite = n.in.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
    const refs = n.out.filter((e) => e.edge !== 'writer' && e.edge !== 'session');
    if (cite.length) out.push(`\n### Referenced by\n${cite.map((e) => `- ${e.edge} \`${e.from}\`${e.observed ? ' _(observed)_' : ''}`).join('\n')}`);
    if (refs.length) out.push(`\n### Refers to\n${refs.map((e) => `- ${e.edge} \`${e.to}\`${e.observed ? ' _(observed)_' : ''}`).join('\n')}`);
    if (n.members.length) out.push(`\n### Members\n${n.members.map((m) => `- \`${m.key}\`${m.status ? ` **${m.status}**` : ''} — ${esc(lineOfRow(m))}`).join('\n')}`);
  }
  for (const c of n.changes) {
    if (c.change.key === n.record?.key) continue;
    out.push(`\n---\n\n_reached through ${n.via[c.change.key]}_\n`);
    out.push(...changeDoc(c, loaded));
  }
  return out;
}

/** What to show: one reference, or what a session is on (its last bound change, else the project's board). */
export function viewData(store: Store, opts: ViewOpts, loaded: Loaded = loadStore(store)): ViewData {
  const showing: View['showing'] = {};
  if (opts.ref) {
    const n = get(loaded, opts.ref, opts);
    showing.key = n.resolution.key;
    return { showing, neighbourhood: n };
  }
  if (opts.session) {
    const id = opts.session.startsWith('session:') ? opts.session : `session:${opts.session}`;
    const res = resolve(loaded, id);
    if (res.status !== 'ok') throw notFound(id, { as: 'session' });
    showing.session = res.rec.key;
    const session = sessionFacts(store, loaded, res.rec, opts);
    if (session.on) {
      const n = get(loaded, session.on, opts);
      showing.key = n.resolution.key;
      return { showing, neighbourhood: n, session };
    }
    showing.board = opts.project ?? null;
    return { showing, board: storeContext(store, { project: opts.project ?? null }), session };
  }
  showing.board = opts.project ?? null;
  return { showing, board: storeContext(store, { project: opts.project ?? null }) };
}

/** Render the view as a Markdown document. */
export function renderView(store: Store, opts: ViewOpts): View {
  const loaded = loadStore(store);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const v = viewData(store, opts, loaded);
  const body = v.neighbourhood ? neighbourhoodDoc(v.neighbourhood, loaded) : boardDoc(store, v.showing.board ?? null);
  const foot = `\n---\n_${stamp}${v.showing.session ? ` · following ${v.showing.session.slice(0, 24)}` : ''} · pjman view_\n`;
  return { markdown: body.join('\n') + '\n' + foot, showing: v.showing };
}

/** Call `fn` on every new event in the store's stream (debounced). Returns a stop function. */
export function watchStore(store: Store, fn: () => void, debounceMs = 150): () => void {
  let timer: NodeJS.Timeout | null = null;
  return follow(store, lastSeq(store), () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, debounceMs);
  });
}
