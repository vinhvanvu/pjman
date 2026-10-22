// The Linear sync: the translation layer. Tickets observed by whoever holds the connection (a harness's MCP session today)
// arrive as JSON; they become sources with observed state and the changes that bind them. pjman never authenticates to a
// tracker. Pull only. Every write goes through the tool's write path: validated, committed once per run, one event per record.
import fs from 'node:fs';
import path from 'node:path';
import { CANONICAL_STATUSES, readUserConfig, type Store } from '../config.js';
import type { EventInput } from '../events.js';
import { sourceFileSlug } from '../keys.js';
import { loadStore, resolve, type Rec } from '../records.js';
import { CliError, localDate, nowIso } from '../util.js';
import { finishWrite, render, validateOrUndo, writeFile } from '../write.js';
import { newSession } from '../commands/new.js';
import { sessionLog } from '../commands/session.js';

export const WRITER = 'agent:linear-sync';

export interface Issue {
  id: string;
  title: string;
  url?: string;
  state?: string;
  stateType?: string;
  parent?: string;
  updatedAt?: string;
  team?: string;
}

export interface SyncOpts {
  project?: string;
  team?: string;
  /** The observed data: a path, `-` for stdin, or the parsed value itself. */
  from?: string | unknown;
  session?: string;
}

export interface SyncResult {
  project: string;
  team: string;
  issues: number;
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: { id: string; reason: string }[];
  commit: string | null;
  session?: string;
}

/** Linear state types → the canonical status, unless the store's vocabulary says otherwise. */
export const STATE_TYPES: Record<string, string> = { triage: 'open', backlog: 'open', unstarted: 'planning', started: 'active', completed: 'done', canceled: 'dropped', cancelled: 'dropped' };

export function mapStatus(store: Store, state?: string, stateType?: string): string {
  const v = store.config.vocabulary;
  const canonical = new Set<string>(CANONICAL_STATUSES);
  const name = state?.toLowerCase();
  const type = stateType?.toLowerCase();
  if (name && v[name]) return v[name];
  if (type && v[type]) return v[type];
  if (type && STATE_TYPES[type]) return STATE_TYPES[type];
  if (name && canonical.has(name)) return name;
  return 'open';
}

// --- the shapes a tracker's tools answer with, normalised ------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** An issue from whatever field names the tool used. */
export function toIssue(raw: unknown): Issue | null {
  const r = obj(raw);
  if (!r) return null;
  const id = str(r.identifier) ?? str(r.key) ?? str(r.id);
  const title = str(r.title) ?? str(r.name);
  if (!id || !title || !/^[A-Z][A-Z0-9]*-\d+$/.test(id)) return null;
  const state = obj(r.state) ?? obj(r.status);
  const parent = obj(r.parent);
  const team = obj(r.team);
  return {
    id,
    title,
    url: str(r.url),
    state: str(state?.name) ?? str(r.state) ?? str(r.status) ?? str(r.stateName),
    stateType: str(state?.type) ?? str(r.stateType),
    parent: str(parent?.identifier) ?? str(r.parentIdentifier) ?? (typeof r.parent === 'string' ? r.parent : undefined),
    updatedAt: str(r.updatedAt),
    team: str(team?.key) ?? str(r.teamKey) ?? id.slice(0, id.indexOf('-')),
  };
}

/** The issues inside a tool's answer: one issue, an array, an object with a list field, or an MCP tool result with text content. */
export function issuesIn(data: unknown): Issue[] {
  if (typeof data === 'string') {
    try {
      return issuesIn(JSON.parse(data));
    } catch {
      return [];
    }
  }
  if (Array.isArray(data)) return data.flatMap((x) => issuesIn(x));
  const r = obj(data);
  if (!r) return [];
  const one = toIssue(r);
  if (one) return [one];
  if (Array.isArray(r.content)) {
    // an MCP tool result pasted whole
    return (r.content as unknown[]).flatMap((c) => (obj(c)?.type === 'text' ? issuesIn(obj(c)!.text) : []));
  }
  if (r.structuredContent !== undefined) return issuesIn(r.structuredContent);
  const list = (['issues', 'nodes', 'results', 'items', 'data'] as const).map((k) => r[k]).find(Array.isArray) ?? Object.values(r).find(Array.isArray);
  return list ? issuesIn(list) : [];
}

