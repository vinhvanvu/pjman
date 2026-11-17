// pjman sync entire (change:checkpoint-link): the Entire checkpoints behind a project's commits, linked to the changes
// those commits built and to the sessions that made them. Entire writes a checkpoint (the prompts, transcript and tool
// activity of the sessions since the last commit) at every commit and names it in the commit's `Entire-Checkpoint`
// trailer; pjman and Entire know a session by the same id. So: every commit of the repository that carries the trailer
// is read from git, the change it belongs to is the one its message names (`change:<slug>`), else the one its branch
// was cut for, and the checkpoint becomes a source (`entire-checkpoint:<id>`, opening on entire.com at its commit) in
// the change's links, observed by each session of the store that contributed to it. Only for a project that opted in;
// what Entire does not answer is left pending and read again by the next sync.
import path from 'node:path';
import { entireOn, runEntire, type EntireOpts } from '../entire/entire.js';
import { findReferences } from '../model/graph.js';
import { repoOf } from '../model/refs.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo, writeFile } from '../ops/write.js';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { git } from '../store/git.js';
import { sourceFileSlug } from '../store/keys.js';
import { findSession, loadStore, type Loaded, type Rec } from '../store/records.js';
import { CliError, localDate, nowIso } from '../store/util.js';

export const CHECKPOINT_KIND = 'entire-checkpoint';

export interface CheckpointCommit {
  sha: string;
  subject: string;
  body: string;
  checkpoints: string[];
  /** The branches whose own work the commit is: one not yet merged that holds it, or the one a merge brought in. */
  branches: string[];
}

export interface EntireSyncResult {
  project: string;
  /** Checkpoints found on the repository's commits. */
  checkpoints: number;
  /** Each checkpoint this run linked: to its change, and the sessions it was observed by. */
  linked: { checkpoint: string; change: string; sessions: string[] }[];
  /** Checkpoints on commits that lead to no change of the store. */
  unplaced: number;
  /** What Entire did not answer; the next sync reads it again. */
  pending: string[];
  commit: string | null;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const tryGit = (cwd: string, args: string[]): string => {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
};

/** The repository's base branch: what origin's HEAD points at, else main, else master, else the current branch. */
export function baseBranch(dir: string): string {
  const head = tryGit(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master'])
    if (tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])) return b;
  return tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
}

/** The branch a merge commit's subject names: git's own (`Merge branch 'x'`) or GitHub's (`Merge pull request #n from
 *  owner/x`). */
export function mergedBranch(subject: string): string | null {
  const m =
    /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject) ??
    /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
  return m ? m[1].replace(/^origin\//, '') : null;
}

/** Every commit of the repository's local branches that carries an `Entire-Checkpoint` trailer, with the branches whose
 *  work it is. Reads git only. */
export function checkpointCommits(dir: string): CheckpointCommit[] {
  const SEP = '\x1f';
  const END = '\x1e';
  const raw = tryGit(dir, [
    'log',
    '--reverse',
    '--branches',
    `--format=%H${SEP}%s${SEP}%b${SEP}%(trailers:key=Entire-Checkpoint,valueonly,separator=%x2c)${END}`,
  ]);
  const commits = new Map<string, CheckpointCommit>();
  for (const entry of raw.split(END)) {
    const [sha, subject, body, trailers] = entry.replace(/^\s+/, '').split(SEP);
    const checkpoints = (trailers ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^[0-9A-Za-z]{20,40}$/.test(t));
    if (sha && checkpoints.length) commits.set(sha, { sha, subject, body: body ?? '', checkpoints, branches: [] });
  }
  if (!commits.size) return [];
  const base = baseBranch(dir);
  const own = (range: string, branch: string) => {
    for (const sha of tryGit(dir, ['rev-list', range]).split('\n')) {
      const c = commits.get(sha);
      if (c && !c.branches.includes(branch)) c.branches.push(branch);
    }
  };
  // a branch not yet merged: its commits past the base
  for (const b of tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean))
    if (b !== base) own(`${base}..${b}`, b);
  // a branch merged with a merge commit: what the merge brought in
  for (const line of tryGit(dir, ['log', '--first-parent', '--merges', `--format=%H${SEP}%s`, base]).split('\n')) {
    const [sha, subject] = line.split(SEP);
    const branch = sha && subject ? mergedBranch(subject) : null;
    if (branch) own(`${sha}^1..${sha}^2`, branch);
  }
  return [...commits.values()];
}

/** The changes a commit belongs to: those its message names by key, else those its branches were cut for. */
function changesOf(loaded: Loaded, c: CheckpointCommit, opts: { project?: string; projectDir?: string }): string[] {
  const named = findReferences(loaded, `${c.subject}\n${c.body}`, opts)
    .filter((r) => r.change && r.text.startsWith('change:'))
    .map((r) => r.change!);
  if (named.length) return [...new Set(named)];
  const cut = c.branches.flatMap((b) =>
    findReferences(loaded, `branch:${b}`, opts)
      .filter((r) => r.change)
      .map((r) => r.change!),
  );
  return [...new Set(cut)];
}

export interface EntireSyncOpts {
  project?: string;
  session?: string;
  writer?: string;
  /** How Entire is reached (tests pass a fake binary). */
  entire?: EntireOpts;
}

