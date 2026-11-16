// Following, as pure derivations: the pill's state from where the person stands and what the session is doing, the
// name the pill calls the session, and the live lines the dock shows.
import type { SessionFacts } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';

export type FollowState = 'following' | 'paused' | 'ended';

export interface Standing {
  /** The page is the followed session's own route. */
  onSessionRoute: boolean;
  /** Something is selected, or a tab other than the overview is open: the person is looking around. */
  looking: boolean;
}

/** Following while the person stands on the session's route and looks at nothing else; paused the moment they steer;
 *  ended once the session wrote its closing line, wherever they stand. */
export function followState(session: Pick<SessionFacts, 'state'> | undefined, standing: Standing): FollowState {
  if (session?.state === 'ended') return 'ended';
  return away(standing) ? 'paused' : 'following';
}

/** The person is not looking at what the session is on: another page, a selection, another tab. The way back shows. */
export const away = (standing: Standing): boolean => !standing.onSessionRoute || standing.looking;

/** What the follow window does when the person prompts a session (decision follow-window/steered-window): the same
 *  session is nothing to do; another one is gone to while the window follows (or follows nothing yet, or its session
 *  ended), and held as the way back's offer while the person is looking around. */
export function onPrompted(home: string | undefined, prompted: string, standing: Standing): 'same' | 'go' | 'hold' {
  if (home === prompted) return 'same';
  if (!home || !away(standing)) return 'go';
  return 'hold';
}

/** A session's id from its key, as the session route takes it. */
export const sessionId = (key: string): string => (key.startsWith('session:') ? key.slice('session:'.length) : key);

/** What the pill calls the session: the change it is on, else the product it is in, else the id's first letters.
 *  Never the uuid alone when anything better is known. */
export function followName(session: Pick<SessionFacts, 'on' | 'product'> | undefined, id: string): string {
  if (session?.on) return short(session.on);
  if (session?.product) return short(session.product);
  return id.slice(0, 8);
}

/** The log newest first, at most `n` lines. */
export function newestLines<T>(log: readonly T[], n: number): T[] {
  return log.slice(-n).toReversed();
}

/** The live header's words: what the session is doing and since when. */
export function livenessWords(session: Pick<SessionFacts, 'state' | 'last'> | undefined, now = Date.now()): string {
  if (!session) return '';
  const since = session.last ? ago(session.last, now) : '';
  if (session.state === 'ended') return since ? `ended ${since === 'just now' ? since : `${since} ago`}` : 'ended';
  if (session.state === 'live') return since ? `live · ${since}` : 'live';
  return since ? `quiet since ${since === 'just now' ? since : `${since} ago`}` : 'quiet';
}
