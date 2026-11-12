// pjman step: a change's plan, written only through commands (decision record-foundation/plan-steps-are-data). Steps
// are data on the change, each with a text, a state and a note of where the work stands; every move is one commit and
// one event on the change, so progress, the next step and the activity are read off the steps and nothing is parsed.
import fs from 'node:fs';
import type { Store } from '../store/config.js';
import { loadStore, resolve, unresolvedError, type Rec } from '../store/records.js';
import { CliError, nowIso, usageError } from '../store/util.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from './write.js';
import { formatStep, nextStep, planProgress, stepsOf, type Step } from '../model/foundation.js';

export const STEP_VERBS = ['add', 'start', 'done', 'drop', 'note', 'edit', 'move', 'reopen'] as const;
export type StepVerb = (typeof STEP_VERBS)[number];

export interface StepOpts {
  /** The step's text (edit) or note (note, done, drop, start). */
  text?: string;
  /** The steps to add, each its own step, in one commit (decision interface-audit/bulk-writes). */
  texts?: string[];
  /** More steps the same move takes (start, done, drop, reopen), beside `n`, in the same commit. */
  more?: number[];
  note?: string;
  /** Where to place it: add and move. */
  before?: number;
  after?: number;
  first?: boolean;
  last?: boolean;
  session?: string;
  writer?: string;
}

export interface StepResult {
  key: string;
  path: string;
  verb: StepVerb;
  /** The step's number after the write, from 1 (the first of several added). */
  n: number;
  /** How many steps the write touched: several for an add of several, or a move of several. */
  count: number;
  /** The steps the write touched, by number after it, from 1. */
  numbers: number[];
  steps: Step[];
  progress?: { done: number; total: number };
  next?: { n: number; step: Step };
  commit: string | null;
}