export function syncEntire(store: Store, opts: EntireSyncOpts = {}): EntireSyncResult {
  const loaded = loadStore(store);
  const project = opts.project ?? store.project;
  const dir = store.projectDir;
  if (!project || !loaded.byKey.has(project))
    throw new CliError('sync entire reads a project: run it inside a registered project');
  if (!dir) throw new CliError(`sync entire reads ${project}'s repository: run it inside the project's folder`);
  if (!entireOn(loaded, project))
    throw new CliError(
      `${project} has not opted in to Entire: pjman set ${project} ext.entire.enabled=true (then pjman doctor says what Entire still needs)`,
    );
  if (!store.config.source_kinds.includes(CHECKPOINT_KIND))
    throw new CliError(`the store has no ${CHECKPOINT_KIND} source kind yet: run pjman migrate`);
  const result: EntireSyncResult = { project, checkpoints: 0, linked: [], unplaced: 0, pending: [], commit: null };
  const commits = checkpointCommits(dir);
  const repo = repoOf(loaded, project);
  const env = envelope({ session: opts.session, writer: opts.writer });
  const stamp = { writer: env.writer, session: env.session, created: localDate() };
  const events: EventInput[] = [];
  const writes = new Map<string, string>();
  const created: string[] = [];
  // records are rewritten as the run goes: the latest data of each, by path
  const data = new Map<string, { rec: Rec; data: Record<string, unknown> }>();
  const dataOf = (rec: Rec) => {
    if (!data.has(rec.path)) data.set(rec.path, { rec, data: { ...rec.data } });
    return data.get(rec.path)!.data;
  };
  const changed = new Map<string, Set<string>>();
  const mark = (rec: Rec, field: string) => {
    if (!changed.has(rec.path)) changed.set(rec.path, new Set());
    changed.get(rec.path)!.add(field);
  };

  for (const c of commits) {
    const changes = changesOf(loaded, c, { project, projectDir: dir });
    for (const id of c.checkpoints) {
      result.checkpoints++;
      if (!changes.length) {
        result.unplaced++;
        continue;
      }
      const key = `${CHECKPOINT_KIND}:${id}`;
      const src = loaded.byKey.get(key)?.[0];
      // the sessions behind the checkpoint: known from an earlier sync, else asked of Entire
      let sessions = list(obj(obj(src?.data.ext)?.entire)?.sessions);
      let asked = false;
      if (!sessions.length) {
        const r = runEntire<Record<string, unknown>>(['checkpoint', 'explain', id], { ...opts.entire, cwd: dir });
        if (r.ok) {
          asked = true;
          sessions = (Array.isArray(r.data.sessions) ? r.data.sessions : [])
            .map((s) => obj(s)?.session_id)
            .filter((s): s is string => typeof s === 'string');
        } else if (!result.pending.includes(r.reason)) result.pending.push(r.reason);
      }
      if (!src || (asked && sessions.length)) {
        const rel = src?.path ?? path.join('sources', CHECKPOINT_KIND, `${sourceFileSlug(CHECKPOINT_KIND, id)}.md`);
        const srcData: Record<string, unknown> = {
          ...src?.data,
          kind: CHECKPOINT_KIND,
          key: id,
          title: c.subject.slice(0, 200),
          url: repo ? `https://entire.com/gh/${repo}/commit/${c.sha}` : src?.data.url,
          ...(src ? {} : stamp),
          ext: {
            ...obj(src?.data.ext),
            entire: {
              commit: c.sha,
              ...(sessions.length ? { sessions } : {}),
              synced_at: nowIso(),
            },
          },
        };
        writes.set(rel, render('source', srcData, src?.body ?? ''));
        if (!src) created.push(rel);
        events.push(
          src
            ? { op: 'set', key, type: 'source', path: rel, fields: ['ext'], writer: env.writer }
            : { op: 'created', key, type: 'source', path: rel, writer: env.writer },
        );
      }
      for (const change of changes) {
        const rec = loaded.byKey.get(change)?.[0];
        if (!rec) continue;
        const seenBy: string[] = [];
        const d = dataOf(rec);
        const links = list(d.links);
        let wrote = false;
        if (!links.includes(key)) {
          d.links = [...links, key];
          mark(rec, 'links');
          wrote = true;
        }
        for (const sid of sessions) {
          const s = findSession(loaded, sid);
          if (!s) continue;
          const sd = dataOf(s);
          const edges = Array.isArray(sd.observed) ? [...(sd.observed as Record<string, unknown>[])] : [];
          if (edges.some((o) => o.edge === 'links' && o.from === change && o.to === key)) continue;
          edges.push({ edge: 'links', from: change, to: key, at: nowIso() });
          sd.observed = edges;
          mark(s, 'observed');
          seenBy.push(s.key);
          wrote = true;
        }
        if (wrote) result.linked.push({ checkpoint: key, change, sessions: seenBy });
      }
    }
  }
  for (const [rel, fields] of changed) {
    const { rec, data: d } = data.get(rel)!;
    writes.set(rel, render(rec.type, d, rec.body));
    events.push({
      op: fields.has('observed') ? 'observe' : 'set',
      key: rec.key,
      type: rec.type,
      path: rel,
      fields: [...fields],
      writer: env.writer,
    });
  }
  if (writes.size) {
    const touched = [...writes.keys()];
    const prior = snapshot(
      store,
      touched.filter((rel) => !created.includes(rel)),
    );
    for (const [rel, text] of writes) writeFile(store, rel, text);
    validateOrUndo(store, touched, created, prior);
    result.commit = finishWrite(
      store,
      `pjman: sync entire ${project} (${result.linked.length} checkpoint link${result.linked.length === 1 ? '' : 's'})`,
      env.session,
      events,
    );
  }
  return result;
}
