import { describe, expect, test } from 'vitest';
import { productOfKey, reaches } from './reach';
import { queryKeys } from './queries';

describe('productOfKey', () => {
  test('a record keyed under a product names it', () => {
    expect(productOfKey('change:shop/card-form')).toBe('shop');
    expect(productOfKey('decision:shop/card-form/which-way')).toBe('shop');
    expect(productOfKey('feature:shop/checkout')).toBe('shop');
    expect(productOfKey('product:shop')).toBe('shop');
  });
  test('a record under no product names none', () => {
    expect(productOfKey('session:0d82d62c')).toBeNull();
    expect(productOfKey('project:web')).toBeNull();
    expect(productOfKey('person:tester')).toBeNull();
    expect(productOfKey('change:card-form')).toBeNull();
  });
});

describe('reaches', () => {
  const shop = new Set(['shop']);
  test('a page of the product a write was in refetches', () => {
    expect(reaches(queryKeys.bridge('product:shop'), shop)).toBe(true);
    expect(reaches(queryKeys.scope({ lens: 'feature', node: 'change:shop/card-form' }), shop)).toBe(true);
    expect(reaches(queryKeys.rail('feature:shop/checkout', {}), shop)).toBe(true);
  });
  test('a page of another product does not', () => {
    expect(reaches(queryKeys.bridge('product:darkfog'), shop)).toBe(false);
    expect(reaches(queryKeys.scope({ lens: 'roadmap', node: 'product:darkfog', done: true }), shop)).toBe(false);
  });
  test('a page that names no product reads every product, so it refetches', () => {
    expect(reaches(queryKeys.store(), shop)).toBe(true);
    expect(reaches(queryKeys.sessionView('0d82d62c'), shop)).toBe(true);
    expect(reaches(queryKeys.records({ type: 'change' }), shop)).toBe(true);
    expect(reaches(queryKeys.scope({ lens: 'feature', node: 'change:card-form' }), shop)).toBe(true);
  });
});
