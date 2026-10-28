import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalSourceKey, decisionKey, parseDecisionRest, parseKey, parseScopedRest, productOfKey, shortenText, shortKey, slugify, sourceFileSlug } from '../keys.js';

test('keys split at the first colon', () => {
  assert.deepEqual(parseKey('url:https://x.y/z'), { kind: 'url', rest: 'https://x.y/z', raw: 'url:https://x.y/z' });
  assert.equal(parseKey('nokey'), null);
  assert.equal(parseKey(':x'), null);
  assert.equal(parseKey('a b:c'), null);
  assert.equal(parseKey('file: x'), null);
  assert.equal(parseKey('file:reports/a b.md')?.rest, 'reports/a b.md');
  assert.equal(parseKey(42), null);
});

test('decision keys: under a change (in full or bare), at product level, or at store level', () => {
  assert.deepEqual(parseDecisionRest('shop/schema/keys'), { head: 'shop', change: 'schema', slug: 'keys', segments: 3 });
  assert.deepEqual(parseDecisionRest('schema/keys'), { head: 'schema', change: null, slug: 'keys', segments: 2 });
  assert.deepEqual(parseDecisionRest('/keys'), { head: null, change: null, slug: 'keys', segments: 2 });
  assert.equal(parseDecisionRest('keys'), null);
  assert.equal(parseDecisionRest('Bad Slug/x'), null);
  assert.equal(parseDecisionRest('a/b/c/d'), null);
});

test('scoped keys: a namespace and a slug; the short form inside the product', () => {
  assert.deepEqual(parseScopedRest('shop/checkout'), { product: 'shop', slug: 'checkout' });
  assert.deepEqual(parseScopedRest('checkout'), { product: null, slug: 'checkout' });
  assert.equal(parseScopedRest('a/b/c'), null);
  assert.equal(productOfKey('feature:shop/checkout'), 'shop');
  assert.equal(productOfKey('decision:shop/cards/why'), 'shop');
  assert.equal(productOfKey('change:checkout'), null);
  assert.equal(productOfKey('project:shop'), null);
  assert.equal(shortKey('feature:shop/checkout', 'shop'), 'feature:checkout');
  assert.equal(shortKey('decision:shop/cards/why', 'product:shop'), 'decision:cards/why');
  assert.equal(shortKey('feature:other/checkout', 'shop'), 'feature:other/checkout');
  assert.equal(shortKey('project:shop', 'shop'), 'project:shop');
  assert.equal(shortenText('see change:shop/cards and feature:other/x and decision:shop/cards/why', 'shop'), 'see change:cards and feature:other/x and decision:cards/why');
  assert.equal(decisionKey('shop', 'cards', 'why'), 'decision:shop/cards/why');
  assert.equal(decisionKey('shop', null, 'why'), 'decision:shop/why');
  assert.equal(decisionKey(null, null, 'why'), 'decision:/why');
});

test('source file names and canonical keys', () => {
  assert.equal(slugify('reports/pjman worth building analysis.md'), 'reports-pjman-worth-building-analysis-md');
  assert.equal(sourceFileSlug('linear', 'ABC-123'), 'abc-123');
  assert.match(sourceFileSlug('url', 'https://Example.com/'), /^u-[0-9a-f]{12}$/);
  assert.equal(sourceFileSlug('url', 'https://Example.com/'), sourceFileSlug('url', 'https://example.com'));
  assert.equal(canonicalSourceKey('Linear', 'ABC-123'), 'linear:ABC-123');
  assert.equal(canonicalSourceKey('url', 'https://Example.com/#frag'), 'url:https://example.com');
});