function change(store: Store, ref: string): Rec {
  const loaded = loadStore(store);
  const raw = ref.startsWith('change:') ? ref : `change:${ref}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, raw);
  if (res.rec.type !== 'change') throw new CliError(`${res.rec.key} is not a change`);
  if (!res.rec.valid) throw new CliError(`${res.rec.path} is invalid; fix it before writing its plan`);
  // a milestone's plan is its children (decision milestone-kind/kind-not-children): no step of its own
  if (res.rec.data.kind === 'milestone')
    throw new CliError(
      `${res.rec.key} is a milestone: its children are its plan, so it takes no steps of its own (pjman new change <slug> --parent ${res.rec.key} adds one)`,
    );
  return res.rec;
}

/** Where a step lands: by --before, --after, --first, --last; else at the end. The result is an index into the list
 *  after removal of the moved step, 0-based. */
function placement(steps: Step[], opts: StepOpts, moving?: number): number {
  const given = [opts.before, opts.after, opts.first, opts.last].filter((x) => x !== undefined && x !== false).length;
  if (given > 1) throw new CliError('one of --before, --after, --first, --last');
  const index = (n: number | undefined, what: string): number => {
    if (n === undefined) return -1;
    if (!Number.isInteger(n) || n < 1 || n > steps.length)
      throw new CliError(`${what} ${n}: the plan has ${steps.length} step${steps.length === 1 ? '' : 's'}`);
    if (moving !== undefined && n - 1 === moving) throw new CliError(`${what} ${n} is the step itself`);
    // the list the step is placed in has the moved step taken out
    return moving !== undefined && n - 1 > moving ? n - 2 : n - 1;
  };
  const size = moving !== undefined ? steps.length - 1 : steps.length;
  if (opts.first) return 0;
  if (opts.before !== undefined) return index(opts.before, '--before');
  if (opts.after !== undefined) return index(opts.after, '--after') + 1;
  return size;
}

/** One move of the plan: the steps rewritten, one commit, one event on the change with the move named. */
export function step(store: Store, ref: string, verb: string, n: number | undefined, opts: StepOpts = {}): StepResult {
  if (!(STEP_VERBS as readonly string[]).includes(verb))
    throw usageError(
      `usage: pjman step <change> add "<text>"... | start|done|drop|reopen <n> [--note "…"] | note <n> "<text>" | edit <n> "<text>" | move <n> --before <m>|--after <m>|--first|--last`,
    );
  const rec = change(store, ref);
  const steps = stepsOf(rec.data);
  const at = nowIso();
  let touched: number;
  let count = 1;
  let numbers: number[] | undefined;
  const want = (what: string): number => {
    if (!steps.length) throw new CliError(`${rec.key}: the plan is empty: pjman step <change> add "…"`);
    if (n === undefined || !Number.isInteger(n) || n < 1 || n > steps.length)
      throw usageError(`${what} needs a step number from 1 to ${steps.length}`);
    return n - 1;
  };
  switch (verb as StepVerb) {
    case 'add': {
      const texts = (opts.texts ?? (opts.text !== undefined ? [opts.text] : [])).map((t) => t.trim());
      if (!texts.length || texts.some((t) => !t))
        throw usageError(
          'usage: pjman step <change> add "<text>"... (each quoted text a step), or --from - (one per line)',
        );
      const i = placement(steps, opts);
      steps.splice(
        i,
        0,
        ...texts.map((text, k) => ({
          text,
          state: 'open' as const,
          note: k === texts.length - 1 ? opts.note?.trim() || undefined : undefined,
          at,
        })),
      );
      touched = i;
      count = texts.length;
      break;
    }
    case 'edit': {
      const i = want('edit');
      const text = opts.text?.trim();
      if (!text) throw usageError('usage: pjman step <change> edit <n> "<text>"');
      if (steps[i].text === text) throw new CliError(`step ${n} already reads so`);
      steps[i].text = text;
      steps[i].at = at;
      touched = i;
      break;
    }
    case 'start':
    case 'done':
    case 'drop':
    case 'reopen': {
      // one step, or several in one commit: the same move repeated is one write (decision interface-audit/bulk-writes)
      const all = [n, ...(opts.more ?? [])];
      if (new Set(all).size !== all.length) throw usageError(`a step is named twice: ${all.join(' ')}`);
      const next = verb === 'start' ? 'active' : verb === 'done' ? 'done' : verb === 'drop' ? 'dropped' : 'open';
      const idx = all.map((k) => {
        if (k === undefined || !Number.isInteger(k) || k < 1 || k > steps.length) want(verb);
        return k! - 1;
      });
      if (!steps.length) want(verb);
      for (const i of idx) {
        const s = steps[i];
        if (s.state === next) throw new CliError(`step ${i + 1} is already ${next}`);
        if (verb === 'reopen' && s.state !== 'done' && s.state !== 'dropped')
          throw new CliError(`step ${i + 1} is ${s.state}; reopen takes a done or dropped step`);
        s.state = next;
        s.at = at;
        if (opts.note !== undefined) s.note = opts.note.trim() || undefined;
        else if (verb === 'reopen') delete s.note;
      }
      touched = Math.min(...idx);
      count = idx.length;
      numbers = idx.map((i) => i + 1);
      break;
    }
    case 'note': {
      const i = want('note');
      const text = (opts.text ?? opts.note)?.trim();
      if (!text) throw new CliError('pjman step <change> note <n> "<where the work stands>"');
      steps[i].note = text;
      steps[i].at = at;
      touched = i;
      break;
    }
    case 'move': {
      const i = want('move');
      const j = placement(steps, opts, i);
      const [s] = steps.splice(i, 1);
      steps.splice(j, 0, s);
      touched = j;
      break;
    }
    default:
      throw new CliError(`unknown step verb '${verb}'`);
  }
  const plan = steps.map((s) => ({ text: s.text, state: s.state, note: s.note, at: s.at }));
  // a write through the tool is the record reviewed: the migrated mark drops
  const data: Record<string, unknown> = { ...rec.data, plan: plan.length ? plan : undefined };
  delete data.migrated;
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render('change', data, rec.body));
  validateOrUndo(store, [rec.path], [], prior);
  const env = envelope(opts);
  numbers ??= Array.from({ length: count }, (_, k) => touched + 1 + k);
  const which = numbers.join(',');
  const commit = finishWrite(store, `pjman: step ${rec.key} ${verb} ${which}`, env.session, [
    {
      op: 'set',
      key: rec.key,
      type: 'change',
      path: rec.path,
      fields: ['plan', `step ${verb}`, ...(count > 1 ? [`${count} steps`] : [])],
      value: which,
      writer: env.writer,
    },
  ]);
  return {
    key: rec.key,
    path: rec.path,
    verb: verb as StepVerb,
    n: touched + 1,
    count,
    numbers,
    steps,
    progress: planProgress(steps),
    next: nextStep(steps),
    commit,
  };
}

export function formatPlan(steps: Step[]): string {
  return steps.length ? steps.map((s, i) => formatStep(i + 1, s)).join('\n') : '(no steps)';
}
