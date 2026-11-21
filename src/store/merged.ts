// What the repository says of a branch, read from git alone: the base branch, and whether a branch's work has reached
// it and how. Below the store's operations, so a write can ask it (ops/promote) as the syncs do (sync/git).
import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.js';

export const tryGit = (cwd: string, args: string[]): string => {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
};
export const holds = (cwd: string, args: string[]): boolean => {
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

/** The local branches of the repository at `dir`, newest commit first, each with the name of the worktree that has it
 *  checked out when a folder other than `dir` does. */
export function localHeads(dir: string): { name: string; worktree?: string }[] {
  const out = tryGit(dir, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(worktreepath)',
    'refs/heads',
  ]);
  const real = (p: string): string | null => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null; // the folder is gone: the branch is checked out nowhere to be found
    }
  };
  const home = real(dir);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, at] = line.split('\t');
      const where = at ? real(at) : null;
      return where && where !== home ? { name, worktree: path.basename(at) } : { name };
    });
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

/** Whether a commit on a ref names the key whole: `change:trail` is not named by `change:trail-lifecycle`. */
function namedOn(dir: string, named: string, on: string): boolean {
  const pattern = `${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9/-]|$)`;
  return !!tryGit(dir, ['log', '-1', '--format=%H', '-E', `--grep=${pattern}`, on]);
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
      if (opts.named && namedOn(dir, opts.named, on)) return { how: 'forward', on };
      continue;
    }
    if (holds(dir, ['merge-base', '--is-ancestor', tip, on])) {
      // on the base: through a merge commit that brought it in, else fast-forwarded and built past
      const merges = tryGit(dir, ['log', '--first-parent', '--merges', '--format=%H %P', `${tip}..${on}`]).split('\n');
      for (const line of merges.toReversed()) {
        const [sha, first, second] = line.split(' ');
        // the merge that brought the tip in: the tip came by the second parent and was not on the base before it.
        // A branch with no commits of its own sits on the base's own line, and no merge of another branch is its merge
        if (
          second &&
          !holds(dir, ['merge-base', '--is-ancestor', tip, first]) &&
          (second === tip || holds(dir, ['merge-base', '--is-ancestor', tip, second]))
        )
          return { how: 'merge', on, commit: sha };
      }
      if (opts.named && namedOn(dir, opts.named, on)) return { how: 'forward', on };
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
