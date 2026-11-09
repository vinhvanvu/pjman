// The decision card's model (decision detail-pages/decision-card): one shape for a decision wherever it is drawn, read
// from what each surface has (a waiting decision beneath a node, a decision row on a change), and the words the card
// says at each depth: a decided row reads its answer, and the decided list folds to a count. Pure: data in, words out.
import type { ChangeContext, DecisionState, WaitingDecision } from '@/data/contract';
import { agoWords, plural } from '@/lib/format';
import { changeOfDecision, short } from '@/lib/keys';

type DecisionRow = ChangeContext['decisions'][number];

/** A decision as a card draws it, whatever the surface read it from. */
export interface CardDecision {
  key: string;
  change: string;
  name?: string;
  /** The gist. */
  gist?: string;
  status: string;
  created?: string;
  decidedBy?: string;
  decidedOn?: string;
  state: DecisionState;
  needs: string[];
  stale: boolean;
  migrated?: string;
  supersededBy?: string;
}

/** The card's three depths: a row (name, when, how many options), the ladder (name, gist, meta, the one action), the
 *  thread (the whole conversation, in reading order). */
export type Depth = 'row' | 'ladder' | 'thread';

export function fromWaiting(d: WaitingDecision): CardDecision {
  return {
    key: d.key,
    change: d.change,
    name: d.name,
    gist: d.gist,
    status: 'proposed',
    created: d.created,
    state: d.state,
    needs: d.needs,
    stale: d.stale,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function fromRow(d: DecisionRow, change?: string): CardDecision {
  return {
    key: d.key,
    change: change ?? changeOfDecision(d.key) ?? '',
    name: d.name,
    gist: d.gist,
    status: d.status ?? 'proposed',
    created: d.created,
    decidedBy: str(d.data.decided_by),
    decidedOn: str(d.data.decided_on),
    state: d.state,
    needs: d.needs,
    stale: d.stale,
    migrated: d.migrated,
    supersededBy: d.supersededBy,
  };
}

/** What the card calls the decision: its name, else its gist, else its slug. */
export const nameOf = (d: Pick<CardDecision, 'key' | 'name' | 'gist'>): string => d.name ?? d.gist ?? short(d.key);

/** "proposed 6 min ago · 2 options": the meta line on a waiting card and its row. */
export function proposedMeta(d: Pick<CardDecision, 'created' | 'state'>, now = Date.now()): string {
  const when = d.created ? `proposed ${agoWords(d.created, now)}` : 'proposed';
  return `${when} · ${plural(d.state.options.length, 'option')}`;
}

/** "decided by vinhvanvu · 2026-11-06": the meta line on a decided row. */
export function decidedMeta(d: Pick<CardDecision, 'decidedBy' | 'decidedOn' | 'state' | 'status'>): string {
  if (d.status === 'superseded') return 'superseded';
  if (d.status === 'reverted') return 'reverted';
  const by = d.decidedBy ?? d.state.accepted?.by;
  const on = d.decidedOn ?? d.state.accepted?.at.slice(0, 10);
  return [by ? `decided by ${short(by)}` : 'decided', on].filter(Boolean).join(' · ');
}

/** The answer a decided row reads: the accepted option, by its id and its one line (decided decided-decisions-fold/
 *  fold-by-default: the row reads the answer alone; the name and gist wait in the thread). Undefined when the thread
 *  holds no accepted option, so the row falls back to the name. */
export function answerOf(d: Pick<CardDecision, 'state'>): { id: string; text: string } | undefined {
  const s = d.state;
  const o = s.options.find((x) => x.accepted) ?? s.options.find((x) => x.id === s.accepted?.option);
  if (o) return { id: o.id, text: o.text };
  if (s.accepted) return { id: s.accepted.option, text: s.accepted.text ?? s.accepted.option };
  return undefined;
}

/** "3 decided": the one line the decided list folds to on a change. */
export const decidedHead = (n: number): string => `${n} decided`;

/** The option Accept takes: the person's pick while they hold one, else the recommendation, else the only option;
 *  undefined when the thread recommends nothing among several, so Accept has nothing to name. The note says which. */
export function chosenOf(
  state: DecisionState,
  pick?: string,
): { id: string; note: 'the recommendation' | 'your pick' | 'the only option' } | undefined {
  const picked = pick && state.options.find((o) => o.id === pick);
  if (picked) return { id: picked.id, note: picked.recommended ? 'the recommendation' : 'your pick' };
  if (state.recommendation) return { id: state.recommendation.option, note: 'the recommendation' };
  const only = state.options.length === 1 ? state.options[0] : undefined;
  if (only) return { id: only.id, note: 'the only option' };
  return undefined;
}

/** The decisions a group draws, in reading order: proposed oldest first (the first asked is usually the one the others
 *  wait on), decided newest first, and the superseded and reverted folded under one history line. */
export function grouped(list: readonly CardDecision[]): {
  waiting: CardDecision[];
  decided: CardDecision[];
  history: CardDecision[];
} {
  const by = (a: CardDecision, b: CardDecision) => (a.created ?? '').localeCompare(b.created ?? '');
  const waiting = list.filter((d) => d.status === 'proposed').toSorted(by);
  const decided = list
    .filter((d) => d.status === 'decided')
    .toSorted((a, b) => (b.decidedOn ?? '').localeCompare(a.decidedOn ?? '') || by(b, a));
  const history = list.filter((d) => d.status !== 'proposed' && d.status !== 'decided');
  return { waiting, decided, history };
}

/** The group's head: what waits, and where the decided are. On the session page the decided are on the rail; on the
 *  change page they are rows beneath. */
export function groupHead(waiting: number, decided: number, where: 'session' | 'change'): string {
  // on a change the decided fold's own line carries the count, so the head does not repeat it
  const rest = where === 'session' && decided ? 'the decided are on the rail' : '';
  if (waiting === 0) return ['nothing waits', rest].filter(Boolean).join(' · ');
  if (waiting === 1) return '1 waits on you';
  return `${waiting} wait on you, oldest first`;
}

/** The one card open in a group when the person has opened none: the oldest waiting, since it is the one the others
 *  usually wait on. A decision named by the link is open whatever its place. */
export function openByDefault(waiting: readonly CardDecision[], linked?: string): string | undefined {
  if (linked && waiting.some((d) => d.key === linked)) return linked;
  return waiting[0]?.key;
}
