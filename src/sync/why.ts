// pjman why <file>:<line> (change:pjman-why): why a line exists, as far down as the record goes. git says which commit
// wrote it; in a project that opted in to Entire, `entire why` adds the checkpoint, the session and the prompt behind
// that commit; pjman adds what neither holds: the change the commit was for, its intent, and the decisions accepted on
// it. Without Entire the answer starts at git and still reaches the change. Also here: Entire's search over past
// sessions, which intake reads when looking for work like the request.
import path from 'node:path';
import { entireOn, runEntire, type EntireOpts } from '../entire/entire.js';
import { decisionState, threadOf } from '../model/foundation.js';
import { allEdges, findReferences } from '../model/graph.js';
import type { Intake, PastSession } from '../model/intake.js';
import type { Store } from '../store/config.js';
import { git } from '../store/git.js';
import { findSession, loadStore, type Loaded, type Rec } from '../store/records.js';
import { CliError, usageError } from '../store/util.js';
import { CHECKPOINT_KIND } from './entire.js';

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const oneLine = (t: string | undefined, max: number): string | undefined => {
  const s = t?.replace(/\s+/g, ' ').trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : undefined;
};

export interface Why {
  file: string;
  line: number;
  content?: string;
  /** The commit that last wrote the line, or none when it is not committed yet. */
  commit?: { sha: string; subject?: string; author?: string; at?: string };
  /** What Entire holds behind that commit, when the project opted in and Entire answered. */
  entire?: {
    checkpoint?: string;
    session?: string;
    agent?: string;
    prompt?: string;
    /** The prompt is the one the session opened with, not the turn that wrote the line (Entire's `prompt_session_level`). */
    opening?: boolean;
    intent?: string;
    url?: string;
  };
  /** The store's session that wrote it, when the store holds it. */
  session?: { key: string; name?: string };
  /** The changes the line was written for, each with what it was for and what was decided on it. */
  changes: {
    key: string;
    name?: string;
    gist?: string;
    intent?: string;
    decisions: { key: string; name?: string; accepted: string }[];
    /** How the change was found: the commit names it, its checkpoint is linked on it, or its session worked on it. */
    by: 'commit' | 'checkpoint' | 'session';
  }[];
  pending: string[];
}

function describe(loaded: Loaded, rec: Rec, by: Why['changes'][number]['by']): Why['changes'][number] {
  const decisions: Why['changes'][number]['decisions'] = [];
  for (const d of loaded.records) {
    if (d.type !== 'decision' || !d.valid || d.changeKey !== rec.key || d.data.status !== 'decided') continue;
    const s = decisionState(threadOf(d.data));
    const option = s.options.find((o) => o.id === s.accepted?.option);
    if (option) decisions.push({ key: d.key, name: str(d.data.name), accepted: option.text.replace(/\s+/g, ' ') });
  }
  return {
    key: rec.key,
    name: str(rec.data.name),
    gist: str(rec.data.gist),
    intent: rec.sections.get('Intent')?.trim() || undefined,
    decisions,
    by,
  };
}

/** `<file>:<line>` or `<file>` with `--line`. */
export function parseWhere(arg: string, lineFlag?: string): { file: string; line: number } {
  const m = /^(.*):(\d+)$/.exec(arg);
  const file = m ? m[1] : arg;
  const line = Number(m ? m[2] : lineFlag);
  if (m && lineFlag !== undefined) throw usageError('name the line once: <file>:<line> or --line <n>');
  if (!file || !Number.isInteger(line) || line < 1)
    throw usageError('usage: pjman why <file>:<line> (one line: the one whose reason you want)');
  return { file, line };
}

