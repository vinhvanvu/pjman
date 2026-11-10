// The session page's model (change:session-detail): what the one tree reads at either width, as pure derivations.
// The chips are the changes the session touched, last touch first, each with its writes or the word read, the
// session's focus marked and a dot when a decision waits there (decision one-shown-change). The shown change is the
// person's pick while they hold one, else the focus. The session bar, the plan's head and the sources' head are words
// read off the facts; the plan's bar is one segment a step.
import type { RailLane, SessionFacts, WaitingDecision } from '@/data/contract';
import { waitsLine } from '@/features/change/model';
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
      title: l.label ?? short(l.id),
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

/** Where the session runs, as the bar says it: the host and its version, and a word when the adapter has not validated
 *  that version; nothing when no host holds it. */
export function hostWords(host: SessionFacts['host'] | undefined): string {
  if (!host) return '';
  return `in ${host.name}${host.version ? ` ${host.version}` : ''}${host.validated === false ? ' (unvalidated)' : ''}`;
}

/** What the program is blocked on, as the host says it: a question for the person, a permission, a login. */
export function blockedWords(kind: string | undefined): string {
  return kind === 'question' ? 'asks you a question' : kind === 'permission' ? 'asks your permission' : kind === 'auth' ? 'needs you to sign in' : 'blocked, needs you';
}

/** The session bar's parts, in order: who for whom, and where it runs; working for how long, or quiet or ended since
 *  when; when it last acted; what waits. The last part is the one that reads in the waits colour when something does. */
export function sessionBar(
  session: Pick<SessionFacts, 'agent' | 'onBehalfOf' | 'started' | 'last' | 'state' | 'host'>,
  waits: number,
  now = Date.now(),
): { parts: string[]; waits: string; alarm: boolean } {
  const who = [
    session.agent ? short(session.agent) : 'session',
    session.onBehalfOf ? `for ${short(session.onBehalfOf)}` : '',
    hostWords(session.host),
  ]
    .filter(Boolean)
    .join(' ');
  const parts = [who];
  const status = session.host?.status;
  if (session.state !== 'ended' && status?.state === 'blocked') parts.push(blockedWords(status.kind));
  else if (session.state === 'live')
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

// the change tree's derivations live with the change tree (change:change-detail); the session page reads them there
export { effectsOf, identityLabel, planView, sourcesView, waitsLine, type Segment } from '@/features/change/model';

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
