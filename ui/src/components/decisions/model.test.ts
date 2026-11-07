import { describe, expect, it } from 'vitest';
import type { DecisionState } from '@/data/contract';
import { type CardDecision, chosenOf, decidedMeta, grouped, groupHead, openByDefault, proposedMeta } from './model';

const state = (o: Partial<DecisionState> = {}): DecisionState => ({ criteria: [], options: [], comments: [], ...o });
const option = (id: string, recommended = false) => ({ id, text: id, recommended, accepted: false });
const card = (key: string, o: Partial<CardDecision> = {}): CardDecision => ({
  key: `decision:p/c/${key}`,
  change: 'change:p/c',
  status: 'proposed',
  state: state(),
  needs: [],
  stale: false,
  ...o,
});

describe('the card words', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('says when a decision was proposed and how many options it has', () => {
    expect(
      proposedMeta({ created: '2026-11-06T11:54:00Z', state: state({ options: [option('a'), option('b')] }) }, now),
    ).toBe('proposed 6 min ago · 2 options');
    expect(proposedMeta({ created: undefined, state: state({ options: [option('a')] }) }, now)).toBe(
      'proposed · 1 option',
    );
  });
  it('says who decided and when', () => {
    expect(
      decidedMeta({ status: 'decided', decidedBy: 'person:vinhvanvu', decidedOn: '2026-11-06', state: state() }),
    ).toBe('decided by vinhvanvu · 2026-11-06');
    expect(decidedMeta({ status: 'superseded', state: state() })).toBe('superseded');
  });
});

describe('what Accept takes', () => {
  const s = state({
    options: [option('lead', true), option('change')],
    recommendation: { option: 'lead', at: '2026-11-06T11:00:00Z' },
  });
  it('is the recommendation until the person picks another option', () => {
    expect(chosenOf(s)).toEqual({ id: 'lead', note: 'the recommendation' });
    expect(chosenOf(s, 'change')).toEqual({ id: 'change', note: 'your pick' });
    expect(chosenOf(s, 'lead')).toEqual({ id: 'lead', note: 'the recommendation' });
  });
  it('is the only option when there is one, and nothing among several unrecommended', () => {
    expect(chosenOf(state({ options: [option('a')] }))).toEqual({ id: 'a', note: 'the only option' });
    expect(chosenOf(state({ options: [option('a'), option('b')] }))).toBeUndefined();
    expect(chosenOf(s, 'missing')).toEqual({ id: 'lead', note: 'the recommendation' });
  });
});

describe('the group', () => {
  const list = [
    card('later', { created: '2026-11-06T11:30:00Z' }),
    card('first', { created: '2026-11-06T11:00:00Z' }),
    card('old', { status: 'decided', decidedOn: '2026-11-01' }),
    card('new', { status: 'decided', decidedOn: '2026-11-05' }),
    card('gone', { status: 'superseded' }),
  ];
  it('puts the waiting oldest first, the decided newest first, the rest in history', () => {
    const g = grouped(list);
    expect(g.waiting.map((d) => d.key)).toEqual(['decision:p/c/first', 'decision:p/c/later']);
    expect(g.decided.map((d) => d.key)).toEqual(['decision:p/c/new', 'decision:p/c/old']);
    expect(g.history.map((d) => d.key)).toEqual(['decision:p/c/gone']);
  });
  it('heads the group by what waits and where the decided are', () => {
    expect(groupHead(0, 3, 'session')).toBe('nothing waits · the decided are on the rail');
    expect(groupHead(0, 3, 'change')).toBe('nothing waits · 3 decided');
    expect(groupHead(0, 0, 'change')).toBe('nothing waits');
    expect(groupHead(1, 0, 'session')).toBe('1 waits on you');
    expect(groupHead(2, 0, 'change')).toBe('2 wait on you, oldest first');
  });
  it('opens the oldest waiting by default, or the one a link names', () => {
    const { waiting } = grouped(list);
    expect(openByDefault(waiting)).toBe('decision:p/c/first');
    expect(openByDefault(waiting, 'decision:p/c/later')).toBe('decision:p/c/later');
    expect(openByDefault(waiting, 'decision:p/c/gone')).toBe('decision:p/c/first');
    expect(openByDefault([])).toBeUndefined();
  });
});
