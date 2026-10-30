import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { aspectAt, parseAspectEffect } from '../aspects.js';
import { splitLine } from '../commands/apply.js';
import { init } from '../commands/init.js';
import { mv } from '../commands/mv.js';
import { newRecord } from '../commands/new.js';
import { rm } from '../commands/rm.js';
import { set } from '../commands/set.js';
import { changeContext, formatChangeContext, show } from '../commands/view.js';
import { findStore, type Store } from '../config.js';
import { loadStore, resolve } from '../records.js';
import { scope } from '../scope.js';
import { ancestorsOf } from '../tree.js';
import { validate } from '../validate.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-aspects-'));
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
const rec = (key: string) => {
  const r = resolve(loadStore(store), key);
  return r.status === 'ok' || r.status === 'alias' ? r.rec : undefined;
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: web });
  init({ checkers: [], cwd: web, name: 'web' });
  store = findStore(web)!;
  newRecord(store, 'product', 'shop', { title: 'Shop', summary: 'A shop.' });
  set(store, 'project:web', ['product=product:shop'], {});
  rm(store, 'product:web');
  newRecord(store, 'feature', 'app', { title: 'The app', product: 'product:shop' });
  newRecord(store, 'feature', 'cart', { title: 'The cart', parent: 'feature:shop/app' });
  newRecord(store, 'feature', 'cart-line', { title: 'A line in the cart', parent: 'feature:shop/cart' });
  newRecord(store, 'feature', 'search', { title: 'Search', parent: 'feature:shop/app' });
});

test('an aspect and its places: keyed under the product, bare and full keys resolve, the store validates', () => {
  newRecord(store, 'aspect', 'text', { title: 'Text reads at a glance', body: '## Length\n\nShort.\n\n## Formatting\n\nMarkdown, lists and code.' });
  newRecord(store, 'place', 'text/app', { feature: 'feature:app' });
  newRecord(store, 'place', 'text/cart', { feature: 'feature:cart', body: 'A line clamps to one row.' });
  newRecord(store, 'place', 'text/search', { feature: 'feature:search' });
  assert.deepEqual(errors(), []);
  assert.equal(rec('aspect:text')?.key, 'aspect:shop/text');
  assert.equal(rec('aspect:shop/text')?.type, 'aspect');
  assert.equal(rec('aspect:text/cart')?.key, 'aspect:shop/text/cart');
  assert.equal(rec('aspect:shop/text/cart')?.type, 'place');
  // the place's feature is stored as the full key
  assert.equal(rec('aspect:text/cart')?.data.feature, 'feature:shop/cart');
  assert.deepEqual(parseAspectEffect('adds aspect:text'), { effect: 'adds', key: 'aspect:text' });
  assert.equal(parseAspectEffect('adds feature:text'), null);
});

test('one place per feature; a place needs an aspect and a feature that exist', () => {
  assert.throws(() => newRecord(store, 'place', 'text/cart-again', { feature: 'feature:cart' }), /one place per feature/);
  assert.throws(() => newRecord(store, 'place', 'nothing/cart', { feature: 'feature:cart' }), /does not exist/);
  assert.throws(() => newRecord(store, 'place', 'text/ghost', { feature: 'feature:ghost' }), /does not resolve/);
  assert.throws(() => newRecord(store, 'place', 'text/no-feature', {}), /--feature is required/);
  assert.deepEqual(errors(), []);
});

test('a place is read as the base, then the forks above it, then its own; a feature with no place of its own inherits', () => {
  newRecord(store, 'place', 'text/cart-line', { feature: 'feature:cart-line', body: 'No line breaks.' });
  const loaded = loadStore(store);
  const text = loaded.byKey.get('aspect:shop/text')![0];
  const at = aspectAt(loaded, text, loaded.byKey.get('feature:shop/cart-line')![0])!;
  assert.equal(at.place, 'aspect:shop/text/cart-line');
  assert.deepEqual(at.layers.map((l) => l.from), ['aspect:shop/text', 'aspect:shop/text/cart', 'aspect:shop/text/cart-line']);
  // the app's place has no fork: it adds no layer
  const atCart = aspectAt(loaded, text, loaded.byKey.get('feature:shop/cart')![0])!;
  assert.deepEqual(atCart.layers.map((l) => l.from), ['aspect:shop/text', 'aspect:shop/text/cart']);
  // the base is never copied: a place reads it from the aspect
  assert.ok(!loaded.byKey.get('aspect:shop/text/cart')![0].body.includes('Short.'));
});

