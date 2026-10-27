import { describe, expect, it } from 'vitest';
import { homeLens, isNodeKey, kindOf, short, targetOf } from './keys';

describe('keys', () => {
  it('splits a key and shortens it the way people say it', () => {
    expect(kindOf('change:crud')).toBe('change');
    expect(short('change:crud')).toBe('crud');
    expect(short('decision:crud/rm-refuses-while-referenced')).toBe('crud/rm-refuses-while-referenced');
    expect(short('github-issue:vinhvanvu/pjman#4')).toBe('#4');
    expect(short('linear:APP-1')).toBe('APP-1');
  });

  it('knows which keys are nodes of the tree and where they live', () => {
    expect(isNodeKey('feature:navigation')).toBe(true);
    expect(isNodeKey('decision:a/b')).toBe(false);
    expect(homeLens('feature:navigation')).toBe('feature');
    expect(homeLens('project:pjman')).toBeUndefined();
    expect(isNodeKey('project:pjman')).toBe(false);
    expect(homeLens('change:crud')).toBeUndefined();
  });
});

describe('the link rule', () => {
  it('keeps the lens for a change or product, switches to the home lens otherwise', () => {
    expect(targetOf('change:crud', 'milestone')).toEqual({ kind: 'node', lens: 'milestone', node: 'change:crud' });
    expect(targetOf('product:pjman', 'milestone')).toEqual({ kind: 'node', lens: 'milestone', node: 'product:pjman' });
    expect(targetOf('feature:navigation', 'milestone')).toEqual({
      kind: 'node',
      lens: 'feature',
      node: 'feature:navigation',
    });
    expect(targetOf('project:pjman', 'feature')).toEqual({ kind: 'get', key: 'project:pjman' });
  });

  it('sends sessions, urls and everything else to their own routes', () => {
    expect(targetOf('session:abc', 'feature')).toEqual({ kind: 'session', id: 'abc' });
    expect(targetOf('url:https://example.com/x', 'feature')).toEqual({
      kind: 'external',
      url: 'https://example.com/x',
    });
    expect(targetOf('decision:crud/why', 'feature')).toEqual({ kind: 'get', key: 'decision:crud/why' });
    expect(targetOf('file:src/scope.ts', 'feature')).toEqual({ kind: 'get', key: 'file:src/scope.ts' });
  });
});