export function why(
  store: Store,
  where: { file: string; line: number },
  opts: { cwd: string; entire?: EntireOpts },
): Why {
  const loaded = loadStore(store);
  const { cwd } = opts;
  const abs = path.resolve(cwd, where.file);
  let top: string;
  try {
    top = git(path.dirname(abs), ['rev-parse', '--show-toplevel']);
  } catch {
    throw new CliError(`${where.file} is not in a git repository`);
  }
  const rel = path.relative(top, abs);
  const out: Why = { file: rel, line: where.line, changes: [], pending: [] };

  // git: the commit that last wrote the line
  let blame: string;
  try {
    blame = git(top, ['blame', '--porcelain', '-L', `${where.line},${where.line}`, '--', rel]);
  } catch (e) {
    throw new CliError(
      `${rel}:${where.line} could not be read: ${(e as Error).message.split('\n').find((l) => /fatal/.test(l)) ?? 'git blame failed'}`,
    );
  }
  const lines = blame.split('\n');
  const sha = lines[0]?.split(' ')[0] ?? '';
  const field = (name: string) => lines.find((l) => l.startsWith(`${name} `))?.slice(name.length + 1);
  out.content = lines.find((l) => l.startsWith('\t'))?.slice(1);
  let message = '';
  if (sha && !/^0+$/.test(sha)) {
    const at = Number(field('author-time'));
    out.commit = {
      sha,
      subject: field('summary'),
      author: field('author'),
      at: at ? new Date(at * 1000).toISOString() : undefined,
    };
    try {
      message = git(top, ['log', '-1', '--format=%B', sha]);
    } catch {
      message = field('summary') ?? '';
    }
  }

  // Entire: the checkpoint, session and prompt behind the commit
  let checkpoint = /^Entire-Checkpoint:\s*(\S+)/m.exec(message)?.[1];
  let sessionId: string | undefined;
  if (entireOn(loaded, store.project)) {
    const r = runEntire<Record<string, unknown>>(['why', `${rel}:${where.line}`], { ...opts.entire, cwd: top });
    const l = r.ok ? obj(r.data.line) : undefined;
    if (!r.ok) out.pending.push(r.reason);
    else if (l) {
      checkpoint = str(l.checkpoint_id) ?? checkpoint;
      sessionId = str(l.session_id);
      out.entire = {
        checkpoint,
        session: sessionId,
        agent: str(l.agent),
        prompt: oneLine(str(l.prompt), 400),
        ...(l.prompt_session_level === true ? { opening: true } : {}),
        intent: oneLine(str(l.intent), 400),
      };
    }
  }
  const src = checkpoint ? loaded.byKey.get(`${CHECKPOINT_KIND}:${checkpoint}`)?.[0] : undefined;
  if (out.entire && str(src?.data.url)) out.entire.url = str(src?.data.url);
  if (!sessionId) {
    const known = obj(obj(src?.data.ext)?.entire)?.sessions;
    sessionId = Array.isArray(known) ? known.find((s): s is string => typeof s === 'string') : undefined;
  }
  const session = sessionId ? findSession(loaded, sessionId) : undefined;
  if (session) out.session = { key: session.key, name: str(session.data.name) };

  // pjman: the change behind it. The commit's own message first; else the change its checkpoint is linked on; else
  // what the session worked on
  const add = (key: string | undefined, by: Why['changes'][number]['by']) => {
    const rec = key ? loaded.byKey.get(key)?.[0] : undefined;
    if (rec && rec.type === 'change' && !out.changes.some((c) => c.key === rec.key))
      out.changes.push(describe(loaded, rec, by));
  };
  for (const r of findReferences(loaded, message, { project: store.project, projectDir: store.projectDir }))
    if (r.change && r.text.startsWith('change:')) add(r.change, 'commit');
  if (!out.changes.length && src)
    for (const e of allEdges(loaded)) if (e.to === src.key && e.from.startsWith('change:')) add(e.from, 'checkpoint');
  if (!out.changes.length && session)
    for (const k of Array.isArray(session.data.changes) ? session.data.changes : [])
      if (typeof k === 'string') add(k, 'session');
  return out;
}

