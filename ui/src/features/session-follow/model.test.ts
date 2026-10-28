import { describe, expect, it } from 'vitest';
import { away, followName, followState, livenessWords, newestLines } from './model';

describe('followState', () => {
  it('follows on the session route with nothing else open', () => {
    expect(followState({ state: 'live' }, { onSessionRoute: true, looking: false })).toBe('following');
    expect(followState({ state: 'quiet' }, { onSessionRoute: true, looking: false })).toBe('following');
    expect(followState(undefined, { onSessionRoute: true, looking: false })).toBe('following');
  });
  it('pauses the moment the person steers: a selection, a tab, another page', () => {
    expect(followState({ state: 'live' }, { onSessionRoute: true, looking: true })).toBe('paused');
    expect(followState({ state: 'live' }, { onSessionRoute: false, looking: false })).toBe('paused');
  });
  it('ended wins wherever the person stands', () => {
    expect(followState({ state: 'ended' }, { onSessionRoute: true, looking: false })).toBe('ended');
    expect(followState({ state: 'ended' }, { onSessionRoute: false, looking: true })).toBe('ended');
  });
  it('the way back shows whenever the person is away, ended or not', () => {
    expect(away({ onSessionRoute: true, looking: false })).toBe(false);
    expect(away({ onSessionRoute: true, looking: true })).toBe(true);
    expect(away({ onSessionRoute: false, looking: false })).toBe(true);
  });
});

describe('followName', () => {
  it('names the change the session is on, as people say it', () => {
    expect(followName({ on: 'change:pjman/docked-view' }, 'abc12345-0000')).toBe('docked-view');
  });
  it('falls back to the product, then the first letters of the id', () => {
    expect(followName({ product: 'product:pjman' }, 'abc12345-0000')).toBe('pjman');
    expect(followName(undefined, 'abc12345-0000')).toBe('abc12345');
  });
});

describe('newestLines', () => {
  it('takes the last n, newest first, and leaves the log alone', () => {
    const log = [1, 2, 3, 4, 5];
    expect(newestLines(log, 3)).toEqual([5, 4, 3]);
    expect(newestLines(log, 10)).toEqual([5, 4, 3, 2, 1]);
    expect(log).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('livenessWords', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('says live and how recently, quiet since when, ended when', () => {
    expect(livenessWords({ state: 'live', last: '2026-10-28T11:58:00Z' }, now)).toBe('live · 2m');
    expect(livenessWords({ state: 'quiet', last: '2026-10-28T10:00:00Z' }, now)).toBe('quiet since 2h ago');
    expect(livenessWords({ state: 'ended', last: '2026-10-28T11:59:50Z' }, now)).toBe('ended just now');
  });
  it('copes without a last instant', () => {
    expect(livenessWords({ state: 'quiet' }, now)).toBe('quiet');
    expect(livenessWords(undefined, now)).toBe('');
  });
});
