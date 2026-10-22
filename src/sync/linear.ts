// The Linear sync: tickets observed through Linear's MCP server become sources and the changes that bind them.
// Pull only. Every write goes through the tool's write path: validated, committed once per run, one event per record.
import path from 'node:path';
import { CANONICAL_STATUSES, readUserConfig, type Store } from '../config.js';
import type { EventInput } from '../events.js';
import { McpClient, type McpTool } from '../mcp/client.js';
import { currentToken, refresh } from '../mcp/oauth.js';
import { loadStore, resolve, type Loaded, type Rec } from '../records.js';
import { CliError, localDate, nowIso } from '../util.js';
import { finishWrite, render, validateOrUndo, writeFile } from '../write.js';
import { newSession, newSource } from '../commands/new.js';
import { sessionLog } from '../commands/session.js';
import { sourceFileSlug } from '../keys.js';

export const LINEAR_MCP_URL = 'https://mcp.linear.app/mcp';
export const WRITER = 'agent:linear-sync';

export interface SyncOpts {
  project?: string;
  team?: string;
  probe?: boolean;
  /** Only issues updated at or after this date. */
  since?: string;
  token?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  /** Issues per page. */
  limit?: number;
  session?: string;
}

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

export interface SyncResult {
  project: string;
  team?: string;
  server?: { name?: string; version?: string } | null;
  probe?: { tools: string[]; teams?: unknown; sample?: unknown };
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

// --- the shapes a tool may answer with, normalised -----------------------------------------------

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** An issue from whatever field names the server uses. */
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

/** The list and the cursor inside a tool's answer: an array, or the first array-valued field plus a next cursor. */
export function pageOf(data: unknown): { items: unknown[]; next?: string } {
  if (Array.isArray(data)) return { items: data };
  const r = obj(data);
  if (!r) return { items: [] };
  const list = (['issues', 'nodes', 'results', 'items', 'data'] as const).map((k) => r[k]).find(Array.isArray) ?? Object.values(r).find(Array.isArray);
  const info = obj(r.pageInfo);
  const next = str(r.nextCursor) ?? str(r.cursor) ?? (info?.hasNextPage ? str(info.endCursor) : undefined);
  return { items: (list as unknown[]) ?? [], next };
}

function pickTool(tools: McpTool[], exact: string[], pattern: RegExp): McpTool | undefined {
  return exact.map((n) => tools.find((t) => t.name === n)).find(Boolean) ?? tools.find((t) => pattern.test(t.name));
}

// --- the run -------------------------------------------------------------------------------------

export async function connectLinear(opts: SyncOpts): Promise<McpClient> {
  const url = opts.url ?? process.env.PJMAN_LINEAR_URL ?? LINEAR_MCP_URL;
  const token = opts.token ?? process.env.PJMAN_LINEAR_TOKEN ?? (await currentToken('linear', opts.fetchImpl));
  if (!token) throw new CliError('not signed in to Linear: run `pjman auth linear` (or pass --token / PJMAN_LINEAR_TOKEN)');
  const client = new McpClient({ url, token, fetchImpl: opts.fetchImpl, refresh: () => refresh('linear', opts.fetchImpl) });
  return client.connect();
}

export async function syncLinear(store: Store, opts: SyncOpts = {}): Promise<SyncResult> {
  let loaded = loadStore(store);
  const projectKey = opts.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const pres = resolve(loaded, projectKey.startsWith('project:') ? projectKey : `project:${projectKey}`);
  if (pres.status !== 'ok') throw new CliError(`${projectKey} does not resolve to a project`);
  const project = pres.rec;
  const ext = obj(obj(project.data.ext)?.linear);
  const team = opts.team ?? str(ext?.team);
  const tracker = str(project.data.tracker);
  if (!opts.probe && tracker !== 'linear') throw new CliError(`${project.key} does not name linear as its tracker: pjman set ${project.key} tracker=linear`);

  const client = await connectLinear(opts);
  const tools = client.tools;
  const result: SyncResult = { project: project.key, team, server: client.serverInfo, issues: 0, created: [], updated: [], unchanged: [], skipped: [], commit: null };

  const listIssues = pickTool(tools, ['list_issues', 'search_issues', 'issues'], /issues?$/i);
  if (opts.probe || !team) {
    const listTeams = pickTool(tools, ['list_teams', 'teams'], /teams?$/i);
    const teams = listTeams ? await client.callJson(listTeams.name, client.argsFor(listTeams.name, { limit: 50 })).catch((e: Error) => ({ error: e.message })) : undefined;
    const sample = listIssues ? await client.callJson(listIssues.name, client.argsFor(listIssues.name, { team, limit: 2 })).catch((e: Error) => ({ error: e.message })) : undefined;
    result.probe = { tools: tools.map((t) => t.name), teams, sample };
    return result;
  }
  if (!listIssues) throw new CliError(`the server has no issue-listing tool; it offers: ${tools.map((t) => t.name).join(', ')}`);

  // pull every page
  const issues: Issue[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const args = client.argsFor(listIssues.name, { team, teamKey: team, teamId: team, limit: opts.limit ?? 50, updatedAt: opts.since, updatedAfter: opts.since, since: opts.since, cursor, after: cursor, includeArchived: false });
    const data = await client.callJson(listIssues.name, args);
    const { items, next } = pageOf(data);
    if (!items.length && page === 0 && typeof data === 'string') throw new CliError(`${listIssues.name} answered text, not data: ${data.slice(0, 300)}`);
    for (const raw of items) {
      const issue = toIssue(raw);
      if (!issue) continue;
      if (issue.team !== team) continue;
      issues.push(issue);
    }
    if (!next || !items.length) break;
    cursor = next;
  }
  result.issues = issues.length;

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
    const srcData: Record<string, unknown> = {
      ...(src?.data ?? {}), kind: 'linear', key: issue.id, title: issue.title, url: issue.url ?? src?.data.url,
      ...(src ? {} : stamp), ext: { ...(obj(src?.data.ext) ?? {}), linear: observed },
    };
    // synced_at alone must not count as a change
    if (src) {
      const prev = obj(obj(src.data.ext)?.linear);
      const same = prev && ['state', 'state_type', 'team', 'parent', 'updated_at'].every((k) => prev[k] === (observed as Record<string, unknown>)[k]) && src.data.title === issue.title && (issue.url ?? src.data.url) === src.data.url;
      if (same) {
        // fall through to the change; the source is unchanged
      } else write(src, 'source', srcRel, sourceKey, srcData, src.body, ['title', 'url', 'ext']);
    } else write(undefined, 'source', srcRel, sourceKey, srcData, '', []);

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
      if (rec && !parentKey) result.skipped.push({ id: issue.id, reason: `parent ${issue.parent} is not in this project` });
      continue;
    }
    const text = render('change', { ...rec.data, parent: parentKey }, rec.body);
    writeFile(store, rec.path, text);
    touched.push(rec.path);
    events.push({ op: 'set', key, type: 'change', path: rec.path, fields: ['parent'], writer: WRITER, session });
    if (!result.updated.includes(key) && !result.created.includes(key)) result.updated.push(key);
    result.unchanged = result.unchanged.filter((k) => k !== key);
  }
  if (touched.length) validateOrUndo(store, touched, []);

  const line = `linear ${team}: ${issues.length} issues; ${result.created.length} changes created, ${result.updated.length} updated, ${result.unchanged.length} unchanged`;
  result.commit = events.length ? finishWrite(store, `pjman: sync linear ${team} (${issues.length} issues)`, session, events) : null;
  if (session) sessionLog(store, session, line);
  result.session = session;
  return result;
}

export { newSource };
export type { Loaded };
