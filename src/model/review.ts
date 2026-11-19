// The review loop (change:review-loop). How a project's changes are reviewed is a setting on the project record
// (decision review-loop/setting): `ext.review.mode` is off, request (the default: pjman review only when asked) or auto
// (a change reaching review is reviewed without being asked). The loop has an end by rule (decision
// review-loop/stop-rule): one full review; the findings that hold the merge (high severity, or the done-when not met)
// are fixed; one re-review of the fix alone; then it ends and says why, and what does not hold the merge goes to one
// follow-up change. A round is data on the change (`reviews`), as its findings are; where the loop stands is read from
// the two, never stored.
import { findingsOf, holdsMerge, wouldHold, type Finding } from './findings.js';
import { stepsOf } from './foundation.js';
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
  /** The pass it belongs to, from 2 on: a change worked on again after its review ended is reviewed again, and each
   *  pass has its own full review and re-review (change:review-reads-ended). The first pass is unmarked. */
  pass?: number;
}

export const passOf = (r: Record<string, unknown>): number =>
  typeof r.pass === 'number' && Number.isInteger(r.pass) && r.pass > 1 ? r.pass : 1;

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
      ...(passOf(r) > 1 ? { pass: passOf(r) } : {}),
    });
  }
  return out;
}

/** A lens handed to a reviewer: `pjman review <change> --lens <lens>` records that its brief went out, and when. A
 *  round is closed only once each of its lenses was handed out, and what a reviewer files is told from what stood
 *  before by that time. Entire's own review is recorded the same way, by `entire`. */
export interface Asked {
  lens: string;
  at: string;
  by?: string;
  pass?: number;
}

