import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../commands/init.js';
import { newRecord } from '../commands/new.js';
import { set } from '../commands/set.js';
import { findStore, type Store } from '../config.js';
import { formatIntake, intake, words } from '../intake.js';
import { loadStore } from '../records.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-intake-'));
let store: Store;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'shop');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'shop' });
  store = findStore(dir)!;
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Saved cards for faster checkout', name: 'Saved cards', parent: 'feature:checkout' });
  newRecord(store, 'feature', 'search', { title: 'Search the catalogue', product: 'product:shop' });
  newRecord(store, 'change', 'cards', { title: 'Cards milestone', summary: 'Everything cards.', status: 'planning', target: '2026-12-01' });
  newRecord(store, 'change', 'card-form', { title: 'Card form', summary: 'Enter and save a card.', parent: 'change:cards', features: ['adds feature:saved-cards'], status: 'active', binds: ['github-issue:acme/shop#7'] });
  newRecord(store, 'change', 'old-search', { title: 'Search by colour', summary: 'Colour facets.', features: ['feature:search'], status: 'done' });
  newRecord(store, 'change', 'chore', { title: 'Upgrade the build', summary: 'Vite 7.' });
  set(store, 'product:shop', ['sequence=change:cards'], {});
});

test('words: meaning only, stemmed', () => {
  assert.deepEqual(words('Saving a card crashes the checkout page'), ['sav', 'card', 'crash', 'checkout', 'page']);
  assert.deepEqual(words('fix the bug'), []);
});

test('intake: duplicates by words and by reference, done ones apart, nodes with their path, milestones, the tail', () => {
  const i = intake(store, loadStore(store), 'Saving a card from the form fails');
  assert.deepEqual(i.duplicates.map((d) => d.key), ['change:shop/card-form']);
  assert.ok(i.duplicates[0].score > 0.3);
  assert.deepEqual(i.duplicates[0].features, ['feature:shop/saved-cards']);
  assert.equal(i.duplicates[0].parent, 'change:shop/cards');
  assert.deepEqual(i.nodes.map((n) => n.key), ['feature:shop/saved-cards']);
  assert.deepEqual(i.nodes[0].path, ['product:shop', 'feature:shop/checkout']);
  assert.equal(i.nodes[0].level, 'capability');
  assert.deepEqual(i.milestones.map((m) => [m.key, m.target]), [['change:shop/cards', '2026-12-01']]);
  assert.deepEqual(i.tail, { product: 'product:shop', sequence: ['change:shop/cards'], later: 1 });
  // a ticket named in the request is the duplicate, whatever the words
  const r = intake(store, loadStore(store), 'look at acme/shop#7 again');
  assert.equal(r.duplicates[0]?.key, 'change:shop/card-form');
  assert.equal(r.duplicates[0]?.referenced, true);
  assert.equal(r.duplicates[0]?.score, 1);
  // a done change that covered the same words is reported apart
  const d = intake(store, loadStore(store), 'search by colour is broken again');
  assert.deepEqual(d.duplicates, []);
  assert.deepEqual(d.done.map((c) => c.key), ['change:shop/old-search']);
  assert.deepEqual(d.nodes.map((n) => n.key), ['feature:shop/search']);
  const text = formatIntake(i);
  assert.match(text, /## Duplicates[\s\S]*change:shop\/card-form \[active\]/);
  assert.match(text, /feature:shop\/saved-cards \(capability, building\)/);
  assert.match(text, /1 open change after it as later/);
  // nothing shared: empty sections say so
  const none = intake(store, loadStore(store), 'zebra');
  assert.deepEqual(none.duplicates, []);
  assert.match(formatIntake(none), /\(none: nothing open shares its words\)/);
});
