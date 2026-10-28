// Branch and worktree names, derived from a change's key and never stored (decision branch-names/derived-not-stored):
// the change slug under an optional per-person prefix from the user config; the worktree name is the last segment.
// Read backwards, a branch whose last segment is a change slug leads to that change: that is the branch entry in the
// reference grammar (refs.ts), and how a session on such a branch binds the change. The harness's own worktree
// branches carry a `worktree-` prefix before the name; it is dropped on the way back.
import { slugOfKey } from './keys.js';

/** The recommended branch for a change: `<prefix>/<slug>`, or the slug alone when no prefix is configured. */
export function branchNameFor(changeKey: string, prefix?: string): string {
  const slug = slugOfKey(changeKey);
  const p = (prefix ?? '').trim().replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${slug}` : slug;
}

/** The recommended worktree name: the branch name's last segment, which is the change slug. */
export function worktreeNameFor(changeKey: string): string {
  return slugOfKey(changeKey);
}

/** The change slug a branch name implies: its last path segment, less the harness's `worktree-` prefix. */
export function slugOfBranch(branch: string): string {
  const last = branch.replace(/\/+$/, '').split('/').pop() ?? branch;
  return last.replace(/^worktree-/, '').toLowerCase();
}
