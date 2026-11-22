// The part a source plays on a change or a session (change:source-edge-roles). What a source is lives on the source:
// its kind, the prefix of its key, written once. The part it plays lives on the edge that reaches it, and only where
// one kind plays several parts and a reader tells them apart (decisions source-edge-roles/where-type-lives,
// role-vocabulary, design-role):
// - binds: the primary, the source the change *is* (a tracker's ticket): at most one per change;
//   a session reads its change's, or, on no change, the ticket or pull request it observed binding itself
// - delivers: a pull request that ships the change
// - design: what the change is built to (a canvas, a design file, an artifact)
// - links: everything else; the kind says whether it is a trail, a branch, a file or a checkpoint
import { parseKey } from '../store/keys.js';
import type { Loaded, Rec } from '../store/records.js';
import { grammarOf } from './refs.js';

/** The roles in the order a change lists its sources: the primary first, a plain link last. */
export const SOURCE_ROLES = ['binds', 'delivers', 'design', 'links'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

/** The source kinds that are a pull request: what `delivers` may reach. */
export const PULL_REQUEST_KINDS = ['github-pr'];

const kindOf = (key: string): string | null => parseKey(key)?.kind ?? null;

/** A key a pull request is keyed by. */
export const isPullRequest = (key: string): boolean => PULL_REQUEST_KINDS.includes(kindOf(key) ?? '');

/** The tracker kinds: a ticket of any tracker pjman knows, whether or not it has a short form to scan for. */
export const TRACKER_KINDS = new Set(['github-issue', 'linear', 'jira']);

/** A tracker's ticket. */
export function isTicket(key: string): boolean {
  const kind = kindOf(key);
  return !!kind && (TRACKER_KINDS.has(kind) || grammarOf(kind)?.ticket === true);
}

/** A key that can be a primary: of a change, a tracker's ticket (decision role-vocabulary); of a session on no change,
 *  a ticket or the pull request it reviews. */
export function canBePrimary(key: string, of: 'change' | 'session' = 'change'): boolean {
  return isTicket(key) || (of === 'session' && isPullRequest(key));
}

/** Why a key cannot play a role on a change, or null when it can. */
export function roleRefusal(role: SourceRole, key: string): string | null {
  if (role === 'binds' && !canBePrimary(key))
    return `binds names the primary, a tracker's ticket; ${key} is a ${kindOf(key) ?? 'key'}: ${isPullRequest(key) ? 'it delivers' : 'link it'}`;
  if (role === 'delivers' && !isPullRequest(key))
    return `delivers names a pull request (${PULL_REQUEST_KINDS.join(', ')}); ${key} is a ${kindOf(key) ?? 'key'}`;
  return null;
}

/** Whether a pull request is of the repository a change's project names: one of another repository is cited, not
 *  delivered. Unknown either way, it is not counted as delivering. */
export function ofRepo(key: string, repo: string | undefined): boolean {
  const rest = parseKey(key)?.rest ?? '';
  return !!repo && rest.toLowerCase().startsWith(`${repo.toLowerCase()}#`);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The role an observed edge takes when the tool is handed a plain link: a pull request of the change's own repository
 *  (`repo`) linked from a change delivers it, one of another repository is cited; where the project names no repository,
 *  the pull request of the branch the session stood on (`onBranch`) delivers it. A session on no change binds the first
 *  ticket or pull request it is seen on. Anything else is as it was handed. */
export function observedRole(
  sessionRec: Rec,
  edge: string,
  from: string,
  to: string,
  repo?: string,
  onBranch = false,
): string {
  if (edge !== 'links') return edge;
  if (from.startsWith('change:') && isPullRequest(to))
    return ofRepo(to, repo) || (!repo && onBranch) ? 'delivers' : edge;
  if (from === sessionRec.key && canBePrimary(to, 'session')) {
    const bound = strings(sessionRec.data.changes).length > 0;
    const has = (Array.isArray(sessionRec.data.observed) ? sessionRec.data.observed : []).some(
      (o) => (o as { edge?: string; from?: string })?.edge === 'binds' && (o as { from?: string }).from === from,
    );
    if (!bound && !has) return 'binds';
  }
  return edge;
}

/** The primary of a change (what it binds) or of a session: its change's when it is on exactly one, else the source it
 *  observed binding itself. Null when there is none. */
export function primaryOf(loaded: Loaded, rec: Rec): string | null {
  if (rec.type === 'change') return strings(rec.data.binds)[0] ?? null;
  if (rec.type !== 'session') return null;
  const changes = strings(rec.data.changes);
  if (changes.length === 1) {
    const ch = loaded.byKey.get(changes[0])?.[0];
    const p = ch ? primaryOf(loaded, ch) : null;
    if (p) return p;
  }
  for (const o of Array.isArray(rec.data.observed) ? rec.data.observed : []) {
    const e = o as { edge?: unknown; from?: unknown; to?: unknown };
    if (e?.edge === 'binds' && e.from === rec.key && typeof e.to === 'string') return e.to;
  }
  return null;
}
