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
import { CliError, nowIso } from '../store/util.js';
import { findingsOf, formatFinding, holdsMerge } from '../model/findings.js';
import { observedBranches } from '../model/view.js';
import { localHeads } from '../store/merged.js';
import { baseBranch, branchesOf, mergedInto } from './git.js';
import { formatLoop, readFindings, reviewLoop } from './review.js';
import { learnCode } from '../ops/code.js';
import { withStoreLock } from '../store/lock.js';

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
  const branch = branchesOf(rec, observedBranches(loaded), localHeads(dir)).find((b) => b !== base && local.has(b));
  if (!branch) throw new CliError(`${rec.key} has no branch in this repository to merge`);
  const named = `change:${rec.changeSlug}`;
  const notes: string[] = [];
  // the merge waits on Entire and git for minutes, so it takes the store's lock around each write, not the command
  const done = (by: MergeResult['by'], because: string): MergeResult =>
    withStoreLock(store.root, () => {
      const commit =
        rec.data.status === 'done'
          ? null
          : set(store, rec.key, ['status=done'], { session: opts.session, because }).commit;
      // what the merge teaches the capabilities the change names (decision capability-code-paths/upkeep)
      const learned = learnCode(store, rec.key, branch, opts.session);
      if (learned) notes.push(learned);
      return { change: rec.key, branch, base, by, notes, commit };
    });

  const already = mergedInto(dir, branch, { base, named });
  if (already) return done('already', `${branch} is merged into ${already.on} (${already.how})`);

  // a finding of high severity, or one saying the done-when is not met, holds the merge while it stands (decision
  // review-loop/stop-rule): here as on the Trail, whose gate knows severity alone. Every other finding waits on the
  // merge too until it is handled (decision review-fixes-in-place/where-findings-go): none is merged past unsaid
  const held = (): void => {
    const findings = findingsOf(live(loadStore(store), rec.key)?.data ?? {});
    const holding = findings.map((f, i) => (holdsMerge(f) ? formatFinding(i + 1, f) : '')).filter(Boolean);
    if (holding.length)
      throw new CliError(
        `not merged: ${holding.length} finding${holding.length === 1 ? ' holds' : 's hold'} the merge of ${rec.key}\n${holding.join('\n')}\nfix and resolve each (pjman review ${rec.key} --resolve <n> --note "…"), or dismiss one that does not hold (--dismiss <n> --note "…")`,
      );
    // a project that reviews every change merges none unreviewed: the full review, and the re-review of a fix, come
    // first, whoever started the merge and whether or not a hook was there to say so
    const loop = reviewLoop(store, rec.key);
    if (loop.due && (loop.state === 'due' || loop.state === 'recheck'))
      throw new CliError(`not merged: ${formatLoop(loop)}`);
    const open = findings.map((f, i) => (f.state === 'open' ? formatFinding(i + 1, f) : '')).filter(Boolean);
    if (open.length)
      throw new CliError(
        `not merged: ${open.length} finding${open.length === 1 ? ' is' : 's are'} not handled on ${rec.key}\n${open.join('\n')}\nfix and resolve each on its branch (pjman review ${rec.key} --resolve <n> --note "…"), dismiss one that is not a fault (--dismiss <n> --note "…"), or, where the person says so in so many words, defer it (--defer <n> --note "…" --by person:<handle>)`,
      );
  };

  if (entireOn(loaded, store.project)) {
    // Entire merges what is on the remote: local commits not pushed would be left behind on a branch called merged
    const remote = tryGit(dir, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (remote && tryGit(dir, ['merge-base', '--is-ancestor', branch, remote]) === null)
      throw new CliError(`not merged: ${branch} has commits that are not on origin; push it first`);
    // the Trail's findings are read onto the change now: once the branch is merged Entire lists them no more
    try {
      const read = readFindings(store, rec.key, { session: opts.session, entire: opts.entire });
      if (read.read.length)
        notes.push(
          `${read.read.length} finding${read.read.length === 1 ? '' : 's'} read from the Trail onto the change`,
        );
      // (a change with no Trail has none to read: the merge below says what it needs)
      else if (read.pending.length && !/has no Trail yet/.test(read.pending[0]))
        notes.push(`the Trail's findings were not read (${read.pending[0]})`);
    } catch (e) {
      notes.push(`the Trail's findings were not read (${(e as Error).message.split('\n')[0]})`);
    }
    held();
    const r = runEntire<Record<string, unknown>>(['trail', 'merge', '--branch', branch], {
      ...opts.entire,
      cwd: dir,
      timeout: 120_000,
    });
    if (!r.ok)
      throw new CliError(
        `not merged: ${r.reason}\n${rec.key} merges through its Trail on Entire, whose gates decide; nothing was merged locally (entire trail merge --branch ${branch} --dry-run names what blocks)`,
      );
    // the merge went through the Trail's gates: kept on the change, so whichever command reads the merge later (this
    // one, or a sync after a fetch or after Entire was slow to answer) does not say it went past a gate kept from an
    // earlier read
    try {
      withStoreLock(store.root, () =>
        set(store, rec.key, [`ext.entire.merged_through=${nowIso()}`], {
          session: opts.session,
          because: `${branch} merged through its Trail on Entire`,
        }),
      );
    } catch (e) {
      notes.push(`that the merge went through the Trail was not kept (${(e as Error).message.split('\n')[0]})`);
    }
    // the merge happened on the remote: bring the base here, when that is safe to do
    if (tryGit(dir, ['fetch', '--quiet', 'origin', base]) === null)
      notes.push(`origin was not fetched; run git pull on ${base}`);
    else if (tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) !== base)
      notes.push(`${base} is not checked out here; git pull on it brings the merge`);
    else if (tryGit(dir, ['merge', '--ff-only', '--quiet', `origin/${base}`]) === null)
      notes.push(`${base} could not be fast-forwarded to origin/${base}; pull it by hand`);
    // done is said of a merge that is seen, never of an answer alone
    if (!mergedInto(dir, branch, { base, named }))
      throw new CliError(
        `Entire answered the merge of ${branch}, but it is not on origin/${base} here yet, so ${rec.key} was not set done; pjman sync git sets it once the merge is fetched`,
      );
    return done('entire', `${branch} merged through its Trail on Entire`);
  }

  held();
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
