import { describe, expect, it } from 'vitest';
import { clock, momentWords } from './model';

const same = (iso: string) => iso;

describe('momentWords', () => {
  const resolved = { seq: 1842, at: '2026-10-28T14:02:00Z', commit: 'abc' };
  it('names a time by its clock and a selected event by its number', () => {
    expect(momentWords({ at: '2026-10-28T14:02' }, resolved, same)).toBe('as of 2026-10-28T14:02:00Z');
    expect(momentWords({ event: 1842 }, resolved, same)).toBe('event #1842 · 2026-10-28T14:02:00Z');
  });
  it('shows the cursor as given until the server answers', () => {
    expect(momentWords({ event: 1842 }, undefined, same)).toBe('event #1842');
    expect(momentWords({ at: '2026-10-28T14:02' }, undefined, same)).toBe('as of 2026-10-28T14:02');
  });
});

describe('clock', () => {
  it('reads the time alone on the same day and adds the date otherwise', () => {
    const now = Date.parse('2026-10-28T20:00:00');
    expect(clock('2026-10-28T14:02:00', now, 'en-US')).toMatch(/^\d{2}:\d{2}( [AP]M)?$/);
    expect(clock('2026-10-27T14:02:00', now, 'en-US')).toMatch(/^Oct 27, /);
    expect(clock('not a date', now)).toBe('not a date');
  });
});
