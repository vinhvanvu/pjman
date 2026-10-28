import { describe, expect, it } from 'vitest';
import { atParam } from '@/state/moment';
import { atSearch, pageSearch } from './-search';

// The router parses search values as JSON, so `?at=1842` reaches the schema as the number 1842 and an instant as a
// string. Both must survive, or the router rewrites the URL without the cursor and the page silently reads now.
describe('the time cursor in the URL', () => {
  it('keeps a sequence number as a number and an instant as text', () => {
    expect(atSearch.parse(1842)).toBe(1842);
    expect(pageSearch.parse({ at: 1842 }).at).toBe(1842);
    expect(pageSearch.parse({ at: '2026-10-28T14:02:00-07:00' }).at).toBe('2026-10-28T14:02:00-07:00');
  });
  it('drops what is not a moment instead of failing the page', () => {
    expect(pageSearch.parse({ at: 0 }).at).toBeUndefined();
    expect(pageSearch.parse({ at: '' }).at).toBeUndefined();
    expect(pageSearch.parse({ at: { x: 1 } }).at).toBeUndefined();
    expect(pageSearch.parse({}).at).toBeUndefined();
  });
  it('hands queries text, and now for nothing', () => {
    expect(atParam(1842)).toBe('1842');
    expect(atParam('2026-10-28T14:02')).toBe('2026-10-28T14:02');
    expect(atParam(undefined)).toBeUndefined();
    expect(atParam('')).toBeUndefined();
  });
});
