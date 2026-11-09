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
import { change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-intake-'));
let store: Store;

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'shop');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ checkers: [], cwd: dir, name: 'shop' });
  store = findStore(dir)!;
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Saved cards for faster checkout', name: 'Saved cards', parent: 'feature:checkout' });
  newRecord(store, 'feature', 'search', { title: 'Search the catalogue', product: 'product:shop' });
  change(store, 'cards', { title: 'Cards milestone', summary: 'Everything cards.', status: 'planning', target: '2026-12-01', kind: 'milestone' });
  change(store, 'launch', { title: 'Launch milestone', summary: 'Out the door.', status: 'planning', kind: 'milestone' }); // no child yet
  change(store, 'card-form', { title: 'Card form', summary: 'Enter and save a card.', parent: 'change:cards', features: ['adds feature:saved-cards'], status: 'active', binds: ['github-issue:acme/shop#7'] });
  change(store, 'old-search', { title: 'Search by colour', summary: 'Colour facets.', features: ['feature:search'], status: 'done' });
  change(store, 'chore', { title: 'Upgrade the build', summary: 'Vite 7.' });
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
  assert.deepEqual(i.milestones.map((m) => [m.key, m.target]), [['change:shop/cards', '2026-12-01'], ['change:shop/launch', undefined]]); // by kind: a milestone with no child yet is one
  assert.deepEqual(i.tail, { product: 'product:shop', sequence: ['change:shop/cards'], later: 2 });
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
  assert.match(text, /2 open changes after it as later/);
  // nothing shared: empty sections say so
  const none = intake(store, loadStore(store), 'zebra');
  assert.deepEqual(none.duplicates, []);
  assert.match(formatIntake(none), /\(none: nothing open shares its words\)/);
});

test('intake on a product with no map says so, by what the repository holds, and the format opens with it', () => {
  const bare = path.join(tmp, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: bare });
  init({ checkers: [], cwd: bare, name: 'bare', adapter: false, start: false, map: true });
  const own = findStore(bare)!;
  const i = intake(own, loadStore(own), 'the dome does not close at dawn');
  assert.equal(i.map?.product, 'product:bare');
  assert.equal(i.map?.inventory?.holds, 'bare');
  assert.match(i.map?.prompt ?? '', /the map grows from the work/);
  assert.deepEqual(i.nodes, []);
  const text = formatIntake(i);
  assert.match(text, /^# intake — the dome does not close at dawn\n\n## No map yet \(the map comes with this change, in the same breath\)\nproduct:bare has no map yet; the repository holds nothing yet/);
  assert.match(text, /## Nodes[^\n]*\n\(none: the product has no map; see above\)/);
  // code lands: the same intake now says the map is proposed from the code's split with this change
  fs.mkdirSync(path.join(bare, 'src'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'src', 'dome.rs'), 'fn main() {}\n');
  const coded = intake(own, loadStore(own), 'the dome does not close at dawn');
  assert.equal(coded.map?.inventory?.holds, 'code');
  assert.match(coded.map?.prompt ?? '', /proposed from the code's split.*file it with no feature and propose the map in the same breath/);
  // the shop has a map: nothing about it, and an unmatched request is told to look for the feature it correlates to first
  const mapped = intake(store, loadStore(store), 'export the invoices as a spreadsheet');
  assert.equal(mapped.map, undefined);
  assert.match(formatIntake(mapped), /\(none: no feature shares its words; look at the tree for the feature it correlates to before creating a capability beneath it.*a bug that breaks a behaviour no node has creates the live node/);
});
