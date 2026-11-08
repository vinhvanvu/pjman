// The session page's model (change:session-detail): what the one tree reads at either width, as pure derivations.
// The chips are the changes the session touched, last touch first, each with its writes or the word read, the
// session's focus marked and a dot when a decision waits there (decision one-shown-change). The shown change is the
// person's pick while they hold one, else the focus. The session bar, the plan's head and the sources' head are words
// read off the facts; the plan's bar is one segment a step.
import type { ChangeContext, RailLane, SessionFacts, WaitingDecision } from '@/data/contract';
import { agoWords, durationWords, plural } from '@/lib/format';
import { short } from '@/lib/keys';
import { laneColours } from '@/features/rail/model';

export interface ChipView {
  key: string;
  title: string;
  /** The lane's hue on the rail, so the chip and its rows match. */
  colour: string;
  writes: number;
  /** "6 writes", "1 write", or "read" for a change the session only read. */
  count: string;
  isFocus: boolean;
  /** The decisions waiting on the person on this change. */
  waits: number;
  status?: string;
}

export const countWords = (writes: number): string => (writes === 0 ? 'read' : plural(writes, 'write'));

/** The chips, in the lanes' order (last touch first): every change lane, the folded lane and decision lanes left out. */
export function chipViews(
  lanes: readonly RailLane[],
  focus: string | undefined,
  waitingOn: readonly Pick<WaitingDecision, 'change'>[] = [],
): ChipView[] {
  const colours = laneColours(lanes);
  return lanes
    .filter((l) => l.kind === 'change')
    .map((l) => ({
      key: l.id,
      title: l.title ?? short(l.id),
      colour: colours.get(l.id) ?? 'var(--muted-foreground)',
      writes: l.writes,
      count: countWords(l.writes),
      isFocus: l.id === focus,
      waits: waitingOn.filter((d) => d.change === l.id).length,
      status: l.status,
    }));
}

/** The shown change: the pick while held, else the focus. A pick that names no chip and is not the focus is still
 *  shown, since the person asked for it; the component reads its record either way. */
export const shownOf = (pick: string | undefined, focus: string | undefined): string | undefined => pick ?? focus;

/** Viewing: the person holds a pick that is not where the session is. */
export const viewing = (pick: string | undefined, focus: string | undefined): boolean => !!pick && pick !== focus;

/** 'nothing waits on you', '1 waits on you', 'N wait on you'. */
export function waitsLine(n: number): string {
  if (n === 0) return 'nothing waits on you';
  return n === 1 ? '1 waits on you' : `${n} wait on you`;
}

/** The session bar's parts, in order: who for whom; working for how long, or quiet or ended since when; when it last
 *  acted; what waits. The last part is the one that reads in the waits colour when something does. */
