// What pjman keeps of an Entire Trail, and how a view says it (change:trail-lifecycle). The lifecycle that writes it
// is sync/trail.ts; this is the shape on the record, low enough for every layer to read.
export const TRAIL_KIND = 'entire-trail';

/** One gate of a Trail's change, as pjman keeps it. */
export interface TrailGate {
  key: string;
  status: string;
  blocking: boolean;
  rationale?: string;
}

/** What pjman keeps of a Trail, under `ext.entire` on its source record. */
export interface TrailState {
  id: string;
  number: number;
  url?: string;
  /** The Trail's lifecycle on Entire: open or closed. */
  status: string;
  /** Entire's derived phase: planning, building, complete, closed. */
  phase?: string;
  branch?: string;
  /** The branch's change on the Trail: its number in the repository and its state (draft, open, merged, closed). */
  change?: { number: number; status: string; url?: string };
  mergeable?: boolean;
  gates: TrailGate[];
  /** Open findings on the change, by severity. */
  findings?: { open: number; high: number; medium: number; low: number };
  /** pjman marked it ready for review. */
  ready?: boolean;
  /** The hash of the title and body pjman last sent. */
  sent?: string;
  synced_at?: string;
}

/** One line a view prints for a Trail: `Trail #12 building · change open · approvals pending, findings passed · 2 open findings`. */
export function trailLine(s: TrailState): string {
  const parts = [`Trail #${s.number} ${s.status === 'closed' ? 'closed' : (s.phase ?? s.status).replace(/_/g, ' ')}`];
  if (s.change) parts.push(`branch ${s.change.status}`);
  if (s.gates.length)
    parts.push(s.gates.map((g) => `${g.key} ${g.status}${g.blocking ? '' : ' (not blocking)'}`).join(', '));
  if (s.findings?.open)
    parts.push(
      `${s.findings.open} open finding${s.findings.open === 1 ? '' : 's'}${s.findings.high ? ` (${s.findings.high} high)` : ''}`,
    );
  return parts.join(' · ');
}

/** The Trail kept under `ext.entire` on a source record's data, when one is. */
export function trailStateOf(data: Record<string, unknown> | undefined): TrailState | undefined {
  const ext = data?.ext;
  const e = ext && typeof ext === 'object' && !Array.isArray(ext) ? (ext as Record<string, unknown>).entire : undefined;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return undefined;
  const s = e as TrailState;
  return typeof s.number === 'number' && Array.isArray(s.gates) ? s : undefined;
}
