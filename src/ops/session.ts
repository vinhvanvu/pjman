import fs from 'node:fs';
import path from 'node:path';
import type { Store } from '../store/config.js';
import { parseRecord, sections } from '../store/frontmatter.js';
import { findReferences, get } from '../model/graph.js';
import { computeBrief, type Brief } from './hydrate.js';
import { findSession, forget, fullKey, loadStore, resolve, unresolvedError, type Rec } from '../store/records.js';
import { CliError, localDate, nowIso, notFound } from '../store/util.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from './write.js';
import { EDGES } from '../model/validate.js';
import { readEvents, type EventInput } from '../store/events.js';
import { SLUG_RE } from '../store/keys.js';
import { nameProblem } from '../model/foundation.js';
import { inferSessionKind, type Inferred } from './session-kinds.js';
import { newSessionKind } from './new.js';
import type { SessionHost } from '../hosts/host.js';

function load(store: Store, id: string) {
  const loaded = loadStore(store);
  const rec = findSession(loaded, id.startsWith('session:') ? id.slice(8) : id);
  if (!rec) throw notFound(`session:${id}`, { hint: `pjman session start ${id} --agent … --on-behalf-of … makes it` });
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before appending`);
  return { loaded, rec };
}

type SaveOp = 'log' | 'bind' | 'observe' | 'unbind' | 'focus' | 'briefed' | 'project' | 'name';

/** `value`: on a bind or a focus, the key of the change, so the event says where the session went. */
function save(
  store: Store,
  rec: ReturnType<typeof load>['rec'],
  data: Record<string, unknown>,
  body: string,
  message: string,
  op: SaveOp,
  value?: string,
): string | null {
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render('session', data, body));
  validateOrUndo(store, [rec.path], [], prior);
  const fields = {
    log: ['log'],
    bind: ['changes'],
    observe: ['observed'],
    unbind: ['changes', 'observed', 'log'],
    focus: ['focus'],
    briefed: ['briefed'],
    project: ['project', 'log'],
    name: ['name', 'kind', 'log'],
  }[op];
  const evOp = op === 'unbind' || op === 'focus' || op === 'briefed' || op === 'project' || op === 'name' ? 'set' : op;
  return finishWrite(store, message, rec.key, [
    { op: evOp, key: rec.key, type: 'session', path: rec.path, fields, value, writer: envelope({}).writer },
  ]);
}

const withLogLine = (rec: Pick<Rec, 'body' | 'sections'>, text: string): string => {
  let body = rec.body.replace(/\s+$/, '');
  if (!rec.sections.has('Log')) body += `${body ? '\n\n' : ''}## Log`;
  return `${body}\n- ${nowIso()} — ${text.trim()}\n`;
};

export interface StartFlags {
  agent?: string;
  onBehalfOf?: string;
  parent?: string;
  project?: string;
  /** The start line for the log, in the adapter's words (session started, resumed, after /clear …). */
  log?: string;
  /** The branch the session stands on: when its name leads to a change, the session is bound to it and the edge observed. */
  branch?: string;
  /** The brief in full even when the binding did not move (the conversation lost what it had). */
  full?: boolean;
  writer?: string;
  session?: string;
  /** Where the session runs, as the environment the start runs in says (host.ts): written on the record once, at
   *  the first start that knows it; a start inside no host leaves it as it is. */
  host?: SessionHost | null;
}

export interface StartResult {
  key: string;
  path: string;
  created: boolean;
  /** The change bound by this start, from the branch; absent when the session was already bound to it or none was found. */
  bound?: string;
  /** The branch edge observed by this start. */
  observed?: string;
  brief: Brief | null;
  commit: string | null;
}

/** A session's start as one write (decision session-start-fast/start-as-one-write): the record created unless it exists,
 *  the start line logged, the change the branch names bound and the branch edge observed, the brief computed and its
 *  watermark set, as one load of the store, one validation and one commit. The events are the ones the separate
 *  commands would have emitted. */
