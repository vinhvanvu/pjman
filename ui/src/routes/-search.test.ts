import { describe, expect, it } from 'vitest';
import { atParam, cursorOf } from '@/state/moment';
import { pageSearch } from './-search';

// The router parses search values as JSON: `?event=1842` and an old `?at=1842` arrive as numbers, `?at=<instant>` as
// text. Each must survive the schema, or the router rewrites the URL without the cursor and the page reads now.
describe('the time cursor in the URL', () => {
  it('keeps a time as text and an event as a number', () => {
    const s = pageSearch.parse({ at: '2026-10-28T14:02:00-07:00', event: 1842 });
    expect(s.at).toBe('2026-10-28T14:02:00-07:00');
    expect(s.event).toBe(1842);
  });
  it('drops what is not a moment instead of failing the page', () => {
    for (const bad of [0, '', { x: 1 }]) expect(pageSearch.parse({ at: bad }).at).toBeUndefined();
    expect(pageSearch.parse({ event: 'x' }).event).toBeUndefined();
    expect(pageSearch.parse({}).at).toBeUndefined();
  });
});

describe('the cursor', () => {
  it('lets a selected event win over a time, and reads an old numeric at as an event', () => {
    expect(cursorOf({ at: '2026-10-28T14:02', event: 1842 })).toEqual({ event: 1842 });
    expect(cursorOf({ at: 1842 })).toEqual({ event: 1842 });
    expect(cursorOf({ at: '2026-10-28T14:02' })).toEqual({ at: '2026-10-28T14:02' });
    expect(cursorOf({})).toEqual({});
  });
  it('sends the event exactly, else the time, else now', () => {
    expect(atParam({ event: 1842 })).toBe('1842');
    expect(atParam({ at: '2026-10-28T14:02' })).toBe('2026-10-28T14:02');
    expect(atParam({})).toBeUndefined();
  });
});
