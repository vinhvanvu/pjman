// Linear: the translation from what Linear's tools answer (read by whoever holds the connection) to tickets.
import { CANONICAL_STATUSES, type Store } from '../config.js';
import { loadStore, resolve } from '../records.js';
import { CliError } from '../util.js';
import { slugFor } from '../refs.js';
import { applyTickets, itemsIn, obj, readObserved, type SyncResult, type Ticket } from './apply.js';

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
  from?: string | unknown;
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

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined);
const ID = /^[A-Z][A-Z0-9]*-\d+$/;

/** An issue from whatever field names the tool used. */
export function toIssue(raw: unknown): Issue | null {
  const r = obj(raw);
  if (!r) return null;
  const id = str(r.identifier) ?? str(r.key) ?? str(r.id);
  const title = str(r.title) ?? str(r.name);
  if (!id || !title || !ID.test(id)) return null;
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

export function issuesIn(data: unknown): Issue[] {
  return itemsIn(data, (r) => toIssue(r) !== null).map(toIssue).filter((i): i is Issue => i !== null);
}

export function syncLinear(store: Store, opts: SyncOpts = {}): SyncResult {
  const loaded = loadStore(store);
  const projectKey = opts.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const pres = resolve(loaded, projectKey.startsWith('project:') ? projectKey : `project:${projectKey}`);
  if (pres.status !== 'ok') throw new CliError(`${projectKey} does not resolve to a project`);
  const project = pres.rec;
  if (str(project.data.tracker) !== 'linear') throw new CliError(`${project.key} does not name linear as its tracker: pjman set ${project.key} tracker=linear ext.linear.team=<KEY>`);
  const team = opts.team ?? str(obj(obj(project.data.ext)?.linear)?.team);
  if (!team) throw new CliError(`${project.key} names no Linear team: pjman set ${project.key} ext.linear.team=<KEY> (the prefix of its issue ids)`);

  let data: unknown;
  try {
    data = readObserved(opts.from);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const skipped: SyncResult['skipped'] = [];
  const tickets: Ticket[] = [];
  for (const issue of issuesIn(data)) {
    if (issue.team !== team) {
      skipped.push({ id: issue.id, reason: `team ${issue.team} is not ${team}` });
      continue;
    }
    tickets.push({
      id: issue.id, slug: slugFor('linear', issue.id), title: issue.title, url: issue.url, status: mapStatus(store, issue.state, issue.stateType), parent: issue.parent,
      observed: { state: issue.state, state_type: issue.stateType, team: issue.team, parent: issue.parent, updated_at: issue.updatedAt },
    });
  }
  const r = applyTickets(store, { project, kind: 'linear', owner: 'linear', writer: WRITER, tickets, session: opts.session, label: `linear ${team}` });
  r.team = team;
  r.skipped.push(...skipped);
  return r;
}
