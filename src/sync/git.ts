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
import { baseBranch, localHeads, mergedInto, tryGit, type MergedHow } from '../store/merged.js';
import { loadStore, type Rec } from '../store/records.js';
import { CliError } from '../store/util.js';
import { branchOf, observedBranches, ownBranches, type LocalBranch } from '../model/view.js';
import { branchNameFor, worktreeNameFor } from '../model/branch.js';
import { set } from '../ops/set.js';

export { baseBranch, baseRefs, mergedBranch, mergedInto, type Merged, type MergedHow } from '../store/merged.js';

/** The branch names a change's work may be on, most likely first: the one the views name (change:branch-line-own-branch),
 *  then every branch among the repository's `local` ones named for the change, as localHeads lists them, so a branch
 *  of its own is found where the views name one that is not in this repository; then the recommended name and the
 *  worktree's. A branch a session was seen on that is named for another change is never among them. */
export function branchesOf(
  rec: Rec,
  observed: ReturnType<typeof observedBranches>,
  local: LocalBranch[] = [],
): string[] {
  const shown = branchOf(rec, observed, undefined, () => local).name;
  const mine = ownBranches(observed.loaded, rec, local).map((l) => l.name);
  return [...new Set([shown, ...mine, branchNameFor(rec.key, undefined), worktreeNameFor(rec.key)])];
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
  const heads = localHeads(dir);
  const local = new Set(
    tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean),
  );
  for (const rec of loaded.records) {
    if (rec.type !== 'change' || !rec.valid || rec.data.project !== project) continue;
    const status = rec.data.status;
    if (status !== 'review' && status !== 'done') continue;
    if (rec.data.kind === 'milestone') continue;
    const branch = branchesOf(rec, observed, heads).find((b) => b !== base && local.has(b));
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
