import { describe, expect, it } from 'vitest';
import { ago, pct, plural, sinceDays, truncate } from './format';

const now = Date.parse('2026-10-24T12:00:00Z');
const at = (ms: number) => new Date(now - ms).toISOString();

describe('ago', () => {
  it('reads as the short form rows use', () => {
    expect(ago(at(10_000), now)).toBe('just now');
    expect(ago(at(5 * 60_000), now)).toBe('5m');
    expect(ago(at(3 * 3_600_000), now)).toBe('3h');
    expect(ago(at(2 * 86_400_000), now)).toBe('2d');
    expect(ago(at(21 * 86_400_000), now)).toBe('3w');
    expect(ago(undefined, now)).toBe('');
  });
});

describe('sinceDays', () => {
  it('names the day', () => {
    expect(sinceDays(0)).toBe('today');
    expect(sinceDays(1)).toBe('yesterday');
    expect(sinceDays(4)).toBe('4 days ago');
    expect(sinceDays(null)).toBe('never');
  });
});

describe('plural, pct, truncate', () => {
  it('counts, rounds and cuts on a word', () => {
    expect(plural(1, 'change')).toBe('1 change');
    expect(plural(2, 'capability', 'capabilities')).toBe('2 capabilities');
    expect(pct(15, 28)).toBe(54);
    expect(pct(0, 0)).toBe(0);
    expect(truncate('Vinh reviews the foundation as built', 20)).toBe('Vinh reviews the…');
    expect(truncate('short', 20)).toBe('short');
  });
});