export function sessionBar(
  session: Pick<SessionFacts, 'agent' | 'onBehalfOf' | 'started' | 'last' | 'state'>,
  waits: number,
  now = Date.now(),
): { parts: string[]; waits: string; alarm: boolean } {
  const who = [
    session.agent ? short(session.agent) : 'session',
    session.onBehalfOf ? `for ${short(session.onBehalfOf)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const parts = [who];
  if (session.state === 'live')
    parts.push(session.started ? `working ${durationWords(session.started, now)}` : 'working');
  else if (session.state === 'ended') parts.push(session.last ? `ended ${agoWords(session.last, now)}` : 'ended');
  else parts.push(session.last ? `quiet since ${agoWords(session.last, now)}` : 'quiet');
  if (session.state !== 'ended' && session.last) parts.push(`last acted ${agoWords(session.last, now)}`);
  return { parts, waits: waitsLine(waits), alarm: waits > 0 };
}

/** The session as the crumb names it: the agent, the day it started, who it works for. */
export function sessionTitle(session: Pick<SessionFacts, 'key' | 'agent' | 'started' | 'onBehalfOf'>): string {
  const agent = session.agent ? short(session.agent) : short(session.key).slice(0, 8);
  const day = session.started?.slice(0, 10);
  const who = session.onBehalfOf ? `, for ${short(session.onBehalfOf)}` : '';
  return `${agent}${day ? ` · ${day}` : ''}${who}`;
}

type Step = ChangeContext['plan'][number];
export type Segment = 'done' | 'on' | 'open' | 'dropped';

/** The plan's head and bar: "step 2 of 4", the dropped counted apart; a segment a step; the row docked shows. */
export function planView(plan: readonly Step[]): { sum: string; segments: Segment[]; row?: Step } {
  const counted = plan.filter((s) => s.state !== 'dropped');
  const dropped = plan.length - counted.length;
  const active = counted.find((s) => s.state === 'active');
  const next = active ?? counted.find((s) => s.state === 'open');
  const n = next ? counted.indexOf(next) + 1 : undefined;
  const sum = !plan.length
    ? 'no steps yet'
    : n
      ? `step ${n} of ${counted.length}`
      : counted.length
        ? `all ${counted.length} steps done`
        : 'every step dropped';
  const segments: Segment[] = plan.map((s) =>
    s.state === 'done' ? 'done' : s === active ? 'on' : s.state === 'dropped' ? 'dropped' : 'open',
  );
  return { sum: dropped ? `${sum} · ${dropped} dropped` : sum, segments, row: next ?? counted.at(-1) };
}

type Child = ChangeContext['children'][number];

/** A milestone's head and bar, by its children: "4 of 7 done · 1 active"; a segment a child; the next child not done. */
export function childrenView(children: readonly Child[]): { sum: string; segments: string[]; row?: Child } {
  const counted = children.filter((c) => c.status !== 'dropped');
  const done = counted.filter((c) => c.status === 'done').length;
  const active = counted.filter((c) => c.status === 'active' || c.status === 'review').length;
  const sum = `${done} of ${counted.length} done${active ? ` · ${active} in flight` : ''}`;
  return {
    sum,
    segments: children.map((c) => c.status ?? 'open'),
    row: counted.find((c) => c.status !== 'done'),
  };
}

/** A feature effect as written: "adds feature:x" → adds x; a bare key changes it. */
export function effectsOf(features: unknown): { effect: string; key: string }[] {
  if (!Array.isArray(features)) return [];
  return features
    .filter((f): f is string => typeof f === 'string')
    .map((f) => {
      const i = f.indexOf(' ');
      return i > 0 ? { effect: f.slice(0, i), key: f.slice(i + 1) } : { effect: 'changes', key: f };
    });
}

type Source = ChangeContext['sources'][number];

/** The sources as rows: the branch and whether a session was seen on it, the links, the files; and the one-line sum
 *  the head says. */
export function sourcesView(ctx: Pick<ChangeContext, 'sources' | 'branch'>): {
  branch?: { name: string; observed: boolean };
  links: Source[];
  files: Source[];
  sum: string;
} {
  const files = ctx.sources.filter((s) => s.key.startsWith('file:'));
  const links = ctx.sources.filter((s) => !s.key.startsWith('file:'));
  const sum = [
    ctx.branch ? `branch ${ctx.branch.name}` : '',
    links.length ? plural(links.length, 'link') : '',
    files.length ? plural(files.length, 'file') : 'no files yet',
  ]
    .filter(Boolean)
    .join(' · ');
  return { branch: ctx.branch, links, files, sum };
}

/** The identity row's label: where the session is now, or what the person is viewing instead. */
export const identityLabel = (isViewing: boolean, kind: 'change' | 'bug' = 'change'): string =>
  `${isViewing ? 'viewing' : 'on now'} · ${kind}`;

/** How long a session the store does not hold is taken to be one about to start, before the page says there is none:
 *  the docked pane is pointed at the page before the record is written, and the write lands within a few seconds. */
export const STARTING_MS = 10_000;

export type Absence = 'starting' | 'none' | 'failed';

/** What the page shows when the session view failed: no record within the starting window is a session on its way
 *  (change:session-page-before-record); past it, no such session; any other failure is the server's, said as it is. */
export function absence(status: number | undefined, waited: boolean): Absence {
  if (status !== 404) return 'failed';
  return waited ? 'none' : 'starting';
}