export function lensesAsked(data: Record<string, unknown>): Asked[] {
  if (!Array.isArray(data.reviews)) return [];
  const out: Asked[] = [];
  for (const raw of data.reviews) {
    const r = obj(raw);
    const at = str(r?.at);
    const lens = str(r?.lens);
    if (!r || !at || !lens || r.round !== 'lens') continue;
    out.push({ lens, at, ...(str(r.by) ? { by: str(r.by) } : {}), ...(passOf(r) > 1 ? { pass: passOf(r) } : {}) });
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
  /** The lenses of the round to close that no reviewer was handed yet. */
  missing: string[];
  /** The pass these rounds belong to: 1, and one more each time the change is worked on again after its review ended. */
  pass: number;
  /** The pass has ended and the plan moved since, and the caller could not say whether the branch holds new work:
   *  whoever can read the repository says whether the review is due again. */
  maybeAgain?: boolean;
}

/** Where a change's review loop stands, from its rounds and findings. `reviewable` says there is a branch with work on
 *  it to review; without one a change is never due. `newWork` answers, for the head a round was closed at, whether
 *  the branch holds commits since that the base lacks; it is the repository's to say, so a caller with no repository
 *  leaves it out.
 *
 *  The loop has an end, and a change can be worked on again after it: its plan reopened or added to and run to its end
 *  once more, with commits the last round did not see. That is a new pass, due for its own full review; the rounds of
 *  the pass before stay on the record and are not read again. */
export function loopOf(
  data: Record<string, unknown>,
  opts: { reviewable: boolean; newWork?: (since: string) => boolean },
): Loop {
  const all = [...roundsOf(data), ...lensesAsked(data)];
  const pass = Math.max(1, ...all.map((e) => e.pass ?? 1));
  const now = loopOfPass(data, opts, pass);
  if (now.state !== 'closing' && now.state !== 'ended') return now;
  const last = now.fix ?? now.full;
  if (!last) return now;
  const steps = stepsOf(data);
  // worked on again: the plan moved after the last round, and the branch holds commits that round did not see. The
  // commits are what is unreviewed; the plan says the person meant it (a note on a finished step moves it too, and
  // alone changes nothing)
  const moved = steps.some((s) => (s.at ?? '') > last.at);
  if (!moved) return now;
  if (!opts.newWork) return { ...now, maybeAgain: true };
  // a round closed with no head recorded saw nothing it can be told from: what the branch holds is unreviewed
  if (last.head && !opts.newWork(last.head)) return now;
  // the plan is being worked, not at its end: the review comes when it is
  const atEnd = steps.every((s) => s.state === 'done' || s.state === 'dropped');
  return {
    state: atEnd && data.status === 'review' && opts.reviewable ? 'due' : 'none',
    holding: now.holding,
    fixed: [],
    left: now.left,
    missing: [...REVIEW_LENSES],
    pass: pass + 1,
  };
}

function loopOfPass(data: Record<string, unknown>, opts: { reviewable: boolean }, pass: number): Loop {
  const findings = findingsOf(data);
  const rounds = roundsOf(data).filter((r) => (r.pass ?? 1) === pass);
  const full = rounds.find((r) => r.round === 'full');
  const fix = rounds.find((r) => r.round === 'fix');
  const nums = (pick: (f: Finding) => boolean): number[] =>
    findings.map((f, i) => (pick(f) ? i + 1 : 0)).filter((n) => n > 0);
  const holding = nums(holdsMerge);
  const left = nums((f) => f.state === 'open' && !wouldHold(f));
  const asked = lensesAsked(data).filter((a) => (a.pass ?? 1) === pass);
  const askedAt = (lens: string): string | undefined => asked.find((a) => a.lens === lens)?.at;
  // the full review began when its first lens went out: a finding fixed and resolved from then on is one whose fix the
  // re-review reads, whether it was resolved before or after the round was closed
  const began = REVIEW_LENSES.map(askedAt)
    .filter((t): t is string => !!t)
    .toSorted()[0];
  const fixed = full
    ? nums((f) => f.state === 'resolved' && wouldHold(f) && !!f.settled && f.settled >= (began ?? full.at))
    : [];
  const missingFull = REVIEW_LENSES.filter((l) => !askedAt(l));
  const base = { full, fix, holding, fixed, left, missing: [] as string[], pass };
  if (!full)
    return {
      ...base,
      missing: missingFull,
      state: data.status === 'review' && opts.reviewable ? 'due' : 'none',
    };
  if (!fix) {
    // what the re-review itself brought, told by when its lens went out: a finding reopened since (the fix did not
    // hold), or one filed since. These do not send the loop back to fixing: there is one re-review, and it is closed
    // with them standing. A finding filed before that, however late, is still to be fixed
    const reAt = askedAt('fix');
    const fromRecheck = (f: Finding): boolean => !!reAt && ((!!f.settled && f.settled >= reAt) || (f.at ?? '') > reAt);
    const held = holding.map((n) => findings[n - 1]);
    if (held.some((f) => !fromRecheck(f))) return { ...base, state: 'fixing' };
    if (fixed.length || held.length) return { ...base, missing: reAt ? [] : ['fix'], state: 'recheck' };
  }
  const n = holding.length;
  // (in this pass: one dismissed in an earlier pass says nothing of this one)
  const dismissed = findings.some(
    (f) => f.state === 'dismissed' && wouldHold(f) && !!f.settled && f.settled >= (began ?? full.at),
  );
  const because = fix
    ? n
      ? `${n} finding${n === 1 ? ' still holds' : 's still hold'} the merge after the one re-review: ${n === 1 ? 'it is' : 'they are'} the person's to settle`
      : 'the fixes were re-reviewed and nothing holds the merge'
    : n
      ? `${n} finding${n === 1 ? ' holds' : 's hold'} the merge`
      : dismissed
        ? 'what held the merge was dismissed, the reason on each, so there is no fix to re-review'
        : 'one full review left nothing that holds the merge';
  return { ...base, state: left.length ? 'closing' : 'ended', because };
}

/** The loop in a few words, for a view: `full review due`, `2 findings hold the merge`, `ended: …`; nothing when
 *  there is nothing to review and no pass before it. */
export function loopWords(l: Loop): string | undefined {
  switch (l.state) {
    case 'none':
      // a new pass under way: worked on after the review ended, its plan not at its end yet
      return l.pass > 1
        ? 'worked on since its review ended: the full review is due again once its plan has run to its end'
        : undefined;
    case 'due':
      return l.pass > 1
        ? 'the full review is due again: the change was worked on after its review ended'
        : 'the full review is due';
    case 'fixing':
      return `${l.holding.length} finding${l.holding.length === 1 ? ' holds' : 's hold'} the merge`;
    case 'recheck':
      return 'the re-review of the fix is due';
    case 'closing':
    case 'ended':
      return `ended: ${l.because}`;
  }
}