export function formatWhy(w: Why, printed: (key: string) => string = (k) => k): string {
  const out = [`${w.file}:${w.line}${w.content !== undefined ? `  ${w.content.trim()}` : ''}`];
  if (!w.commit) out.push('\nnot committed yet: the line is in the working tree only');
  else
    out.push(
      `\ncommit ${w.commit.sha.slice(0, 8)}${w.commit.at ? ` ${w.commit.at.slice(0, 10)}` : ''}${w.commit.author ? ` ${w.commit.author}` : ''}\n  ${w.commit.subject ?? ''}`,
    );
  if (w.entire?.checkpoint || w.session) {
    out.push(
      `\nsession ${w.session ? `${w.session.key}${w.session.name ? ` "${w.session.name}"` : ''}` : (w.entire?.session ?? '(not known)')}${w.entire?.agent ? ` · ${w.entire.agent}` : ''}${w.entire?.checkpoint ? ` · checkpoint ${w.entire.checkpoint}` : ''}`,
    );
    if (w.entire?.prompt) out.push(`  ${w.entire.opening ? 'the session opened with' : 'asked'}: ${w.entire.prompt}`);
    if (w.entire?.intent) out.push(`  meant: ${w.entire.intent}`);
    if (w.entire?.url) out.push(`  ${w.entire.url}`);
  }
  if (!w.changes.length)
    out.push(
      w.commit
        ? '\nno change of the store is behind this commit: its message names none, and no session or checkpoint links it'
        : '',
    );
  const many = w.changes.length > 1 && w.changes[0].by === 'session';
  if (many) out.push(`\nthe session worked on ${w.changes.length} changes; the line is for one of them:`);
  for (const c of w.changes) {
    out.push(`\n${printed(c.key)}${c.name ? ` — ${c.name}` : ''}${c.gist ? `: ${c.gist}` : ''}`);
    if (many) continue;
    if (c.intent) out.push(`  intent: ${c.intent.replace(/\s+/g, ' ')}`);
    for (const d of c.decisions) out.push(`  decided (${d.name ?? printed(d.key)}): ${d.accepted}`);
  }
  for (const p of w.pending) out.push(`\nentire: pending (${p})`);
  return out.filter((l) => l !== '').join('\n');
}

/** Past sessions like the request, from Entire's search (a project that opted in): added to what intake found in the
 *  store's own sessions, one entry per session. What Entire does not answer is said, and intake stands without it. */
export function searchPast(store: Store, i: Intake, opts: { entire?: EntireOpts } = {}): Intake {
  const loaded = loadStore(store);
  if (!store.projectDir || !entireOn(loaded, store.project) || !i.words.length) return i;
  const r = runEntire<Record<string, unknown>>(['search', i.words.join(' '), '--limit', '8'], {
    ...opts.entire,
    cwd: store.projectDir,
    timeout: 30_000,
  });
  if (!r.ok) return { ...i, searchPending: r.reason };
  const sessions = [...i.sessions];
  for (const raw of Array.isArray(r.data.results) ? r.data.results : []) {
    const hit = obj(raw);
    const data = obj(hit?.data);
    const meta = obj(hit?.searchMeta);
    if (!data || (hit?.type !== 'session' && hit?.type !== 'checkpoint')) continue;
    // a checkpoint leads to its sessions through the store's own link to it
    const cp =
      hit.type === 'checkpoint' ? loaded.byKey.get(`${CHECKPOINT_KIND}:${str(data.id) ?? ''}`)?.[0] : undefined;
    const known = obj(obj(cp?.data.ext)?.entire)?.sessions;
    const id =
      str(data.sessionId) ?? (Array.isArray(known) ? known.find((s): s is string => typeof s === 'string') : undefined);
    const rec = id ? findSession(loaded, id) : undefined;
    if (rec ? sessions.some((s) => s.session === rec.key) : !id || sessions.some((s) => s.matched.includes(id)))
      continue;
    const past: PastSession = {
      ...(rec ? { session: rec.key, name: str(rec.data.name) } : { name: str(data.displayName) }),
      at: str(data.createdAt)?.slice(0, 10),
      changes:
        rec && Array.isArray(rec.data.changes)
          ? rec.data.changes.filter((k): k is string => typeof k === 'string')
          : [],
      matched: `${oneLine(str(meta?.snippet) ?? str(meta?.summary) ?? str(data.prompt), 140) ?? 'matched'}${rec ? '' : ` (${id})`}`,
      from: 'entire',
    };
    sessions.push(past);
    if (sessions.length >= 8) break;
  }
  return { ...i, sessions };
}
