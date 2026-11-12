// The calm dock's model (change:dock-redesign, decision calm-dock): what the dock reads first and in what words, as pure
// derivations. The band says where the change stands, the one thing a glance looks for: what waits on the person
// overrides the status, done is the one solid band, and the aside says what the session is doing or how it ended. The
// plan reads as done of total, the step in work and the one after it; the sources as links before files, a few out and
// the rest behind a count.
import type { ChangeContext, RailRow } from '@/data/contract';
import { agoWords, durationWords, plural } from '@/lib/format';

export type BandTone = 'live' | 'waits' | 'alarm' | 'done' | 'active' | 'planning' | 'open' | 'dropped';
export type BandMark = 'pulse' | 'waits' | 'check' | 'alert' | 'dot';

export interface Band {
  word: string;
  /** What the session is doing, or how the change ended. */
  aside: string;
  tone: BandTone;
  mark: BandMark;
  /** Done alone is solid, so it can't be missed. */
  solid: boolean;
}

export interface BandInput {
  status?: string;
  /** Proposed decisions on the change (and beneath it, on a milestone). */
  waiting: number;
  working: boolean;
  started?: string;
  last?: string;
  /** "shipped in v0.4.0", when the change shipped in a release. */
  shipped?: string;
  blockedOn?: string;
}

const WORDS: Record<string, string> = {
  active: 'Active',
  review: 'In review',
  planning: 'Planning',
  open: 'Open',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};
const TONES: Record<string, BandTone> = {
  active: 'active',
  review: 'waits',
  planning: 'planning',
  open: 'open',
  blocked: 'alarm',
  done: 'done',
  dropped: 'dropped',
};

/** The session in a few words: working now and for how long, else when it stopped. */
function sessionWords(i: BandInput, now: number): string {
  if (i.working) return ['working now', durationWords(i.started, now)].filter(Boolean).join(' · ');
  return i.last ? `stopped ${agoWords(i.last, now)}` : '';
}

export function bandOf(i: BandInput, now = Date.now()): Band {
  const status = i.status ?? 'open';
  if (status === 'done')
    return {
      word: 'Done',
      aside: i.shipped ?? '',
      tone: 'done',
      mark: 'check',
      solid: true,
    };
  if (status === 'dropped')
    return {
      word: 'Dropped',
      aside: '',
      tone: 'dropped',
      mark: 'dot',
      solid: false,
    };
  if (i.waiting > 0)
    return {
      word: 'Waiting on you',
      aside: [plural(i.waiting, 'decision'), sessionWords(i, now)].filter(Boolean).join(' · '),
      tone: 'waits',
      mark: 'waits',
      solid: false,
    };
  if (status === 'blocked')
    return {
      word: 'Blocked',
      aside: i.blockedOn?.split('\n')[0]?.trim() ?? sessionWords(i, now),
      tone: 'alarm',
      mark: 'alert',
      solid: false,
    };
  return {
    word: WORDS[status] ?? status.charAt(0).toUpperCase() + status.slice(1),
    aside: sessionWords(i, now),
    tone: TONES[status] ?? 'open',
    mark: i.working ? 'pulse' : 'dot',
    solid: false,
  };
}

type Step = ChangeContext['plan'][number];

export interface PlanRead {
  /** "2 of 6 done", "· 1 dropped" after it; "no steps yet". */
  sum: string;
  /** The step in work, else the next open one. */
  step?: Step;
  /** The open step after it. */
  next?: Step;
}

export function planRead(plan: readonly Step[]): PlanRead {
  if (!plan.length) return { sum: 'no steps yet' };
  const counted = plan.filter((s) => s.state !== 'dropped');
  const done = counted.filter((s) => s.state === 'done').length;
  const dropped = plan.length - counted.length;
  const sum = [`${done} of ${counted.length} done`, dropped ? `${dropped} dropped` : ''].filter(Boolean).join(' · ');
  const step = counted.find((s) => s.state === 'active') ?? counted.find((s) => s.state === 'open');
  const next = step ? counted.slice(counted.indexOf(step) + 1).find((s) => s.state === 'open') : undefined;
  return { sum, step, next };
}

type Source = ChangeContext['sources'][number];

export interface SourcesRead {
  /** "2 links · 6 files", "none yet". */
  sum: string;
  /** Links first, then files, as many as are shown before the count. */
  shown: Source[];
  rest: Source[];
}

