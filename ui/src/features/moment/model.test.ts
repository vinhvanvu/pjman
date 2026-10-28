import { describe, expect, it } from 'vitest';
import { clock, momentWords } from './model';

const same = (iso: string) => iso;

describe('momentWords', () => {
  it('names the event and its instant once resolved', () => {
    expect(momentWords('1842', { seq: 1842, at: '2026-10-28T14:02:00Z', commit: 'abc' }, same)).toBe(
      'as of #1842 · 2026-10-28T14:02:00Z',
    );
  });
  it('shows the cursor as typed until the server answers', () => {
    expect(momentWords('1842', undefined, same)).toBe('as of #1842');
    expect(momentWords('2026-10-28T14:02', undefined, same)).toBe('as of 2026-10-28T14:02');
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