function readFrom(from: SyncOpts['from']): unknown {
  if (from === undefined) throw new CliError('nothing to sync: pass --from <file> or --from - (the issues as JSON, as the tracker\'s tools answered)');
  if (typeof from !== 'string') return from;
  const trimmed = from.trim();
  const text = trimmed.startsWith('{') || trimmed.startsWith('[') ? from : from === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(from, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${from === '-' ? 'stdin' : from} is not JSON`);
  }
}

// --- the run -------------------------------------------------------------------------------------

export function syncLinear(store: Store, opts: SyncOpts = {}): SyncResult {
  let loaded = loadStore(store);
  const projectKey = opts.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const pres = resolve(loaded, projectKey.startsWith('project:') ? projectKey : `project:${projectKey}`);
  if (pres.status !== 'ok') throw new CliError(`${projectKey} does not resolve to a project`);
  const project = pres.rec;
  if (str(project.data.tracker) !== 'linear') throw new CliError(`${project.key} does not name linear as its tracker: pjman set ${project.key} tracker=linear ext.linear.team=<KEY>`);
  const team = opts.team ?? str(obj(obj(project.data.ext)?.linear)?.team);
  if (!team) throw new CliError(`${project.key} names no Linear team: pjman set ${project.key} ext.linear.team=<KEY> (the prefix of its issue ids)`);

  const all = issuesIn(readFrom(opts.from));
  const result: SyncResult = { project: project.key, team, issues: 0, created: [], updated: [], unchanged: [], skipped: [], commit: null };
  const issues: Issue[] = [];
  for (const issue of all) {
    if (issue.team !== team) result.skipped.push({ id: issue.id, reason: `team ${issue.team} is not ${team}` });
    else issues.push(issue);
  }
  result.issues = issues.length;
  if (!issues.length) return result;

  // the run is a session, on behalf of the person
  const actor = readUserConfig().actor;
  let session = opts.session;
  if (!session && actor) {
    const id = `linear-sync-${nowIso().replace(/[:.]/g, '-')}`;
    newSession(store, id, { agent: WRITER, onBehalfOf: actor, writer: WRITER });
    session = `session:${id}`;
  }
  const stamp = { writer: WRITER, session, created: localDate() };
  const events: EventInput[] = [];
  const touched: string[] = [];
  loaded = loadStore(store);

  const byBind = new Map<string, Rec>();
  for (const r of loaded.records) if (r.type === 'change' && Array.isArray(r.data.binds)) for (const k of r.data.binds as unknown[]) if (typeof k === 'string') byBind.set(k, r);

  const write = (rec: Rec | undefined, type: 'source' | 'change', rel: string, key: string, data: Record<string, unknown>, body: string, fields: string[]) => {
    const text = render(type, data, body);
    if (rec && render(type, rec.data, rec.body) === text) {
      if (type === 'change') result.unchanged.push(key);
      return;
    }
    writeFile(store, rel, text);
    touched.push(rel);
    events.push(rec ? { op: 'set', key, type, path: rel, fields, writer: WRITER, session } : { op: 'created', key, type, path: rel, writer: WRITER, session });
    if (type === 'change') (rec ? result.updated : result.created).push(key);
  };

  // pass 1: sources and changes, without parents
  const changeOf = new Map<string, string>();
  for (const issue of issues) {
    const sourceKey = `linear:${issue.id}`;
    const srcRel = path.join('sources', 'linear', `${sourceFileSlug('linear', issue.id)}.md`);
    const src = loaded.byKey.get(sourceKey)?.[0];
    const observed = { state: issue.state, state_type: issue.stateType, team: issue.team, parent: issue.parent, updated_at: issue.updatedAt, synced_at: nowIso() };
    const prev = obj(obj(src?.data.ext)?.linear);
    const same = src && prev && ['state', 'state_type', 'team', 'parent', 'updated_at'].every((k) => prev[k] === (observed as Record<string, unknown>)[k]) && src.data.title === issue.title && (issue.url ?? src.data.url) === src.data.url;
    if (!same) {
      const srcData: Record<string, unknown> = {
        ...(src?.data ?? {}), kind: 'linear', key: issue.id, title: issue.title, url: issue.url ?? src?.data.url,
        ...(src ? {} : stamp), ext: { ...(obj(src?.data.ext) ?? {}), linear: observed },
      };
      write(src, 'source', srcRel, sourceKey, srcData, src?.body ?? '', ['title', 'url', 'ext']);
    }

    const bound = byBind.get(sourceKey);
    const slug = issue.id.toLowerCase();
    const existing = bound ?? loaded.byKey.get(`change:${slug}`)?.[0];
    const changeKey = existing?.key ?? `change:${slug}`;
    changeOf.set(issue.id, changeKey);
    const rel = existing?.path ?? path.join('changes', slug, 'change.md');
    const status = mapStatus(store, issue.state, issue.stateType);
    if (existing) {
      const binds = Array.isArray(existing.data.binds) ? (existing.data.binds as string[]) : [];
      const data = { ...existing.data, title: issue.title, status, binds: binds.includes(sourceKey) ? binds : [...binds, sourceKey] };
      write(existing, 'change', rel, changeKey, data, existing.body, ['title', 'status']);
    } else {
      const data = { title: issue.title, status, project: project.key, binds: [sourceKey], ...stamp };
      write(undefined, 'change', rel, changeKey, data, '## Summary\n\n\n', []);
    }
  }
  if (touched.length) validateOrUndo(store, touched, events.filter((e) => e.op === 'created').map((e) => e.path));

  // pass 2: parents, where the parent change exists
  loaded = loadStore(store);
  for (const issue of issues) {
    if (!issue.parent) continue;
    const key = changeOf.get(issue.id)!;
    const rec = loaded.byKey.get(key)?.[0];
    const parentKey = changeOf.get(issue.parent) ?? (loaded.byKey.has(`change:${issue.parent.toLowerCase()}`) ? `change:${issue.parent.toLowerCase()}` : undefined);
    if (!rec || !parentKey || rec.data.parent === parentKey) {
      if (rec && !parentKey) result.skipped.push({ id: issue.id, reason: `parent ${issue.parent} is not in the store` });
      continue;
    }
    writeFile(store, rec.path, render('change', { ...rec.data, parent: parentKey }, rec.body));
    touched.push(rec.path);
    events.push({ op: 'set', key, type: 'change', path: rec.path, fields: ['parent'], writer: WRITER, session });
    if (!result.updated.includes(key) && !result.created.includes(key)) result.updated.push(key);
    result.unchanged = result.unchanged.filter((k) => k !== key);
  }
  if (touched.length) validateOrUndo(store, touched, []);

  result.commit = events.length ? finishWrite(store, `pjman: sync linear ${team} (${issues.length} issues)`, session, events) : null;
  if (session) sessionLog(store, session, `linear ${team}: ${issues.length} issues; ${result.created.length} changes created, ${result.updated.length} updated, ${result.unchanged.length} unchanged`);
  result.session = session;
  return result;
}