export function sessionStart(store: Store, ident: string, flags: StartFlags): StartResult {
  const id = ident.startsWith('session:') ? ident.slice(8) : ident;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new CliError(`'${id}' is not a usable session id`);
  const key = `session:${id}`;
  const loaded = loadStore(store);
  const env = envelope(flags);
  const events: EventInput[] = [];
  const existing = findSession(loaded, id);
  if (existing && !existing.valid) throw new CliError(`${existing.path} is invalid; fix it before appending`);
  let rel: string;
  let data: Record<string, unknown>;
  let body: string;
  if (existing) {
    rel = existing.path;
    data = { ...existing.data };
    body = existing.body;
  } else {
    if (!flags.agent) throw new CliError('--agent is required (an agent key)');
    if (!flags.onBehalfOf) throw new CliError('--on-behalf-of is required (a person key)');
    const started = new Date().toISOString();
    const date = localDate(new Date(started));
    rel = path.join('sessions', `${date}-${id}.md`);
    if (fs.existsSync(path.join(store.root, rel))) throw new CliError(`refused: ${rel} already exists`);
    data = {
      agent: flags.agent,
      on_behalf_of: flags.onBehalfOf,
      started,
      parent: flags.parent,
      project: flags.project ?? store.project,
      writer: env.writer,
      created: date,
    };
    body = '## Log\n\n';
    events.push({ op: 'created', key, type: 'session', path: rel, writer: env.writer });
  }
  const current = () => ({ body, sections: sections(body) });
  if (flags.log?.trim()) {
    body = withLogLine(current(), flags.log);
    events.push({ op: 'log', key, type: 'session', path: rel, fields: ['log'], writer: env.writer });
  }
  if (flags.host && !data.host) {
    const h: Record<string, unknown> = { name: flags.host.name, session: flags.host.session };
    if (flags.host.block) h.block = flags.host.block;
    if (flags.host.version) h.version = flags.host.version;
    if (flags.host.validated !== undefined) h.validated = flags.host.validated;
    data.host = h;
    body = withLogLine(
      current(),
      `runs in ${flags.host.name}${flags.host.version ? ` ${flags.host.version}` : ''}${flags.host.validated === false ? ' (a version the adapter has not validated)' : ''}`,
    );
    events.push({ op: 'set', key, type: 'session', path: rel, fields: ['host'], writer: env.writer });
  }
  let bound: string | undefined;
  let observed: string | undefined;
  if (flags.branch) {
    const branchKey = `branch:${flags.branch}`;
    const change = findReferences(loaded, branchKey, { projectDir: store.projectDir, project: store.project }).find(
      (r) => r.change,
    )?.change;
    if (change) {
      const changes = Array.isArray(data.changes) ? [...(data.changes as string[])] : [];
      if (!changes.includes(change)) {
        changes.push(change);
        data.changes = changes;
        body = withLogLine(current(), `bound ${change} (branch)`);
        events.push({ op: 'bind', key, type: 'session', path: rel, fields: ['changes'], writer: env.writer });
        bound = change;
      }
      if (store.config.source_kinds.includes('branch')) {
        const edges = Array.isArray(data.observed)
          ? [...(data.observed as { edge?: string; from?: string; to?: string; at?: string }[])]
          : [];
        if (!edges.some((o) => o.edge === 'links' && o.from === change && o.to === branchKey)) {
          edges.push({ edge: 'links', from: change, to: branchKey, at: nowIso() });
          data.observed = edges;
          events.push({ op: 'observe', key, type: 'session', path: rel, fields: ['observed'], writer: env.writer });
          observed = branchKey;
        }
      }
    }
  }
  // the brief reads the session as it now stands: the loaded store carries the record as written
  const abs = path.join(store.root, rel);
  const prior = existing ? snapshot(store, [rel]) : new Map<string, string>();
  const place = (text: string): Rec => {
    const parsed = parseRecord(text);
    const rec: Rec = {
      type: 'session',
      key,
      path: rel,
      abs,
      data: parsed.data,
      body: parsed.body,
      sections: sections(parsed.body),
      parsed,
      valid: parsed.hasFrontmatter && parsed.isMapping && parsed.errors.length === 0,
      sessionId: id,
      fileDate: existing?.fileDate ?? localDate(),
    };
    const at = loaded.records.findIndex((r) => r.key === key);
    if (at >= 0) loaded.records[at] = rec;
    else loaded.records.push(rec);
    loaded.byKey.set(key, [rec]);
    forget(loaded);
    return rec;
  };
  place(render('session', data, body));
  const b = computeBrief(store, id, { full: flags.full, loaded });
  if (b.mode !== 'none') {
    data.briefed = b.change ? { change: b.change, seq: b.seq, at: b.at } : { seq: b.seq, at: b.at };
    events.push({ op: 'set', key, type: 'session', path: rel, fields: ['briefed'], writer: env.writer });
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, render('session', data, body));
  validateOrUndo(store, [rel], existing ? [] : [rel], prior);
  const commit = finishWrite(store, `pjman: session start ${key}${bound ? ` ${bound}` : ''}`, key, events);
  return { key, path: rel, created: !existing, bound, observed, brief: b.mode === 'none' ? null : b, commit };
}

