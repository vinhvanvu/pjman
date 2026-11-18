// pjman sync entire (change:checkpoint-link): the Entire checkpoints behind a project's commits, linked to the changes
// those commits built and to the sessions that made them. Entire writes a checkpoint (the prompts, transcript and tool
// activity of the sessions since the last commit) at every commit and names it in the commit's `Entire-Checkpoint`
// trailer; pjman and Entire know a session by the same id. So: every commit of the repository that carries the trailer
// is read from git, the change it belongs to is the one its message names (`change:<slug>`), else the one its branch
// was cut for, and the checkpoint becomes a source (`entire-checkpoint:<id>`, opening on entire.com at its commit) in
// the change's links, observed by each session of the store that contributed to it. Only for a project that opted in;
// what Entire does not answer is left pending and read again by the next sync.
import { execFileSync } from 'node:child_process';
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
import { baseBranch, mergedBranch } from './git.js';
import { note } from '../ops/note.js';
import { fileFindings } from './review.js';
import { reconcileTrail, trailCandidates, trailOf, type TrailReconcile } from './trail.js';

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
  /** Each change's Trail, brought to where the change stands and read back (change:trail-lifecycle). */
  trails: TrailReconcile[];
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

/** git for a read that may be long: the whole answer, or a throw; never an answer cut short and taken for empty. */
const longGit = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  }).trim();
const isAncestor = (dir: string, a: string, b: string): boolean => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: dir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** The base as a ref git can read here: the local branch, else what was fetched of it. */
function baseRefOf(dir: string): string {
  const base = baseBranch(dir);
  return tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`]) ? base : `origin/${base}`;
}

/** Every commit of the repository's local branches that carries an `Entire-Checkpoint` trailer, oldest first, with no
 *  branch yet. One git call, over the commits that carry the trailer only; a log that fails throws. */
export function trailerCommits(dir: string): CheckpointCommit[] {
  const SEP = '\x1f';
  const END = '\x1e';
  const raw = longGit(dir, [
    'log',
    '--reverse',
    '--branches',
    '--grep=^Entire-Checkpoint:',
    `--format=%H${SEP}%s${SEP}%b${SEP}%(trailers:key=Entire-Checkpoint,valueonly,separator=%x2c)${END}`,
  ]);
  const commits: CheckpointCommit[] = [];
  for (const entry of raw.split(END)) {
    const [sha, subject, body, trailers] = entry.replace(/^\s+/, '').split(SEP);
    const checkpoints = (trailers ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => /^[0-9A-Za-z]{20,40}$/.test(t));
    if (sha && checkpoints.length) commits.push({ sha, subject, body: body ?? '', checkpoints, branches: [] });
  }
  return commits;
}

/** The branch whose own work a commit is, written onto it. Not yet merged: the branches that hold it, less any
 *  stacked on another that holds it (the work is the lower branch's). Merged with a merge commit: the branch that
 *  merge brought in. A few git calls per commit, so it is asked only of the commits that need it. */
export function attribute(dir: string, commits: CheckpointCommit[]): void {
  if (!commits.length) return;
  const base = baseBranch(dir);
  const baseRef = baseRefOf(dir);
  for (const c of commits) {
    if (!isAncestor(dir, c.sha, baseRef)) {
      const holding = tryGit(dir, [
        'for-each-ref',
        '--format=%(refname:short) %(objectname)',
        '--contains',
        c.sha,
        'refs/heads',
      ])
        .split('\n')
        .map((l) => l.split(' '))
        .filter(([b]) => b && b !== base);
      c.branches = holding
        .filter(([, tip]) => !holding.some(([, lower]) => lower !== tip && isAncestor(dir, lower, tip)))
        .map(([b]) => b);
      continue;
    }
    // on the base: the oldest commit of the base's own line that descends from it is the merge that brought it in
    const own = new Set(tryGit(dir, ['rev-list', '--first-parent', `${c.sha}..${baseRef}`]).split('\n'));
    const merge = tryGit(dir, ['rev-list', '--ancestry-path', `${c.sha}..${baseRef}`])
      .split('\n')
      .toReversed()
      .find((sha) => sha && own.has(sha));
    if (!merge || !isAncestor(dir, c.sha, `${merge}^2`)) continue;
    const branch = mergedBranch(tryGit(dir, ['log', '-1', '--format=%s', merge]));
    c.branches = branch ? [branch] : [];
  }
}

/** The trailer commits with the branch each is the work of. Reads git only. */
export function checkpointCommits(dir: string): CheckpointCommit[] {
  let commits: CheckpointCommit[];
  try {
    commits = trailerCommits(dir);
  } catch {
    return [];
  }
  attribute(dir, commits);
  return commits;
}

/** The changes a commit belongs to: those its message names by key, else those its branches were cut for. */
function changesOf(loaded: Loaded, c: CheckpointCommit, opts: { project?: string; projectDir?: string }): string[] {
  const named = findReferences(loaded, `${c.subject}\n${c.body}`, opts)
    .filter((r) => r.change && r.text.startsWith('change:'))
    .map((r) => r.change!);
  if (named.length) return [...new Set(named)];
  if (opts.projectDir && !c.branches.length) attribute(opts.projectDir, [c]);
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
  /** Write a note on a change when its Trail moved (a gate passed or failed, a finding, a merge), which wakes the
   *  session waiting on it. The dashboard's follower passes it; a session's own sync does not wake itself. */
  wake?: boolean;
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
    throw new CliError(
      `the store has no ${CHECKPOINT_KIND} source kind: run pjman migrate, or, where the store lists its own kinds, add it to source_kinds in pjman.yaml`,
    );
  const result: EntireSyncResult = {
    project,
    checkpoints: 0,
    linked: [],
    unplaced: 0,
    pending: [],
    commit: null,
    trails: [],
  };
  let commits: CheckpointCommit[];
  try {
    commits = trailerCommits(dir);
  } catch (e) {
    // the history could not be read: said, never taken for a repository with no checkpoints
    // (the Trails below are still followed)
    result.pending.push(`git log failed in ${dir}: ${(e as Error).message.split('\n')[0].slice(0, 200)}`);
    commits = [];
  }
  // a checkpoint on several commits (a cherry-pick, a rebase whose old copy is still a branch) is one checkpoint: the
  // commit on the base speaks for it, else the newest
  const carriers = new Map<string, CheckpointCommit[]>();
  for (const c of commits) for (const id of c.checkpoints) carriers.set(id, [...(carriers.get(id) ?? []), c]);
  const canonical = new Map<string, string>();
  const baseRef = baseRefOf(dir);
  for (const [id, cs] of carriers)
    canonical.set(
      id,
      (cs.length > 1 ? cs.find((c) => isAncestor(dir, c.sha, baseRef)) : undefined)?.sha ?? cs.at(-1)!.sha,
    );
  // Entire is asked for a bounded number of checkpoints a run, and no more once it has failed to answer one
  let asks = 25;
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
      if (canonical.get(id) !== c.sha) continue;
      result.checkpoints++;
      if (!changes.length) {
        result.unplaced++;
        continue;
      }
      const key = `${CHECKPOINT_KIND}:${id}`;
      const src = loaded.byKey.get(key)?.[0];
      // the sessions behind the checkpoint: known from an earlier sync, else asked of Entire
      const known = obj(obj(src?.data.ext)?.entire);
      let sessions = list(known?.sessions);
      let asked = false;
      // asked once it has answered, even with no session; not asked again this run once a call has failed
      if (!sessions.length && known?.explained !== true && asks > 0) {
        asks--;
        const r = runEntire(['checkpoint', 'explain', id], { ...opts.entire, cwd: dir });
        const answer = r.ok ? obj(r.data) : undefined;
        if (answer) {
          asked = true;
          sessions = (Array.isArray(answer.sessions) ? answer.sessions : [])
            .map((s) => obj(s)?.session_id)
            .filter((s): s is string => typeof s === 'string');
        } else {
          asks = 0;
          const reason = r.ok ? `entire checkpoint explain ${id} answered nothing readable` : r.reason;
          if (!result.pending.includes(reason)) result.pending.push(reason);
        }
      }
      // written when new, when Entire has just answered, and when the trailer now sits on another commit (a rebase,
      // an amend, a squash): the link opens on the commit that exists
      if (!src || asked || known?.commit !== c.sha) {
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
              ...(asked || known?.explained === true ? { explained: true } : {}),
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
  // the Trails: each change in motion, or bound to a Trail still open, is reconciled and read back
  // (the follower, which passes --wake every minute, reads only the Trails a session waits on: changes in review with
  // a Trail, each within a budget; one change that cannot be written does not stop the others)
  const after = loadStore(store);
  const candidates = trailCandidates(after, project).filter(
    (rec) => !opts.wake || (rec.data.status === 'review' && !!trailOf(after, rec)),
  );
  for (const rec of candidates) {
    let t: TrailReconcile | null;
    try {
      t = reconcileTrail(store, rec.key, {
        session: opts.session,
        writer: opts.writer,
        entire: opts.entire,
        budget: opts.wake ? 30_000 : undefined,
      });
    } catch (e) {
      const reason = `${rec.key}: ${(e as Error).message.split('\n')[0]}`;
      if (!result.pending.includes(reason)) result.pending.push(reason);
      continue;
    }
    if (!t) continue;
    result.trails.push(t);
    // findings not yet on the Trail (filed while Entire did not answer, or before the Trail existed) are filed now
    try {
      for (const p of fileFindings(store, rec.key, { session: opts.session, writer: opts.writer, entire: opts.entire })
        .pending)
        if (!t.pending.includes(p)) t.pending.push(p);
    } catch (e) {
      t.pending.push(`${rec.key}: ${(e as Error).message.split('\n')[0]}`);
    }
    for (const p of t.pending) if (!result.pending.includes(p)) result.pending.push(p);
    if (opts.wake && t.moved.length && t.state)
      note(store, rec.key, `Entire, Trail #${t.state.number}: ${t.moved.join('; ')}`, { writer: opts.writer });
  }
  return result;
}
