import { describe, expect, it } from 'vitest';
import type { BridgeSession, WaitingChange } from '@/data/contract';
import { cardWhen, proposedWhen, strip, subagentWords } from './model';

const s = (key: string, o: Partial<BridgeSession> = {}): BridgeSession => ({
  key: `session:${key}`,
  state: 'working',
  inReview: false,
  children: [],
  ...o,
});
const change = (key: string) => ({ key: `change:p/${key}`, title: key, path: [] });
const w = (key: string, decisions: string[]): WaitingChange => ({
  change: change(key),
  proposed: decisions.map((d) => ({ key: `decision:p/${key}/${d}`, change: `change:p/${key}`, title: d })),
});

describe('strip', () => {
  it('lists every session group in the order of need, empty or not, and no waits when nothing is proposed', () => {
    const { waits, groups } = strip({ waitingOn: [], sessions: [] });
    expect(waits).toEqual([]);
    expect(groups.map((g) => g.state)).toEqual(['stopped', 'working', 'ended']);
    expect(groups.every((g) => g.sessions.length === 0)).toBe(true);
  });

  it('puts each session under its state, the most recent write first inside a group', () => {
    const { groups } = strip({
      waitingOn: [],
      sessions: [
        s('a', { state: 'working', last: '2026-10-28T10:00:00Z' }),
        s('c', { state: 'working', last: '2026-10-28T11:00:00Z' }),
        s('d', { state: 'ended', last: '2026-10-28T08:00:00Z', inReview: true }),
        s('e', { state: 'stopped' }),
      ],
    });
    const keys = (state: string) => groups.find((g) => g.state === state)!.sessions.map((x) => x.key);
    expect(keys('stopped')).toEqual(['session:e']);
    expect(keys('working')).toEqual(['session:c', 'session:a']);
    expect(keys('ended')).toEqual(['session:d']);
  });

  it('keeps the waiting changes in the order given and pairs each with the newest session on that change, shown nowhere else', () => {
    const { waits, groups } = strip({
      waitingOn: [w('graph', ['toggle']), w('bridge', ['stage', 'rail'])],
      sessions: [
        s('old', { state: 'ended', last: '2026-10-28T08:00:00Z', change: change('graph'), inReview: true }),
        s('g', { state: 'waiting', last: '2026-10-28T11:00:00Z', change: change('graph') }),
        s('b', { state: 'working', last: '2026-10-28T10:00:00Z', change: change('bridge') }),
        s('other', { state: 'working', last: '2026-10-28T09:00:00Z', change: change('dock') }),
      ],
    });
    expect(waits.map((x) => [x.change.key, x.session?.key, x.proposed.length])).toEqual([
      ['change:p/graph', 'session:g', 1],
      ['change:p/bridge', 'session:b', 2],
    ]);
    const keys = (state: string) => groups.find((g) => g.state === state)!.sessions.map((x) => x.key);
    expect(keys('working')).toEqual(['session:other']);
    expect(keys('ended')).toEqual(['session:old']); // an older session on the same change still has its own row
    expect(keys('stopped')).toEqual([]);
  });

  it('reads a waiting change with no session in the window as a change alone', () => {
    const { waits } = strip({ waitingOn: [w('graph', ['toggle'])], sessions: [] });
    expect(waits[0]?.session).toBeUndefined();
  });

  it('leaves out an ended session whose change is not in review', () => {
    const { groups } = strip({
      waitingOn: [],
      sessions: [s('done', { state: 'ended', inReview: false }), s('review', { state: 'ended', inReview: true })],
    });
    expect(groups.find((g) => g.state === 'ended')!.sessions.map((x) => x.key)).toEqual(['session:review']);
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

describe('subagentWords', () => {
  it('counts the subagents, and says when one is still working', () => {
    expect(subagentWords([])).toBeUndefined();
    expect(subagentWords([{ state: 'stopped' }])).toBe('+1 subagent');
    expect(subagentWords([{ state: 'stopped' }, { state: 'ended' }])).toBe('+2 subagents');
    expect(subagentWords([{ state: 'working' }, { state: 'stopped' }])).toBe('1 subagent working');
  });
});

describe('proposedWhen', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('says when the decision was opened', () => {
    expect(proposedWhen('2026-10-28T10:00:00Z', now)).toBe('proposed 2h ago');
    expect(proposedWhen('2026-10-28T11:59:50Z', now)).toBe('proposed just now');
    expect(proposedWhen(undefined, now)).toBe('proposed');
  });
});