export const SOURCES_SHOWN = 5;

export function sourcesRead(sources: readonly Source[], keep = SOURCES_SHOWN): SourcesRead {
  const files = sources.filter((s) => s.key.startsWith('file:'));
  const links = sources.filter((s) => !s.key.startsWith('file:'));
  const ordered = [...links, ...files];
  const sum = [links.length ? plural(links.length, 'link') : '', files.length ? plural(files.length, 'file') : '']
    .filter(Boolean)
    .join(' · ');
  return {
    sum: sum || 'none yet',
    shown: ordered.slice(0, keep),
    rest: ordered.slice(keep),
  };
}

/** pjman's line in now: the newest write to the change, in words, the thing it names apart so it can be set in
 *  the ink. A decision by its name, a file by its path, a status by where it went, a plan by what the step did. */
export interface WriteWords {
  verb: string;
  object?: string;
}

/** A step write's verb: by itself when the event names no step (writes before change:dock-now-lines), else with the
 *  step's number, its text set in the ink. */
const STEP_VERBS: [string, string, string][] = [
  ['step start', 'Started a step', 'Started'],
  ['step done', 'Finished a step', 'Finished'],
  ['step note', 'Noted a step', 'Noted on'],
  ['step add', 'Added steps', 'Added'],
  ['step drop', 'Dropped a step', 'Dropped'],
  ['step reopen', 'Reopened a step', 'Reopened'],
  ['step edit', 'Reworded a step', 'Reworded'],
  ['step move', 'Moved a step', 'Moved'],
];
const FIELD_VERBS: [string, string][] = [
  ['notes', 'Left a note'],
  ['links', 'Linked a source'],
  ['name', 'Renamed it'],
  ['gist', 'Reworded the gist'],
  ['blocked-on', 'Set what it is blocked on'],
  ['depends-on', 'Set what it depends on'],
];

/** The steps a step write names, as their numbers ("3", "2,4"); none when the event names none. */
const stepNumbers = (value: string | undefined): number[] =>
  (value ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

export function writeWords(
  r: Pick<RailRow, 'kind' | 'op' | 'label' | 'value' | 'fields' | 'files'>,
  plan: readonly Pick<ChangeContext['plan'][number], 'text'>[] = [],
): WriteWords {
  if (r.kind === 'decision') {
    const verb =
      r.op === 'created'
        ? 'Proposed'
        : r.value === 'decided'
          ? 'Decided'
          : r.value === 'superseded'
            ? 'Superseded'
            : r.value === 'proposed'
              ? 'Reopened'
              : 'Added to';
    return { verb, object: r.label };
  }
  if (r.kind === 'file') {
    const files = r.files ?? [];
    const more = files.length > 1 ? ` and ${plural(files.length - 1, 'more')}` : '';
    return { verb: 'Linked', object: files[0] ? `${files[0]}${more}` : undefined };
  }
  if (r.op === 'created') return { verb: 'Filed the change' };
  const fields = r.fields ?? [];
  if (fields.includes('status') && r.value) return { verb: 'Status', object: `→ ${r.value}` };
  for (const [f, bare, verb] of STEP_VERBS) {
    if (!fields.some((x) => x.startsWith(f))) continue;
    const ns = stepNumbers(r.value);
    if (!ns.length) return { verb: bare };
    if (ns.length > 1) return { verb: `${verb} steps`, object: ns.join(', ') };
    const text = plan[ns[0]! - 1]?.text;
    return { verb: `${verb} step ${ns[0]}`, object: text };
  }
  if (fields.includes('plan')) return { verb: 'Updated the plan' };
  for (const [f, verb] of FIELD_VERBS) if (fields.includes(f)) return { verb };
  return fields.length ? { verb: 'Set', object: fields.join(', ') } : { verb: 'Wrote to it' };
}

/** A link's place, as a row says it: the host of its URL, else the kind in its key. */
export function sourcePlace(s: Pick<Source, 'key' | 'url'>): string {
  if (s.url) {
    try {
      return new URL(s.url).hostname.replace(/^www\./, '');
    } catch {
      /* not a URL: the kind */
    }
  }
  const i = s.key.indexOf(':');
  return i > 0 ? s.key.slice(0, i) : '';
}
