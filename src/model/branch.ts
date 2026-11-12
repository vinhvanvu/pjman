// Branch and worktree names, derived from a change's key and never stored (decision branch-names/derived-not-stored):
// the change slug under an optional per-person prefix from the user config; the worktree name is the last segment.
// Read backwards, a branch whose last segment is a change slug leads to that change: that is the branch entry in the
// reference grammar (refs.ts), and how a session on such a branch binds the change. The harness's own worktree
// branches carry a `worktree-` prefix before the name; it is dropped on the way back. The desktop app's worktree
// branches carry a random suffix after it (`claude/desktop-app-af891f`), tried off only when the name as written leads
// nowhere (change:desktop-app).
import { slugOfKey } from '../store/keys.js';

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

/** The desktop app's random worktree suffix: a hyphen and six hex digits after the name the session was given. */
const DESKTOP_SUFFIX = /-[0-9a-f]{6}$/;

/** The change slugs a branch name may imply, in the order to try them: the slug as written, then, when it ends in the
 *  desktop app's worktree suffix, the slug less that suffix. */
export function slugsOfBranch(branch: string): string[] {
  const slug = slugOfBranch(branch);
  const bare = slug.replace(DESKTOP_SUFFIX, '');
  return bare && bare !== slug ? [slug, bare] : [slug];
}
