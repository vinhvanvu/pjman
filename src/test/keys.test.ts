import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalSourceKey, parseDecisionRest, parseKey, slugify, sourceFileSlug } from '../keys.js';

test('keys split at the first colon', () => {
  assert.deepEqual(parseKey('url:https://x.y/z'), { kind: 'url', rest: 'https://x.y/z', raw: 'url:https://x.y/z' });
  assert.equal(parseKey('nokey'), null);
  assert.equal(parseKey(':x'), null);
  assert.equal(parseKey('a b:c'), null);
  assert.equal(parseKey(42), null);
});

test('decision keys: under a change or at store level', () => {
  assert.deepEqual(parseDecisionRest('schema/keys'), { changeSlug: 'schema', dslug: 'keys' });
  assert.deepEqual(parseDecisionRest('/keys'), { changeSlug: null, dslug: 'keys' });
  assert.equal(parseDecisionRest('keys'), null);
  assert.equal(parseDecisionRest('Bad Slug/x'), null);
});

test('source file names and canonical keys', () => {
  assert.equal(slugify('reports/pjman worth building analysis.md'), 'reports-pjman-worth-building-analysis-md');
  assert.equal(sourceFileSlug('linear', 'ABC-123'), 'abc-123');
  assert.match(sourceFileSlug('url', 'https://Example.com/'), /^u-[0-9a-f]{12}$/);
  assert.equal(sourceFileSlug('url', 'https://Example.com/'), sourceFileSlug('url', 'https://example.com'));
  assert.equal(canonicalSourceKey('Linear', 'ABC-123'), 'linear:ABC-123');
  assert.equal(canonicalSourceKey('url', 'https://Example.com/#frag'), 'url:https://example.com');
});
