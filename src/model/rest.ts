// Where a change may rest (change:run-to-the-end): the points at which whoever works it may stop and the record says
// why. A change rests when something waits on a person (a decision proposed on it), when it is held (a blocker
// recorded, a dependency not done, a status a person set: blocked, review, done, dropped), or when its plan has run to
// its end (every step done or dropped). A change with open or active steps and none of those does not rest: the
// work goes on. A change with no plan has nothing to run, so it rests. The adapter's stop hook reads this to refuse a
// stop that is not one; the rule itself is the record's.
import { stepsOf, type Step } from './foundation.js';
import type { Loaded, Rec } from '../store/records.js';
import { live } from './tree.js';

/** The statuses a person sets that hold a change where it is, whatever its plan says. */
const HELD = new Set(['blocked', 'review', 'done', 'dropped']);

export interface Rest {
  key: string;
  /** Whether a stop here is one the record allows. */
  rests: boolean;
  /** Why it rests, in a line; absent when it does not. */
  because?: string;
  /** The proposed decisions on the change: what waits on the person. */
  waiting: string[];
  /** The Blocked on section, when written. */
  blockedOn?: string;
  /** The dependencies not yet done. */
  dependsOn: string[];
  /** The steps still open or active, numbered from 1 in the plan. */
  open: { n: number; step: Step }[];
  status: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Where a change stands against its resting points. Throws when the key names no live change. */
export function restOf(loaded: Loaded, raw: string): Rest {
  const rec = live(loaded, raw);
  if (!rec || rec.type !== 'change') throw new Error(`${raw} is not a change`);
  return restOfRecord(loaded, rec);
}

export function restOfRecord(loaded: Loaded, rec: Rec): Rest {
  const status = str(rec.data.status) ?? 'open';
  const waiting = loaded.records.filter((d) => d.type === 'decision' && d.valid && d.data.status === 'proposed' && d.changeKey === rec.key).map((d) => d.key);
  const blockedOn = rec.sections.get('Blocked on')?.trim() || undefined;
  const dependsOn = list(rec.data.depends_on)
    .map((k) => live(loaded, k))
    .filter((d): d is Rec => !!d && !['done', 'dropped'].includes(str(d.data.status) ?? 'open'))
    .map((d) => d.key);
  const steps = stepsOf(rec.data);
  const open = steps.map((step, i) => ({ n: i + 1, step })).filter((s) => s.step.state === 'open' || s.step.state === 'active');
  const base = { key: rec.key, waiting, blockedOn, dependsOn, open, status };
  if (HELD.has(status)) return { ...base, rests: true, because: `its status is ${status}` };
  if (waiting.length) return { ...base, rests: true, because: `${waiting.join(', ')} ${waiting.length === 1 ? 'is' : 'are'} proposed and wait${waiting.length === 1 ? 's' : ''} on the person` };
  if (blockedOn) return { ...base, rests: true, because: `it is blocked on: ${blockedOn.split('\n')[0]}` };
  if (dependsOn.length) return { ...base, rests: true, because: `it depends on ${dependsOn.join(', ')}, not done` };
  if (!steps.length) return { ...base, rests: true, because: 'it has no plan to run' };
  if (!open.length) return { ...base, rests: true, because: 'its plan has run to its end' };
  return { ...base, rests: false };
}

/** The verdict as a line and, when the change does not rest, the open steps beneath it. */
export function formatRest(r: Rest): string {
  if (r.rests) return `${r.key} rests: ${r.because}`;
  return [`${r.key} does not rest: ${r.open.length === 1 ? 'a step is' : `${r.open.length} steps are`} open`, ...r.open.map((s) => `- ${s.n}. ${s.step.text}${s.step.state === 'active' ? ' (in progress)' : ''}`)].join('\n');
}
