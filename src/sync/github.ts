// GitHub issues: the translation from what `gh issue list --json …` or GitHub's API answers to tickets.
import { CANONICAL_STATUSES, type Store } from '../config.js';
import { loadStore, resolve } from '../records.js';
import { repoOf, slugFor } from '../refs.js';
import { CliError, notFound } from '../util.js';
import { applyTickets, itemsIn, obj, readObserved, type SyncResult, type Ticket } from './apply.js';

export const WRITER = 'agent:github-sync';

export interface GhIssue {
  number: number;
  title: string;
  url?: string;
  state: string;
  stateReason?: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  parent?: number;
  updatedAt?: string;
  repo?: string;
}

export interface SyncOpts {
  project?: string;
  /** `owner/name`; default: the project's `ext.github.repo`, else its `git-repo:` link. */
  repo?: string;
  from?: string | unknown;
  session?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** An issue from gh's JSON (number, title, state, stateReason, url, labels[{name}], milestone{title}) or the REST shape. */
export function toGhIssue(raw: unknown): GhIssue | null {
  const r = obj(raw);
  if (!r) return null;
  const number = typeof r.number === 'number' ? r.number : undefined;
  const title = str(r.title);
  if (number === undefined || !title || r.pull_request) return null;
  const labelList = Array.isArray(r.labels) ? (r.labels as unknown[]) : Array.isArray(obj(r.labels)?.nodes) ? (obj(r.labels)!.nodes as unknown[]) : [];
  const labels = labelList.map((l) => (typeof l === 'string' ? l : str(obj(l)?.name))).filter((x): x is string => !!x);
  const assigneeList = Array.isArray(r.assignees) ? (r.assignees as unknown[]) : Array.isArray(obj(r.assignees)?.nodes) ? (obj(r.assignees)!.nodes as unknown[]) : [];
  const assignees = assigneeList.map((a) => (typeof a === 'string' ? a : str(obj(a)?.login))).filter((x): x is string => !!x);
  const parent = obj(r.parent);
  const url = str(r.url) ?? str(r.html_url);
  const m = url && /github\.com\/([^/]+\/[^/]+)\/issues\/\d+/.exec(url);
  return {
    number, title, url, state: (str(r.state) ?? 'open').toLowerCase(), stateReason: str(r.stateReason) ?? str(r.state_reason) ?? undefined,
    labels, assignees, milestone: str(obj(r.milestone)?.title), parent: typeof parent?.number === 'number' ? parent.number : undefined, updatedAt: str(r.updatedAt) ?? str(r.updated_at),
    repo: str(r.repo) ?? (m ? m[1] : undefined),
  };
}

/** open → the vocabulary's word for a label, else open; closed → done, or dropped when closed as not planned. */
export function mapGhStatus(store: Store, i: GhIssue): string {
  const v = store.config.vocabulary;
  const canonical = new Set<string>(CANONICAL_STATUSES);
  if (i.state === 'closed') return /not.?planned/i.test(i.stateReason ?? '') ? 'dropped' : 'done';
  for (const l of i.labels) {
    const w = l.toLowerCase();
    if (v[w]) return v[w];
    if (canonical.has(w)) return w;
  }
  return 'open';
}

/** The command that reads a repository's issues with their sub-issue parents: GitHub's GraphQL API through gh (gh issue list --json has no parent). */
export function ghReadCommand(repo: string): string {
  const [owner, name] = repo.split('/');
  const query = `query($endCursor:String){repository(owner:"${owner}",name:"${name}"){issues(first:100,after:$endCursor,states:[OPEN,CLOSED]){nodes{number title url state stateReason updatedAt labels(first:20){nodes{name}} assignees(first:10){nodes{login}} milestone{title} parent{number}} pageInfo{hasNextPage endCursor}}}}`;
  return `gh api graphql --paginate --slurp -H 'GraphQL-Features: sub_issues' -f query='${query}'`;
}

export function ghIssuesIn(data: unknown): GhIssue[] {
  return itemsIn(data, (r) => toGhIssue(r) !== null).map(toGhIssue).filter((i): i is GhIssue => i !== null);
}

export function syncGithub(store: Store, opts: SyncOpts = {}): SyncResult {
  const loaded = loadStore(store);
  const projectKey = opts.project ?? store.project;
  if (!projectKey) throw new CliError('no project: run from a registered repository or pass --project project:<slug>');
  const pres = resolve(loaded, projectKey.startsWith('project:') ? projectKey : `project:${projectKey}`);
  if (pres.status !== 'ok') throw notFound(projectKey, { as: 'project' });
  const project = pres.rec;
  if (str(project.data.tracker) !== 'github-issue') throw new CliError(`${project.key} does not name github-issue as its tracker: pjman set ${project.key} tracker=github-issue`);
  const repo = opts.repo ?? repoOf(loaded, project.key);
  if (!repo) throw new CliError(`${project.key} names no repository: pjman set ${project.key} ext.github.repo=<owner/name>`);

  if (opts.from === undefined) throw new CliError(`nothing to sync. Read the issues and pipe them in:\n  ${ghReadCommand(repo)} | pjman sync github --from -\n(gh issue list --state all --json number,title,state,stateReason,url,labels,milestone works too, without sub-issue parents)`);
  let data: unknown;
  try {
    data = readObserved(opts.from);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const skipped: SyncResult['skipped'] = [];
  const tickets: Ticket[] = [];
  for (const i of ghIssuesIn(data)) {
    if (i.repo && i.repo.toLowerCase() !== repo.toLowerCase()) {
      skipped.push({ id: `${i.repo}#${i.number}`, reason: `repository ${i.repo} is not ${repo}` });
      continue;
    }
    tickets.push({
      id: `${repo}#${i.number}`, slug: slugFor('github-issue', `${repo}#${i.number}`), title: i.title, url: i.url ?? `https://github.com/${repo}/issues/${i.number}`,
      status: mapGhStatus(store, i), parent: i.parent !== undefined ? `${repo}#${i.parent}` : undefined, kind: i.labels.some((l) => l.toLowerCase() === 'bug') ? 'bug' : undefined, assignees: i.assignees.map((a) => `github-user:${a}`),
      observed: { state: i.state, state_reason: i.stateReason, labels: i.labels, assignees: i.assignees, milestone: i.milestone, parent: i.parent, updated_at: i.updatedAt },
    });
  }
  const r = applyTickets(store, { project, kind: 'github-issue', owner: 'github', writer: WRITER, tickets, session: opts.session, label: `github ${repo}` });
  r.team = repo;
  r.skipped.push(...skipped);
  return r;
}