/** Append one line to `## Log`. */
export function sessionLog(store: Store, id: string, text: string): { path: string; commit: string | null } {
  const { rec } = load(store, id);
  const commit = save(store, rec, rec.data, withLogLine(rec, text), `pjman: session log ${rec.key}`, 'log');
  return { path: rec.path, commit };
}

export interface NameFlags {
  /** The name, one to four words; inferred from the session's own sources when not given. */
  name?: string;
  /** A session kind's slug or key; inferred from the record when not given; created when the store lacks it. */
  kind?: string;
  writer?: string;
  session?: string;
}

export interface NameResult {
  path: string;
  name: string;
  kind: string;
  /** What the inference read, when the name or the kind was inferred. */
  inferred?: string;
  /** The kind was created by this call. */
  createdKind: boolean;
  commit: string | null;
}

/** Name a session with no change (decision unbound-sessions/naming): the name and the kind it is given are written,
 *  what is not given is inferred from the session's own record (session-kinds.ts), and a kind the store lacks is
 *  created on the spot. A session that later binds a change keeps its name. Refused when nothing on the record names
 *  it: a name has to be said. */
export function sessionName(store: Store, id: string, flags: NameFlags): NameResult {
  const first = load(store, id);
  const given = flags.kind?.trim();
  const slug = given ? (given.startsWith('session-kind:') ? given.slice('session-kind:'.length) : given) : undefined;
  if (slug?.includes(':'))
    throw new CliError(`--kind ${given} is not a session kind: session-kind:<slug>, or the slug alone`);
  let inferred: Inferred | null = null;
  if (!slug || !flags.name?.trim()) inferred = inferSessionKind(first.loaded, first.rec);
  const kindSlug = slug ?? inferred?.kind;
  if (!kindSlug)
    throw new CliError(
      `refused: nothing on ${first.rec.key} says what it is doing (no PR, ticket or log line observed on it); name it: pjman session name ${id} "…" --kind <kind>`,
    );
  const name = flags.name?.trim() || inferred?.name;
  if (!name)
    throw new CliError(
      `refused: ${first.rec.key} reads as ${kindSlug} but nothing on it names it; give it a name: pjman session name ${id} "…" --kind ${kindSlug}`,
    );
  const np = nameProblem(name);
  if (np) throw new CliError(`name: ${np}`);
  // the kind: a record; one the store lacks is created first, as its own write
  let createdKind = false;
  const kindRes = resolve(first.loaded, `session-kind:${kindSlug}`);
  if (kindRes.status !== 'ok' && kindRes.status !== 'alias') {
    if (!SLUG_RE.test(kindSlug))
      throw new CliError(`--kind '${kindSlug}' is not a slug (lower-case letters, digits, hyphens)`);
    newSessionKind(store, kindSlug, { writer: flags.writer, session: flags.session });
    createdKind = true;
  } else if (kindRes.rec.type !== 'session-kind')
    throw new CliError(`${kindRes.rec.key} is a ${kindRes.rec.type}, not a session kind`);
  const { loaded, rec } = load(store, id);
  const kindKey = fullKey(loaded, `session-kind:${kindSlug}`);
  const same = rec.data.name === name && rec.data.kind === kindKey;
  const line = `named "${name}" (${kindSlug})${inferred && (!slug || !flags.name?.trim()) ? `, read from ${inferred.from}` : ''}`;
  const commit = same
    ? null
    : save(
        store,
        rec,
        { ...rec.data, name, kind: kindKey },
        withLogLine(rec, line),
        `pjman: session name ${rec.key} "${name}" (${kindSlug})`,
        'name',
        kindKey,
      );
  return {
    path: rec.path,
    name,
    kind: kindKey,
    inferred: inferred && (!slug || !flags.name?.trim()) ? inferred.from : undefined,
    createdKind,
    commit,
  };
}

