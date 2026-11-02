import { describe, expect, it } from 'vitest';
import { heldOrder } from './hold';
import { eventTone, TONE } from './tones';

const item = (key: string, says = '') => ({ key, says });
const key = (t: { key: string }) => t.key;

describe('heldOrder', () => {
  it('keeps the held order and slots, each item saying what it says now', () => {
    const frozen = [item('a', 'old'), item('b'), item('c')];
    const live = [item('b'), item('a', 'new'), item('c')];
    const { shown, pending } = heldOrder(frozen, live, key);
    expect(shown.map((t) => t.key)).toEqual(['a', 'b', 'c']);
    expect(shown[0]!.says).toBe('new');
    expect(pending).toBe(2);
  });
  it('leaves out what arrived and keeps what left as it was, until the release', () => {
    const { shown, pending } = heldOrder([item('a'), item('gone', 'last seen')], [item('new'), item('a')], key);
    expect(shown).toEqual([item('a'), item('gone', 'last seen')]);
    expect(pending).toBe(3);
  });
  it('lets an item the person acted on leave once it has gone, the rest still held', () => {
    const frozen = [item('a'), item('decided'), item('c')];
    const live = [item('new'), item('c'), item('a')];
    const { shown, pending } = heldOrder(frozen, live, key, undefined, new Set(['decided']));
    expect(shown.map((t) => t.key)).toEqual(['a', 'c']);
    // what left is no longer waiting on the release: only the arrival and the move are
    expect(pending).toBe(2);
  });
  it('keeps an item let go in its place while it is still live', () => {
    const { shown } = heldOrder(
      [item('a', 'old'), item('b')],
      [item('b'), item('a', 'new')],
      key,
      undefined,
      new Set(['a']),
    );
    expect(shown).toEqual([item('a', 'new'), item('b')]);
  });
  it('has nothing pending when nothing moved', () => {
    expect(heldOrder([item('a')], [item('a', 'changed')], key).pending).toBe(0);
  });
});

describe('eventTone', () => {
  it("flashes a decision in the status the write left it, a session's line live, a change's write active", () => {
    expect(eventTone({ type: 'decision', status: 'proposed' })).toBe(TONE.waits);
    expect(eventTone({ type: 'decision', status: 'decided' })).toBe(TONE.done);
    expect(eventTone({ type: 'session' })).toBe(TONE.live);
    expect(eventTone({ type: 'change' })).toBe(TONE.active);
    expect(eventTone({ type: 'feature' })).toBe(TONE.quiet);
  });
});
