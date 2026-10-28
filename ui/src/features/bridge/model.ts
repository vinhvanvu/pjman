// The bridge's need strip, as pure derivations: the product's sessions grouped by what each needs from the person,
// in the order of need (decision stage-strip-transport). Need is the stable frame; inside a group the most recent
// write comes first. A session crosses groups only when its state changes.
import type { BridgeSession, SessionState } from '@/data/contract';
import { ago } from '@/lib/format';

export interface NeedGroup {
  state: SessionState;
  /** What the group is called, and the faint words beside it. */
  label: string;
  sessions: BridgeSession[];
}

/** The groups in the order of need: what waits on the person first, then what stopped with a next set, then what is
 *  working now, then what ended with its work in review. Every group is listed, empty or not. An ended session whose
 *  change is not in review is not in the strip: nothing about it needs the person. */
export const NEED_ORDER: readonly { state: SessionState; label: string }[] = [
  { state: 'waiting', label: 'Waits on you' },
  { state: 'stopped', label: 'Stopped · next set' },
  { state: 'working', label: 'Working' },
  { state: 'ended', label: 'Ended · in review' },
];

export function needGroups(sessions: readonly BridgeSession[]): NeedGroup[] {
  return NEED_ORDER.map(({ state, label }) => ({
    state,
    label,
    sessions: sessions
      .filter((s) => s.state === state && (state !== 'ended' || s.inReview))
      .toSorted((a, b) => (b.last ?? '').localeCompare(a.last ?? '') || a.key.localeCompare(b.key)),
  }));
}

/** The words after a card's feature path: what the session last did and when. */
export function cardWhen(s: Pick<BridgeSession, 'state' | 'last' | 'line'>, now = Date.now()): string {
  const since = s.last ? ago(s.last, now) : '';
  const back = since && since !== 'just now' ? `${since} ago` : since;
  switch (s.state) {
    case 'working':
      return back ? `wrote ${back}` : 'working';
    case 'ended':
      return back ? `ended ${back}` : 'ended';
    default:
      return back ? `stopped ${back}` : 'stopped';
  }
}

/** The faint words for a session's subagents, when it has any: how many, and whether one is still working. */
export function subagentWords(children: readonly Pick<BridgeSession, 'state'>[]): string | undefined {
  if (children.length === 0) return undefined;
  const working = children.filter((c) => c.state === 'working').length;
  const word = (n: number) => `${n} subagent${n === 1 ? '' : 's'}`;
  return working ? `${word(working)} working` : `+${word(children.length)}`;
}
