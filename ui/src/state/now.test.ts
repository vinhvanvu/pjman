import { beforeEach, describe, expect, it } from 'vitest';
import { useNowStore } from './now';

const frame = (o: Record<string, unknown>) => JSON.stringify({ op: 'now', type: 'session', ...o });

describe('the now store', () => {
  beforeEach(() => useNowStore.setState({ bySession: {} }));

  it("holds each session's latest action, a newer frame replacing it", () => {
    const { take } = useNowStore.getState();
    take(frame({ key: 'session:a', text: 'Reading src/a.ts', tool: 'Read', at: '2026-11-11T12:00:00Z' }));
    take(frame({ key: 'session:a', text: 'Running the tests', tool: 'Bash', at: '2026-11-11T12:00:05Z' }));
    take(frame({ key: 'session:b', text: 'Editing x.ts', at: '2026-11-11T12:00:01Z' }));
    const s = useNowStore.getState().bySession;
    expect(s['session:a']).toEqual({ text: 'Running the tests', tool: 'Bash', at: '2026-11-11T12:00:05Z' });
    expect(s['session:b']?.text).toBe('Editing x.ts');
  });

  it('clears a session on a frame with no text, and ignores what it cannot read', () => {
    const { take } = useNowStore.getState();
    take(frame({ key: 'session:a', text: 'Reading', at: '2026-11-11T12:00:00Z' }));
    take(frame({ key: 'session:a', at: '2026-11-11T12:01:00Z' }));
    take('not json');
    take(frame({ text: 'no key' }));
    expect(useNowStore.getState().bySession).toEqual({});
  });
});
