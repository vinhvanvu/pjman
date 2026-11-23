import { describe, expect, it } from 'vitest';
import { isAlone, milestoneProgress } from './milestone';

describe('a milestone progress (change:childless-milestone-progress)', () => {
  it('reads the work beneath when there is some', () => {
    expect(milestoneProgress({ status: 'open', progress: { done: 2, total: 4 } })).toEqual({ done: 2, total: 4 });
    expect(isAlone({ status: 'open', progress: { done: 2, total: 4 } })).toBe(false);
  });
  it('reads a milestone with nothing beneath it as itself', () => {
    expect(milestoneProgress({ status: 'done', progress: { done: 0, total: 0 } })).toEqual({ done: 1, total: 1 });
    expect(milestoneProgress({ status: 'active', progress: { done: 0, total: 0 } })).toEqual({ done: 0, total: 1 });
    expect(isAlone({ status: 'done', progress: { done: 0, total: 0 } })).toBe(true);
  });
  it('counts none on a dropped one, and nothing on a row that carries no progress', () => {
    expect(milestoneProgress({ status: 'dropped', progress: { done: 0, total: 0 } })).toEqual({ done: 0, total: 0 });
    expect(milestoneProgress({ status: 'done' })).toBeUndefined();
  });
});