/** Why a session was bound: the person's prompt named it, the session created it, its branch was cut for it, or a
 *  person or agent bound it by hand. Every bind says which, as a line in `## Log`. */
export type BindReason = 'prompt' | 'created' | 'branch' | 'by hand';

/** Append a change key to `changes`, in order, once; the reason is a line in `## Log`. `via` is the source that led to
 *  the change (a ticket the prompt named): the line says how the change relates to it, `bound change:x (prompt; binds
 *  linear:ABC-1234)`, the way refs and get name it. */
export function sessionBind(
  store: Store,
  id: string,
  changeKey: string,
  reason: BindReason = 'by hand',
  via?: string,
): { path: string; commit: string | null; added: boolean } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, raw);
  const key = res.rec.key; // the full key is what the record holds
  const changes = Array.isArray(rec.data.changes) ? [...(rec.data.changes as string[])] : [];
  if (changes.includes(key)) return { path: rec.path, commit: null, added: false };
  changes.push(key);
  const n = via ? get(loaded, via, { projectDir: store.projectDir, project: store.project }) : undefined;
  const relation = n?.resolution.key ? n.relation[key] : undefined;
  const how = relation ? `; ${relation} ${n!.resolution.key}` : '';
  const commit = save(
    store,
    rec,
    { ...rec.data, changes },
    withLogLine(rec, `bound ${key} (${reason}${how})`),
    `pjman: session bind ${rec.key} ${key}`,
    'bind',
    key,
  );
  return { path: rec.path, commit, added: true };
}

/** The change the session is looking at: set when it reads a change's context. Written only when it moves. */
export function sessionFocus(
  store: Store,
  id: string,
  changeKey: string,
): { path: string; commit: string | null; moved: boolean } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, raw);
  const key = res.rec.key;
  // unmoved only when the last read was this change and nothing the session did since (a write, a bind) moved it away
  const prior = rec.data.focus as { change?: string; at?: string } | undefined;
  const moved = readEvents(store).some(
    (e) =>
      e.session === rec.key &&
      e.op !== 'log' &&
      !(e.key === rec.key && e.op === 'set') &&
      (!prior?.at || e.at > prior.at),
  );
  if (prior?.change === key && !moved) return { path: rec.path, commit: null, moved: false };
  const commit = save(
    store,
    rec,
    { ...rec.data, focus: { change: key, at: nowIso() } },
    rec.body,
    `pjman: session focus ${rec.key} ${key}`,
    'focus',
    key,
  );
  return { path: rec.path, commit, moved: true };
}

/** A session that started outside any project (a parent directory, the home folder) is resolved to the project of the
 *  repository it works in once it writes there (decision: cold-start-gaps, the session from a parent directory): the
 *  project is set and the resolution logged, so the writes the session made under that project read as its own.
 *  Unchanged when the session already names that project. */
