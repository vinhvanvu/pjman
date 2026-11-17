// pjman merge <change> (change:merge-via-pr): the one verb for landing a change's branch on the base. In a project that
// opted in to Entire the merge is Entire's: `entire trail merge` checks the Trail's gates (review, findings, checks, up
// to date) and merges the pull request; pjman then pulls the base and sets the change done. A gate that blocks is
// printed and nothing is merged, here or locally: pjman never forces a merge past a gate and never approves one.
// Elsewhere the merge is local: a merge commit on the base naming the change, then done.
import { entireOn, runEntire, type EntireOpts } from '../entire/entire.js';
import { set } from '../ops/set.js';
import type { Store } from '../store/config.js';
import { git } from '../store/git.js';
import { loadStore } from '../store/records.js';
import { live } from '../model/tree.js';
import { CliError } from '../store/util.js';
import { observedBranches } from '../model/view.js';
import { baseBranch, branchesOf, mergedInto } from './git.js';

export interface MergeResult {
  change: string;
  branch: string;
  base: string;
  /** Who made the merge: Entire (the Trail's gated merge), pjman (a local merge), or nobody (it was already merged). */
  by: 'entire' | 'local' | 'already';
  /** What was left undone and why: the base not pulled (another branch is checked out, the pull failed). */
  notes: string[];
  /** The store commit that set the change done, or null when it already was. */
  commit: string | null;
}

const tryGit = (cwd: string, args: string[]): string | null => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

export function mergeChange(
  store: Store,
  key: string,
  opts: { session?: string; entire?: EntireOpts } = {},
): MergeResult {
  const loaded = loadStore(store);
  const rec = live(loaded, key);
  if (!rec) throw new CliError(`${key} is not a change`);
  const dir = store.projectDir;
  if (!dir) throw new CliError('merge runs in a project: run it inside the registered repository');
  if (rec.type !== 'change') throw new CliError(`${rec.key} is a ${rec.type}; merge takes a change`);
  if (rec.data.kind === 'milestone')
    throw new CliError(`${rec.key} is a milestone: its children merge, each on its own`);
  const base = baseBranch(dir);
  const local = new Set((tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? '').split('\n'));
  const branch = branchesOf(rec, observedBranches(loaded)).find((b) => b !== base && local.has(b));
  if (!branch) throw new CliError(`${rec.key} has no branch in this repository to merge`);
  const named = `change:${rec.changeSlug}`;
  const notes: string[] = [];
  const done = (by: MergeResult['by'], because: string): MergeResult => ({
    change: rec.key,
    branch,
    base,
    by,
    notes,
    commit:
      rec.data.status === 'done'
        ? null
        : set(store, rec.key, ['status=done'], { session: opts.session, because }).commit,
  });

  const already = mergedInto(dir, branch, { base, named });
  if (already) return done('already', `${branch} is merged into ${already.on} (${already.how})`);

  if (entireOn(loaded, store.project)) {
    const r = runEntire<Record<string, unknown>>(['trail', 'merge', '--branch', branch], {
      ...opts.entire,
      cwd: dir,
      timeout: 120_000,
    });
    if (!r.ok)
      throw new CliError(
        `not merged: ${r.reason}\n${rec.key} merges through its Trail on Entire, whose gates decide; nothing was merged locally (entire trail merge --branch ${branch} --dry-run names what blocks)`,
      );
    // the merge happened on the remote: bring the base here, when that is safe to do
    if (tryGit(dir, ['fetch', '--quiet', 'origin', base]) === null)
      notes.push(`origin was not fetched; run git pull on ${base}`);
    else if (tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) !== base)
      notes.push(`${base} is not checked out here; git pull on it brings the merge`);
    else if (tryGit(dir, ['merge', '--ff-only', '--quiet', `origin/${base}`]) === null)
      notes.push(`${base} could not be fast-forwarded to origin/${base}; pull it by hand`);
    return done('entire', `${branch} merged through its Trail on Entire`);
  }

  // the local merge: on the base, with nothing uncommitted in the way
  if (tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) !== base)
    throw new CliError(`not merged: ${dir} is not on ${base}; check it out there first`);
  if (tryGit(dir, ['status', '--porcelain', '--untracked-files=no']))
    throw new CliError(`not merged: ${dir} has uncommitted changes; commit or set them aside first`);
  const gist = typeof rec.data.gist === 'string' ? rec.data.gist : rec.changeSlug;
  try {
    git(dir, ['merge', '--no-ff', '--quiet', branch, '-m', `Merge branch '${branch}': ${gist} (${named})`]);
  } catch (e) {
    tryGit(dir, ['merge', '--abort']);
    throw new CliError(
      `not merged: ${branch} does not merge cleanly into ${base} (${(e as Error).message.split('\n')[0]}); the merge was aborted`,
    );
  }
  return done('local', `${branch} merged into ${base}`);
}
