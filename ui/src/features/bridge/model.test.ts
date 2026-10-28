import { describe, expect, it } from 'vitest';
import type { BridgeSession } from '@/data/contract';
import { cardWhen, needGroups, subagentWords } from './model';

const s = (key: string, o: Partial<BridgeSession> = {}): BridgeSession => ({
  key: `session:${key}`,
  state: 'working',
  inReview: false,
  children: [],
  ...o,
});

describe('needGroups', () => {
  it('lists every group in the order of need, empty or not', () => {
    const groups = needGroups([]);
    expect(groups.map((g) => g.state)).toEqual(['waiting', 'stopped', 'working', 'ended']);
    expect(groups.every((g) => g.sessions.length === 0)).toBe(true);
  });

  it('puts each session under its state, the most recent write first inside a group', () => {
    const groups = needGroups([
      s('a', { state: 'working', last: '2026-10-28T10:00:00Z' }),
      s('b', { state: 'waiting', last: '2026-10-28T09:00:00Z' }),
      s('c', { state: 'working', last: '2026-10-28T11:00:00Z' }),
      s('d', { state: 'ended', last: '2026-10-28T08:00:00Z', inReview: true }),
      s('e', { state: 'stopped' }),
    ]);
    const keys = (state: string) => groups.find((g) => g.state === state)!.sessions.map((x) => x.key);
    expect(keys('waiting')).toEqual(['session:b']);
    expect(keys('stopped')).toEqual(['session:e']);
    expect(keys('working')).toEqual(['session:c', 'session:a']);
    expect(keys('ended')).toEqual(['session:d']);
  });

  it('leaves out an ended session whose change is not in review', () => {
    const groups = needGroups([
      s('done', { state: 'ended', inReview: false }),
      s('review', { state: 'ended', inReview: true }),
    ]);
    expect(groups.find((g) => g.state === 'ended')!.sessions.map((x) => x.key)).toEqual(['session:review']);
  });
});

describe('subagentWords', () => {
  it('counts the subagents, and says when one is still working', () => {
    expect(subagentWords([])).toBeUndefined();
    expect(subagentWords([{ state: 'stopped' }])).toBe('+1 subagent');
    expect(subagentWords([{ state: 'stopped' }, { state: 'ended' }])).toBe('+2 subagents');
    expect(subagentWords([{ state: 'working' }, { state: 'stopped' }])).toBe('1 subagent working');
  });
});

describe('cardWhen', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('says what the session last did and how long ago', () => {
    expect(cardWhen({ state: 'working', last: '2026-10-28T11:54:00Z' }, now)).toBe('wrote 6m ago');
    expect(cardWhen({ state: 'working', last: '2026-10-28T11:59:50Z' }, now)).toBe('wrote just now');
    expect(cardWhen({ state: 'waiting', last: '2026-10-28T11:38:00Z' }, now)).toBe('stopped 22m ago');
    expect(cardWhen({ state: 'stopped', last: '2026-10-28T09:00:00Z' }, now)).toBe('stopped 3h ago');
    expect(cardWhen({ state: 'ended', last: '2026-10-28T11:00:00Z' }, now)).toBe('ended 1h ago');
    expect(cardWhen({ state: 'ended' }, now)).toBe('ended');
  });
});