export function sessionProject(
  store: Store,
  id: string,
  projectKey: string,
): { path: string; project: string; commit: string | null; moved: boolean } {
  const { loaded, rec } = load(store, id);
  const raw = projectKey.includes(':') ? projectKey : `project:${projectKey}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, raw);
  if (res.rec.type !== 'project') throw new CliError(`${raw} is not a project`);
  const key = res.rec.key;
  if (rec.data.project === key) return { path: rec.path, project: key, commit: null, moved: false };
  const prior = typeof rec.data.project === 'string' ? ` (was ${rec.data.project})` : ' (started outside any project)';
  const body = withLogLine(rec, `resolved to ${key} from the repository it works in${prior}`);
  const commit = save(
    store,
    rec,
    { ...rec.data, project: key },
    body,
    `pjman: session project ${rec.key} ${key}`,
    'project',
    key,
  );
  return { path: rec.path, project: key, commit, moved: true };
}

/** The watermark: the change the last brief was for (none when it carried only notes to an unbound session) and the
 *  stream position it reached. */
export function sessionBriefed(
  store: Store,
  id: string,
  mark: { change?: string; seq: number; at: string },
): { path: string; commit: string | null } {
  const { rec } = load(store, id);
  const briefed = mark.change ? { change: mark.change, seq: mark.seq, at: mark.at } : { seq: mark.seq, at: mark.at };
  const commit = save(
    store,
    rec,
    { ...rec.data, briefed },
    rec.body,
    `pjman: session briefed ${rec.key}${mark.change ? ` ${mark.change}` : ''}`,
    'briefed',
  );
  return { path: rec.path, commit };
}

/** Back out a binding made in error: the change leaves `changes`, the edges observed on it go with it, and the
 *  unbinding is a line in `## Log`, so the session still says it happened. One commit. */
export function sessionUnbind(
  store: Store,
  id: string,
  changeKey: string,
): { path: string; commit: string | null; dropped: number } {
  const { loaded, rec } = load(store, id);
  const raw = changeKey.startsWith('change:') ? changeKey : `change:${changeKey}`;
  const res = resolve(loaded, raw);
  const key = res.status === 'ok' || res.status === 'alias' ? res.rec.key : fullKey(loaded, raw); // a removed change can still be unbound
  const changes = Array.isArray(rec.data.changes) ? (rec.data.changes as string[]) : [];
  if (!changes.includes(key)) throw new CliError(`${rec.key} is not bound to ${key}`);
  const observed = Array.isArray(rec.data.observed) ? (rec.data.observed as { from?: string; to?: string }[]) : [];
  const kept = observed.filter((o) => o.from !== key && o.to !== key);
  const data: Record<string, unknown> = { ...rec.data, changes: changes.filter((c) => c !== key), observed: kept };
  if (!kept.length) delete data.observed;
  const dropped = observed.length - kept.length;
  const line = `unbound ${key}${dropped ? `; dropped ${dropped} edge${dropped === 1 ? '' : 's'} observed on it` : ''}`;
  const commit = save(store, rec, data, withLogLine(rec, line), `pjman: session unbind ${rec.key} ${key}`, 'unbind');
  return { path: rec.path, commit, dropped };
}

/** Append an observed edge `{edge, from, to, at}`. */
export function sessionObserve(
  store: Store,
  id: string,
  edge: string,
  from: string,
  to: string,
): { path: string; commit: string | null } {
  if (!EDGES[edge]) throw new CliError(`'${edge}' is not an edge (${Object.keys(EDGES).join(', ')})`);
  const { loaded, rec } = load(store, id);
  // the record holds full keys; a source key stays as written
  const observed = Array.isArray(rec.data.observed) ? [...(rec.data.observed as unknown[])] : [];
  observed.push({ edge, from: fullKey(loaded, from), to: fullKey(loaded, to), at: nowIso() });
  const commit = save(
    store,
    rec,
    { ...rec.data, observed },
    rec.body,
    `pjman: session observe ${rec.key} ${edge} ${from} ${to}`,
    'observe',
  );
  return { path: rec.path, commit };
}
