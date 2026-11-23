// A milestone's progress as every view draws it (change:childless-milestone-progress): the work beneath it, or, with
// nothing counted beneath it, the milestone itself as one piece of work, the way its parent's roll-up counts it
// (decision nested-milestones/progress-rollup). The scope row carries 0 of 0 for a milestone with nothing beneath it;
// read here, a done one is 1 of 1 and an open one 0 of 1. A dropped one counts none.
import type { ChangeRow } from '@/data/contract';

type Progress = { done: number; total: number };

/** Nothing counted beneath the milestone: its progress is its own. */
export const isAlone = (r: Pick<ChangeRow, 'status' | 'progress'>): boolean =>
  !!r.progress && !r.progress.total && r.status !== 'dropped';

/** The milestone's progress, read by the rule above; undefined on a row that carries none (a change of another kind). */
export function milestoneProgress(r: Pick<ChangeRow, 'status' | 'progress'>): Progress | undefined {
  if (!r.progress) return undefined;
  if (!isAlone(r)) return r.progress;
  return { done: r.status === 'done' ? 1 : 0, total: 1 };
}
