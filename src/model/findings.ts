// A review's findings (change:pjman-review): what a reviewer found wrong with a change's branch, judged against the
// change's done-when and the decisions accepted on it. Data on the change, as its steps are: each with its text, a
// severity, where in the code it points, and whether it still stands. In a project that opted in to Entire a finding
// is also filed onto the change's Trail, whose Findings gate holds the merge until it is resolved; `entire` is its id
// there, and `filed` the state Entire was last told.
export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export const FINDING_STATES = ['open', 'resolved', 'dismissed'] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface Finding {
  text: string;
  severity: FindingSeverity;
  state: FindingState;
  file?: string;
  line?: number;
  /** Why it was resolved or dismissed. */
  note?: string;
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
      text,
      severity: oneOf(FINDING_SEVERITIES, f.severity, 'medium'),
      state: oneOf(FINDING_STATES, f.state, 'open'),
      ...(str(f.file) ? { file: str(f.file) } : {}),
      ...(typeof f.line === 'number' ? { line: f.line } : {}),
      ...(str(f.note) ? { note: str(f.note) } : {}),
      ...(str(f.by) ? { by: str(f.by) } : {}),
      ...(str(f.at) ? { at: str(f.at) } : {}),
      ...(str(f.entire) ? { entire: str(f.entire) } : {}),
      ...(str(f.filed) ? { filed: oneOf(FINDING_STATES, f.filed, 'open') } : {}),
    });
  }
  return out;
}

/** Findings still standing, worst first in count: `2 open findings (1 high)`; undefined when none stands. */
export function findingsLine(findings: Finding[]): string | undefined {
  const open = findings.filter((f) => f.state === 'open');
  if (!open.length) return undefined;
  const high = open.filter((f) => f.severity === 'high').length;
  return `${open.length} open finding${open.length === 1 ? '' : 's'}${high ? ` (${high} high)` : ''}`;
}

/** One finding as a line: `2. [open] high src/cart.ts:12 — the total ignores discounts`. */
export function formatFinding(n: number, f: Finding): string {
  const where = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '';
  return `${n}. [${f.state}] ${f.severity}${where} — ${f.text}${f.note ? ` (${f.note})` : ''}`;
}
