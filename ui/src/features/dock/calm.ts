// The calm dock's model (change:dock-redesign, decision calm-dock): what the dock reads first and in what words, as pure
// derivations. The band says where the change stands, the one thing a glance looks for: what waits on the person
// overrides the status, done is the one solid band, and the aside says what the session is doing or how it ended. The
// plan reads as done of total, the step in work and the one after it; the sources as links before files, a few out and
// the rest behind a count.
import type { ChangeContext } from '@/data/contract';
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
