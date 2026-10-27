import { describe, expect, it } from 'vitest';
import type { Scope } from '@/data/contract';
import { freshScope, pageProduct } from './identity';

const scope = (crumbs: { key: string; name?: string }[], node?: { key: string; name?: string }) =>
  ({ crumbs, node: node ?? null }) as unknown as Scope;

describe('identity has one source', () => {
  const known = [
    { key: 'product:darkfog', name: 'DARKFOG' },
    { key: 'product:pjman', name: 'pjman' },
  ];
  it('the URL names the product at once, before any scope', () => {
    expect(pageProduct('product:pjman', undefined, known)).toEqual({ key: 'product:pjman', name: 'pjman' });
    expect(pageProduct('product:new', undefined, known)).toEqual({ key: 'product:new' });
  });
  it('a node beneath a product waits for its own scope, and never takes the first known product', () => {
    expect(pageProduct('feature:store', undefined, known)).toBeUndefined();
    expect(
      pageProduct('feature:store', scope([{ key: 'product:pjman', name: 'pjman' }, { key: 'feature:store' }]), known),
    ).toEqual({
      key: 'product:pjman',
      name: 'pjman',
    });
    expect(pageProduct(undefined, scope([], { key: 'product:pjman', name: 'pjman' }), known)).toEqual({
      key: 'product:pjman',
      name: 'pjman',
    });
  });
  it('placeholder data from the previous page is not this page', () => {
    const previous = scope([{ key: 'product:darkfog', name: 'DARKFOG' }, { key: 'feature:fog' }]);
    expect(freshScope(previous, true)).toBeUndefined();
    expect(pageProduct('feature:store', freshScope(previous, true), known)).toBeUndefined();
    expect(pageProduct('feature:store', freshScope(previous, false), known)?.key).toBe('product:darkfog');
  });
});
