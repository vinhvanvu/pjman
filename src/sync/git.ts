// pjman sync git (change:merge-via-pr): pjman follows merges it did not make. A change's work reaches the base branch
// in more ways than a local `git merge`: a pull request merged on GitHub (or through an Entire Trail) with a merge
// commit, squashed into one commit, or rebased onto the base; fetched or pulled afterwards. Each leaves different
// evidence, read here from the repository alone, against the base and its remote-tracking branch:
//   merge    a merge commit on the base that brought the branch's tip in
//   squash   one commit on the base holding exactly the branch's whole diff (`git cherry` on the branch's tree
//            committed once onto the fork point)
//   rebase   every commit of the branch has a twin on the base with the same patch
//   forward  the branch's tip is on the base and a commit there names the change (a fast-forward)
// A change in review whose branch is merged is set done: the merge was the person's act, wherever they made it.
import type { Store } from '../store/config.js';
import { git } from '../store/git.js';
import { loadStore, type Rec } from '../store/records.js';
import { CliError } from '../store/util.js';
import { branchOf, observedBranches } from '../model/view.js';
import { branchNameFor, worktreeNameFor } from '../model/branch.js';
import { set } from '../ops/set.js';

const tryGit = (cwd: string, args: string[]): string => {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
};
const holds = (cwd: string, args: string[]): boolean => {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
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

export type MergedHow = 'merge' | 'squash' | 'rebase' | 'forward';
export interface Merged {
  how: MergedHow;
  /** The base ref the work is on: the base branch, or its remote-tracking branch when only the fetch has it. */
  on: string;
  /** The commit on the base that carries it, when one commit does (the merge, the squash). */
  commit?: string;
}

/** The refs a branch may have been merged into: the base branch and what was last fetched of it. */
export function baseRefs(dir: string, base = baseBranch(dir)): string[] {
  return [base, `origin/${base}`].filter((r) => holds(dir, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]));
}

/** Whether a branch's work is on the base, and how it got there; null when it is not, or the branch has no work of
 *  its own to tell by. `named` is a pattern a commit on the base matches when it names the branch's change: it is what
 *  tells a fast-forwarded branch from one that was only just cut. Reads git only (one dangling commit object is
 *  written for the squash test, which git prunes). */
export function mergedInto(dir: string, branch: string, opts: { base?: string; named?: string } = {}): Merged | null {
  const tip = tryGit(dir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]);
  if (!tip) return null;
  for (const on of baseRefs(dir, opts.base)) {
    if (tryGit(dir, ['rev-parse', on]) === tip) {
      // the base sits on the branch's tip: fast-forwarded there, or the branch was cut and never built on
      if (opts.named && tryGit(dir, ['log', '-1', '--format=%H', '-F', `--grep=${opts.named}`, on]))
        return { how: 'forward', on };
      continue;
    }
    if (holds(dir, ['merge-base', '--is-ancestor', tip, on])) {
      // on the base: through a merge commit that brought it in, else fast-forwarded and built past
      const merges = tryGit(dir, ['log', '--first-parent', '--merges', '--format=%H %P', `${tip}..${on}`]).split('\n');
      for (const line of merges.toReversed()) {
        const [sha, , second] = line.split(' ');
        if (second && (second === tip || holds(dir, ['merge-base', '--is-ancestor', tip, second])))
          return { how: 'merge', on, commit: sha };
      }
      if (opts.named && tryGit(dir, ['log', '-1', '--format=%H', '-F', `--grep=${opts.named}`, on]))
        return { how: 'forward', on };
      continue;
    }
    const fork = tryGit(dir, ['merge-base', on, tip]);
    if (!fork) continue;
    // rebased: every commit of the branch has a twin on the base
    const cherry = tryGit(dir, ['cherry', on, tip]).split('\n').filter(Boolean);
    if (cherry.length && cherry.every((l) => l.startsWith('-'))) return { how: 'rebase', on };
    // squashed: the branch's whole diff, as one commit on the fork point, has a twin on the base
    const whole = tryGit(dir, ['commit-tree', `${tip}^{tree}`, '-p', fork, '-m', 'pjman: the branch as one commit']);
    if (whole && tryGit(dir, ['cherry', on, whole]).startsWith('-')) return { how: 'squash', on };
  }
  return null;
}

/** The branch names a change's work may be on, most likely first: the one a session was seen on, the recommended
 *  name, the worktree's. */
export function branchesOf(rec: Rec, observed: ReturnType<typeof observedBranches>): string[] {
  return [...new Set([branchOf(rec, observed).name, branchNameFor(rec.key, undefined), worktreeNameFor(rec.key)])];
}

export interface GitSyncResult {
  project: string;
  base: string;
  /** Changes this run set done, with the branch and how it was merged. */
  done: { change: string; branch: string; how: MergedHow; on: string; commit: string | null }[];
  /** Done changes whose branch still exists locally and is merged: safe to remove with its worktree. */
  merged: { change: string; branch: string; how: MergedHow }[];
}

/** Follow the repository: every change of the project in review whose branch has been merged into the base is set
 *  done, one write each (`pjman undo` reverses one). `write: false` only reports. */
export function syncGit(store: Store, opts: { session?: string; write?: boolean } = {}): GitSyncResult {
  const loaded = loadStore(store);
  const project = store.project;
  const dir = store.projectDir;
  if (!project || !dir) throw new CliError('sync git reads a project: run it inside a registered project');
  const base = baseBranch(dir);
  const result: GitSyncResult = { project, base, done: [], merged: [] };
  const observed = observedBranches(loaded);
  const local = new Set(
    tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean),
  );
  for (const rec of loaded.records) {
    if (rec.type !== 'change' || !rec.valid || rec.data.project !== project) continue;
    const status = rec.data.status;
    if (status !== 'review' && status !== 'done') continue;
    if (rec.data.kind === 'milestone') continue;
    const branch = branchesOf(rec, observed).find((b) => b !== base && local.has(b));
    if (!branch) continue;
    const m = mergedInto(dir, branch, { base, named: `change:${rec.changeSlug}` });
    if (!m) continue;
    if (status === 'done') {
      result.merged.push({ change: rec.key, branch, how: m.how });
      continue;
    }
    const commit =
      opts.write === false
        ? null
        : set(store, rec.key, ['status=done'], {
            session: opts.session,
            because: `${branch} is merged into ${m.on} (${m.how}${m.commit ? `, ${m.commit.slice(0, 7)}` : ''})`,
          }).commit;
    result.done.push({ change: rec.key, branch, how: m.how, on: m.on, commit: commit ?? null });
    result.merged.push({ change: rec.key, branch, how: m.how });
  }
  return result;
}
