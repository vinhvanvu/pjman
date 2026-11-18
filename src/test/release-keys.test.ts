// The changelog credits a commit to the changes its message names as the trailer's own items (scripts/release-keys.mjs):
// a key the words merely mention credits nothing.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = pathToFileURL(path.resolve(here, '..', '..', 'scripts', 'release-keys.mjs')).href;

test('a commit is credited to the changes its trailer lists, never to one its words mention', async () => {
  const { keysOf } = (await import(mod)) as { keysOf: (subject: string, body?: string) => string[] };
  assert.deepEqual(keysOf('feat: the cart totals (change:cart)'), ['cart']);
  assert.deepEqual(keysOf('feat: both (change:a, change:web/b)'), ['a', 'b']);
  assert.deepEqual(keysOf('feat: rounds (decision cart/rounding; change:cart)'), ['cart']);
  assert.deepEqual(keysOf('feat: squashed (change:cart) (#12)'), ['cart']);
  assert.deepEqual(keysOf('docs: one word (decision one-word under change:cart)'), ['cart']);
  // mentioned, not listed
  assert.deepEqual(keysOf('fix: the total (as change:fees did; change:cart)'), ['cart']);
  assert.deepEqual(keysOf('docs: a note (see change:cart for the rest)'), []);
  assert.deepEqual(keysOf("Merge branch 'cart'"), ['cart']);
  assert.deepEqual(keysOf('Merge pull request #9 from acme/cart'), ['cart']);
  assert.deepEqual(keysOf('The cart', '* feat: one (change:cart)\n* docs: two (follows change:fees)'), ['cart']);
});
