// A review's findings (change:pjman-review): what a reviewer found wrong with a change's branch, judged against the
// change's done-when and the decisions accepted on it. Data on the change, as its steps are: each with its text, a
// severity, where in the code it points, and whether it still stands. In a project that opted in to Entire a finding
// is also filed onto the change's Trail, whose Findings gate holds the merge until it is resolved; `entire` is its id
// there, and `filed` the state Entire was last told.
// A finding says whether it holds the merge (decision review-loop/stop-rule): one of high severity, or one that says
// the done-when is not met (kind intent), holds it while it stands, and its fix is re-reviewed. Every finding, of
// either sort, is the change's own to handle before it merges (decision review-fixes-in-place/where-findings-go):
// fixed and resolved, dismissed with the reason, or deferred in so many words by a person, the reason on it. A
// deferred one stays on the change; it goes to a follow-up change only when a person asks for one.
export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export const FINDING_STATES = ['open', 'resolved', 'dismissed', 'deferred'] as const;
export type FindingState = (typeof FINDING_STATES)[number];
/** What a finding is about: the done-when is not met (intent), a decision or the scope is not kept (drift), the code
 *  breaks (correctness). */
export const FINDING_KINDS = ['intent', 'drift', 'correctness'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface Finding {
  /** Its own id, given when it is filed and never reused: what Entire knows it by (`pjman:<change>#<id>`). A finding
   *  filed before ids has none, and is known to Entire by its place. */
  id?: string;
  text: string;
  severity: FindingSeverity;
  kind?: FindingKind;
  state: FindingState;
  /** When it was last resolved, dismissed, deferred or reopened. */
  settled?: string;
  file?: string;
  line?: number;
  /** Why it was resolved, dismissed or deferred. */
  note?: string;
  /** The branch's head when it was settled, in full: what was committed to handle a pass's findings is not work the
   *  review has yet to see. */
  head?: string;
  by?: string;
  at?: string;
  /** Its id on the change's Trail, once filed there. */
  entire?: string;
  /** The state Entire was last told. */
  filed?: FindingState;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const oneOf = <T extends string>(all: readonly T[], v: unknown, dflt: T): T =>
  (all as readonly string[]).includes(String(v)) ? (v as T) : dflt;

/** The findings a change holds, as written; a malformed entry is left out (the validator names it). */
export function findingsOf(data: Record<string, unknown>): Finding[] {
  if (!Array.isArray(data.findings)) return [];
  const out: Finding[] = [];
  for (const raw of data.findings) {
    const f = obj(raw);
    const text = str(f?.text);
    if (!f || !text) continue;
    out.push({
      ...(str(f.id) ? { id: str(f.id) } : {}),
      text,
      severity: oneOf(FINDING_SEVERITIES, f.severity, 'medium'),
      ...((FINDING_KINDS as readonly string[]).includes(String(f.kind)) ? { kind: f.kind as FindingKind } : {}),
      state: oneOf(FINDING_STATES, f.state, 'open'),
      ...(str(f.settled) ? { settled: str(f.settled) } : {}),
      ...(str(f.file) ? { file: str(f.file) } : {}),
      ...(typeof f.line === 'number' ? { line: f.line } : {}),
      ...(str(f.note) ? { note: str(f.note) } : {}),
      ...(str(f.head) ? { head: str(f.head) } : {}),
      ...(str(f.by) ? { by: str(f.by) } : {}),
      ...(str(f.at) ? { at: str(f.at) } : {}),
      ...(str(f.entire) ? { entire: str(f.entire) } : {}),
      ...(str(f.filed) ? { filed: oneOf(FINDING_STATES, f.filed, 'open') } : {}),
    });
  }
  return out;
}

/** Whether a finding is of the sort that holds the merge, whatever its state: high severity, or the done-when not met. */
export const wouldHold = (f: Finding): boolean => f.severity === 'high' || f.kind === 'intent';
/** Whether it holds the merge now: of that sort, and still standing. */
export const holdsMerge = (f: Finding): boolean => f.state === 'open' && wouldHold(f);

/** Findings still standing, with how many hold the merge: `2 open findings (1 holds the merge)`; undefined when none
 *  stands. */
export function findingsLine(findings: Finding[]): string | undefined {
  const open = findings.filter((f) => f.state === 'open');
  if (!open.length) return undefined;
  const hold = open.filter(holdsMerge).length;
  return `${open.length} open finding${open.length === 1 ? '' : 's'}${hold ? ` (${hold} hold${hold === 1 ? 's' : ''} the merge)` : ''}`;
}

/** One finding as a line: `2. [open, holds the merge] high intent src/cart.ts:12 — the total ignores discounts`. */
export function formatFinding(n: number, f: Finding): string {
  const where = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '';
  return `${n}. [${f.state}${holdsMerge(f) ? ', holds the merge' : ''}] ${f.severity}${f.kind ? ` ${f.kind}` : ''}${where} — ${f.text}${f.note ? ` (${f.note})` : ''}`;
}