test("a change's context: the aspect read at a feature it names in full, places beneath a broad feature one line each, a named aspect whole", () => {
  newRecord(store, 'change', 'cart-copy', { title: 'Cart copy', summary: 's', features: ['changes feature:cart-line'] });
  const at = changeContext(store, 'change:cart-copy');
  assert.deepEqual(at.aspects?.at.map((x) => x.place), ['aspect:shop/text/cart-line']);
  const text = formatChangeContext(at);
  assert.match(text, /## Aspects/);
  assert.match(text, /Short\./);
  assert.match(text, /No line breaks\./);

  newRecord(store, 'change', 'app-wide', { title: 'App wide', summary: 's', features: ['changes feature:app'] });
  const wide = changeContext(store, 'change:app-wide');
  assert.deepEqual(wide.aspects?.at.map((x) => x.place), ['aspect:shop/text/app']);
  assert.deepEqual(wide.aspects?.beneath.map((b) => b.place), ['aspect:shop/text/cart', 'aspect:shop/text/cart-line', 'aspect:shop/text/search']);

  newRecord(store, 'change', 'text-base', { title: 'The text base', summary: 's', aspects: ['changes aspect:text'] });
  const named = changeContext(store, 'change:text-base');
  assert.equal(named.aspects?.named[0].aspect, 'aspect:shop/text');
  assert.equal(named.aspects?.named[0].places.length, 4);
  assert.match(formatChangeContext(named), /A line clamps to one row\./);
  // the aspect it names is above it, as a feature is above a change that names it
  assert.ok(ancestorsOf(loadStore(store), 'change:shop/text-base').includes('aspect:shop/text'));

  newRecord(store, 'change', 'no-feature', { title: 'Nothing named', summary: 's' });
  assert.equal(changeContext(store, 'change:no-feature').aspects, undefined);
  assert.deepEqual(errors(), []);
});

test("writing a base lists every place it reaches with each fork; a place's show reads it there", () => {
  const r = set(store, 'aspect:text', ['body=## Length\n\nShorter.'], {});
  assert.ok(r.notes.some((n) => /reaches 4 places/.test(n)));
  assert.ok(r.notes.some((n) => /aspect:shop\/text\/cart at feature:shop\/cart \(forked\)/.test(n)));
  assert.ok(r.notes.some((n) => /\| A line clamps to one row\./.test(n)));
  set(store, 'aspect:text/cart', ['body=A line clamps to two rows.'], {});
  const shown = show(store, 'aspect:text/cart').text;
  assert.match(shown, /## Read here/);
  assert.match(shown, /Shorter\./);
  assert.match(shown, /two rows/);
});

test("the dashboard's scope carries the product's aspects whole, and at a feature each aspect read there", () => {
  const product = scope(store, loadStore(store), { node: 'product:shop' });
  const text = product.aspects.find((a) => a.aspect === 'aspect:shop/text');
  assert.ok(text);
  const cartPlace = text.places.find((p) => p.place === 'aspect:shop/text/cart');
  assert.equal(cartPlace?.feature, 'feature:shop/cart');
  assert.equal(cartPlace?.forked, true);
  assert.ok(cartPlace?.fork);
  assert.equal(text.places.find((p) => p.place === 'aspect:shop/text/app')?.forked, false);
  assert.deepEqual(product.aspectsHere, []);
  // at the cart: its own place, read as the base then the cart's fork
  const cart = scope(store, loadStore(store), { node: 'feature:shop/cart' });
  const here = cart.aspectsHere.find((x) => x.aspect === 'aspect:shop/text');
  assert.equal(here?.place, 'aspect:shop/text/cart');
  assert.deepEqual(here?.layers.map((l) => l.from), ['aspect:shop/text', 'aspect:shop/text/cart']);
});

test('a change row carries the aspects and places it names, as live keys: the roadmap narrows by them', () => {
  newRecord(store, 'change', 'cart-wording', { title: 'Cart wording', summary: 's', aspects: ['changes aspect:text/cart'] });
  const rows = scope(store, loadStore(store), { node: 'product:shop' }).changes;
  assert.deepEqual(rows.find((r) => r.key === 'change:shop/text-base')?.aspects, ['aspect:shop/text']);
  assert.deepEqual(rows.find((r) => r.key === 'change:shop/cart-wording')?.aspects, ['aspect:shop/text/cart']);
  assert.deepEqual(rows.find((r) => r.key === 'change:shop/app-wide')?.aspects, []);
});

test("a change naming a place is filed at the place's feature by the dashboard, never counted toward it", () => {
  const atCart = scope(store, loadStore(store), { node: 'feature:shop/cart', lens: 'roadmap' });
  const row = atCart.changes.find((r) => r.key === 'change:shop/cart-wording');
  assert.ok(row, "on the feature's roadmap");
  assert.deepEqual(row.features, [{ effect: 'changes', key: 'feature:shop/cart', title: rec('feature:cart')?.data.title, viaPlace: true }]);
  assert.ok(atCart.tree.some((n) => n.key === 'change:shop/cart-wording'), 'in its tree, so in its lane');
  // the store's ancestry is untouched: the feature's own counts leave it out
  const product = scope(store, loadStore(store), { node: 'product:shop' });
  const find = (list: typeof product.tree, key: string): (typeof product.tree)[number] | undefined =>
    list.map((n) => (n.key === key ? n : find(n.children, key))).find((n) => n);
  const cart = find(product.tree, 'feature:shop/cart');
  assert.ok(cart?.children.some((n) => n.key === 'change:shop/cart-wording'), 'under the feature on the map');
  assert.equal(cart?.open, scope(store, loadStore(store), { node: 'feature:shop/cart' }).changes.filter((r) => !r.features.every((f) => f.viaPlace)).length);
});

test('a feature with a place is not removed from under it; a moved feature takes its places along; an aspect removed takes its places', () => {
  assert.throws(() => rm(store, 'feature:search'), /referenced by[\s\S]*aspect:shop\/text\/search/);
  mv(store, 'feature:search', 'feature:find', {});
  assert.equal(rec('aspect:text/search')?.data.feature, 'feature:shop/find');
  assert.deepEqual(errors(), []);
  newRecord(store, 'aspect', 'motion', { title: 'Motion' });
  newRecord(store, 'place', 'motion/cart', { feature: 'feature:cart' });
  rm(store, 'aspect:motion');
  assert.equal(rec('aspect:motion'), undefined);
  assert.equal(rec('aspect:motion/cart'), undefined);
  assert.deepEqual(errors(), []);
});

test('a batch line carries a multi-line text: \\n inside double quotes is a line break', () => {
  assert.deepEqual(splitLine('set aspect:text "body=## Length\\n\\nShort."'), ['set', 'aspect:text', 'body=## Length\n\nShort.']);
  assert.deepEqual(splitLine('set x "a\\"b"'), ['set', 'x', 'a"b']);
});
