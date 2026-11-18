// The review loop (change:review-loop). How a project's changes are reviewed is a setting on the project record
// (decision review-loop/setting): `ext.review.mode` is off, request (the default: pjman review only when asked) or auto
// (a change reaching review is reviewed without being asked). The loop has an end by rule (decision
// review-loop/stop-rule): one full review; the findings that hold the merge (high severity, or the done-when not met)
// are fixed; one re-review of the fix alone; then it ends and says why, and what does not hold the merge goes to one
// follow-up change. A round is data on the change (`reviews`), as its findings are; where the loop stands is read from
// the two, never stored.
import { findingsOf, holdsMerge, wouldHold, type Finding } from './findings.js';
import type { Loaded } from '../store/records.js';

export const REVIEW_MODES = ['off', 'request', 'auto'] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const REVIEW_ROUNDS = ['full', 'fix'] as const;
export type RoundKind = (typeof REVIEW_ROUNDS)[number];
/** The lenses a full review is made through, one reviewer each. */
export const REVIEW_LENSES = ['intent', 'drift', 'correctness'] as const;
export type ReviewLens = (typeof REVIEW_LENSES)[number];

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** What the project record says of review, as written: undefined when it says nothing. */
export function reviewModeWritten(loaded: Loaded, project?: string): unknown {
  if (!project) return undefined;
  return obj(obj(loaded.byKey.get(project)?.[0]?.data.ext)?.review)?.mode;
}

/** How the project's changes are reviewed: `pjman set <project> ext.review.mode=off|request|auto`. On request when the
 *  record says nothing, or something that is none of the three. */
export function reviewMode(loaded: Loaded, project?: string): ReviewMode {
  const v = reviewModeWritten(loaded, project);
  return (REVIEW_MODES as readonly unknown[]).includes(v) ? (v as ReviewMode) : 'request';
}

export interface Round {
  round: RoundKind;
  at: string;
  /** The branch's head when the round was closed: the fix is what came after the full round's. */
  head?: string;
  by?: string;
}

/** The review rounds a change holds, as written; a malformed entry is left out (the validator names it). */
export function roundsOf(data: Record<string, unknown>): Round[] {
  if (!Array.isArray(data.reviews)) return [];
  const out: Round[] = [];
  for (const raw of data.reviews) {
    const r = obj(raw);
    const at = str(r?.at);
    if (!r || !at || !(REVIEW_ROUNDS as readonly unknown[]).includes(r.round)) continue;
    out.push({
      round: r.round as RoundKind,
      at,
      ...(str(r.head) ? { head: str(r.head) } : {}),
      ...(str(r.by) ? { by: str(r.by) } : {}),
    });
  }
  return out;
}

/** Where the loop stands. `none`: nothing to review (not in review, or no branch). `due`: the full review has not been
 *  made. `fixing`: findings hold the merge. `recheck`: they were fixed, and the fix has not been re-reviewed.
 *  `closing`: the review is over but findings that do not hold the merge are still on the change. `ended`: over. */
export type LoopState = 'none' | 'due' | 'fixing' | 'recheck' | 'closing' | 'ended';

export interface Loop {
  state: LoopState;
  /** Why it ended, once it has (closing or ended). */
  because?: string;
  full?: Round;
  fix?: Round;
  /** The findings that hold the merge now, by number from 1. */
  holding: number[];
  /** The findings held and since resolved: what the re-review reads. */
  fixed: number[];
  /** The open findings that do not hold the merge: what goes to the follow-up change. */
  left: number[];
}

/** Where a change's review loop stands, from its rounds and findings. `reviewable` says there is a branch with work on
 *  it to review; without one a change is never due. */
export function loopOf(data: Record<string, unknown>, opts: { reviewable: boolean }): Loop {
  const findings = findingsOf(data);
  const rounds = roundsOf(data);
  const full = rounds.find((r) => r.round === 'full');
  const fix = rounds.find((r) => r.round === 'fix');
  const nums = (pick: (f: Finding) => boolean): number[] =>
    findings.map((f, i) => (pick(f) ? i + 1 : 0)).filter((n) => n > 0);
  const holding = nums(holdsMerge);
  const left = nums((f) => f.state === 'open' && !wouldHold(f));
  // fixed since the full review: one settled before it was reviewed again by that round, and is not the fix's to read
  const fixed = full
    ? nums((f) => f.state === 'resolved' && wouldHold(f) && (f.settled ?? f.at ?? full.at) >= full.at)
    : [];
  const base = { full, fix, holding, fixed, left };
  if (!full) return { ...base, state: data.status === 'review' && opts.reviewable ? 'due' : 'none' };
  if (!fix) {
    // what the re-review itself brought: a finding reopened since the full review (the fix did not hold), or one filed
    // since. These do not send the loop back to fixing: there is one re-review, and it is closed with them standing
    const reopened = (f: Finding): boolean => f.state === 'open' && !!f.settled && f.settled >= full.at;
    const late = (f: Finding): boolean => reopened(f) || (f.at ?? '') > full.at;
    const held = holding.map((n) => findings[n - 1]);
    const fixTried = fixed.length > 0 || held.some(reopened);
    if (fixTried && held.every(late)) return { ...base, state: 'recheck' };
    if (holding.length) return { ...base, state: 'fixing' };
  }
  const n = holding.length;
  const because = fix
    ? n
      ? `${n} finding${n === 1 ? ' still holds' : 's still hold'} the merge after the one re-review: ${n === 1 ? 'it is' : 'they are'} the person's to settle`
      : 'the fixes were re-reviewed and nothing holds the merge'
    : 'one full review left nothing that holds the merge';
  return { ...base, state: left.length ? 'closing' : 'ended', because };
}

/** The loop in a few words, for a view: `full review due`, `2 findings hold the merge`, `ended: …`. */
export function loopWords(l: Loop): string | undefined {
  switch (l.state) {
    case 'none':
      return undefined;
    case 'due':
      return 'the full review is due';
    case 'fixing':
      return `${l.holding.length} finding${l.holding.length === 1 ? ' holds' : 's hold'} the merge`;
    case 'recheck':
      return 'the re-review of the fix is due';
    case 'closing':
    case 'ended':
      return `ended: ${l.because}`;
  }
}
