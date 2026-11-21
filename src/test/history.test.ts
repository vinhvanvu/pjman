// pjman history (change:branch-sources): what came before on a node and on each parent up the map, indexed by node
// with the nearest first; one node alone with --node; a change stands for the nodes it names. An index
// (aspect:index-then-getter): the counts and the changes by default, the other kinds when asked for, narrowed by words.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { formatHistory, history, HISTORY_KINDS } from '../model/history.js';
import { newRecord } from '../ops/new.js';
import { findStore, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { change, decisionRec } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-history-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'shop');
process.env.PJMAN_HOME = home;
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const bin = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'bin', 'pjman.js');
const pj = (args: string[]) => {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: project, env: process.env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
let store: Store;
const ALL = [...HISTORY_KINDS];

before(() => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  init({ cwd: project, name: 'shop' });
  store = findStore(project)!;
  // checkout > saved-cards > card-scan, and search beside checkout
  newRecord(store, 'feature', 'checkout', { title: 'People pay', name: 'Checkout', product: 'product:shop' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Pay with a saved card', parent: 'feature:shop/checkout' });
  newRecord(store, 'feature', 'card-scan', { title: 'Scan a card', parent: 'feature:shop/saved-cards' });
  newRecord(store, 'feature', 'search', { title: 'Search', product: 'product:shop' });
  change(store, 'pay-button', {
    title: 'The pay button',
    features: ['adds feature:shop/checkout'],
    // what records a run is no source of the product's history
    links: ['file:src/pay.ts', 'entire-checkpoint:abc123'],
    created: '2026-01-01',
  });
  change(store, 'card-form', {
    title: 'The card form',
    features: ['adds feature:shop/saved-cards'],
    links: ['file:src/card.ts', 'url:https://example.com/spec'],
    created: '2026-02-01',
  });
  change(store, 'card-endpoint', {
    title: 'The card endpoint',
    features: ['feature:shop/saved-cards'],
    links: ['file:src/card.ts'],
    created: '2026-03-01',
  });
  change(store, 'scan', { title: 'Scanning', features: ['adds feature:shop/card-scan', 'feature:shop/search'] });
  change(store, 'find', { title: 'Finding', features: ['adds feature:shop/search'] });
  // filed the same day as find, after it
  change(store, 'a-second-find', { title: 'Finding again', features: ['feature:shop/search'] });
  change(store, 'chore', { title: 'A chore' });
  decisionRec(store, 'card-form/vault', { title: 'Where cards are kept', decidedBy: 'person:tester' });
  decisionRec(store, 'pay-button/colour', { title: 'The colour' });
});

test('a branch: the node and each parent, nearest first, the changes naming each node itself, newest first', () => {
  const h = history(loadStore(store), 'feature:shop/card-scan', { kinds: ALL });
  assert.equal(h.reach, 'branch');
  assert.deepEqual(
    h.nodes.map((n) => n.key),
    ['feature:shop/card-scan', 'feature:shop/saved-cards', 'feature:shop/checkout'],
  );
  assert.deepEqual(
    h.nodes.map((n) => n.changes.map((c) => c.key)),
    [['change:shop/scan'], ['change:shop/card-endpoint', 'change:shop/card-form'], ['change:shop/pay-button']],
  );
  const form = h.nodes[1].changes[1];
  assert.equal(form.effect, 'adds');
  assert.deepEqual(
    form.decisions!.map((d) => `${d.key} ${d.status}`),
    ['decision:shop/card-form/vault decided'],
  );
  assert.deepEqual(
    form.sources!.map((s) => `${s.relation} ${s.key}`),
    ['links file:src/card.ts', 'links url:https://example.com/spec'],
  );
  // a proposed decision is listed with its status: every status is read
  assert.equal(h.nodes[2].changes[0].decisions![0].status, 'proposed');
  // a sibling and what is beneath a node are no part of its branch
  const up = history(loadStore(store), 'feature:shop/saved-cards');
  assert.deepEqual(
    up.nodes.map((n) => n.key),
    ['feature:shop/saved-cards', 'feature:shop/checkout'],
  );
  assert.ok(!up.nodes.some((n) => n.changes.some((c) => c.key === 'change:shop/scan')));
});

test('a node alone; the changes unless another kind is asked for, with everything on the node counted', () => {
  const loaded = loadStore(store);
  const one = history(loaded, 'feature:shop/saved-cards', { node: true });
  assert.equal(one.reach, 'node');
  assert.deepEqual(
    one.nodes.map((n) => n.key),
    ['feature:shop/saved-cards'],
  );
  const changes = history(loaded, 'feature:shop/saved-cards', { node: true });
  assert.deepEqual(changes.kinds, ['changes']);
  assert.deepEqual(changes.nodes[0].counts, { changes: 2, decisions: 1, sources: 2 });
  assert.ok(changes.nodes[0].changes.every((c) => c.decisions === undefined && c.sources === undefined));
  const text = formatHistory(changes);
  assert.match(text, /^# history of feature:shop\/saved-cards — the node alone$/m);
  // what was not asked for is counted, with the flag that prints it; the getter for depth is named
  assert.match(text, /^2 changes, 1 decision \(--decisions\), 2 sources \(--sources\)$/m);
  assert.match(text, /^the depth of one: pjman context <change> · pjman show <decision>$/m);
  assert.match(text, /^- change:shop\/card-form \[open\] 2026-02-01 adds — The card form$/m);
  assert.doesNotMatch(text, /decision:|file:/);
  // without the changes a kind is a flat list: a source once, with every change that names it
  const sources = formatHistory(history(loaded, 'feature:shop/saved-cards', { node: true, kinds: ['sources'] }));
  assert.match(sources, /^2 changes \(--changes\), 1 decision \(--decisions\), 2 sources$/m);
  assert.match(sources, /^- file:src\/card\.ts · links change:shop\/card-endpoint, links change:shop\/card-form$/m);
  assert.doesNotMatch(sources, /^- change:/m);
  const decisions = formatHistory(history(loaded, 'feature:shop/card-scan', { kinds: ['decisions'] }));
  assert.match(decisions, /^- decision:shop\/card-form\/vault \[decided\] — /m);
  assert.match(decisions, /^- decision:shop\/pay-button\/colour \[proposed\] — /m);
});

test('a change stands for the nodes it names, each branch once, and is left out of its own history', () => {
  const loaded = loadStore(store);
  const h = history(loaded, 'change:shop/scan');
  assert.deepEqual(
    h.nodes.map((n) => n.key),
    ['feature:shop/card-scan', 'feature:shop/search', 'feature:shop/saved-cards', 'feature:shop/checkout'],
  );
  assert.deepEqual(h.nodes[0].changes, []);
  // within a day, the one filed later comes first, whatever its slug
  assert.deepEqual(
    h.nodes[1].changes.map((c) => c.key),
    ['change:shop/a-second-find', 'change:shop/find'],
  );
  assert.match(formatHistory(h), /^## feature:shop\/card-scan .*\nno other change names it$/m);
  assert.equal(history(loaded, 'change:shop/scan', { node: true }).nodes.length, 2);
  // a change that names no node has no history to read, and says so
  const none = history(loaded, 'change:shop/chore');
  assert.deepEqual(none.nodes, []);
  assert.match(formatHistory(none), /names no node on the map/);
  // only a change or a node is read
  assert.throws(
    () => history(loaded, 'product:shop'),
    /reads a change or a node of the map; product:shop is a product/,
  );
});

test('words narrow every kind asked for: a change that carries them keeps what is beneath it, another is shown for what does', () => {
  const loaded = loadStore(store);
  // the change's own words: its decision and sources come with it
  let h = history(loaded, 'feature:shop/card-scan', { kinds: ALL, match: 'card FORM' });
  assert.equal(h.match, 'card form');
  assert.deepEqual(
    h.nodes.map((n) => n.changes.map((c) => c.key)),
    [[], ['change:shop/card-form'], []],
  );
  assert.equal(h.nodes[1].changes[0].decisions!.length, 1);
  assert.equal(h.nodes[1].changes[0].sources!.length, 2);
  // the counts stay the node's own, whatever matched
  assert.deepEqual(h.nodes[1].counts, { changes: 2, decisions: 1, sources: 2 });
  const text = formatHistory(h);
  assert.match(text, /^# history of feature:shop\/card-scan — 3 nodes, nearest first, matching "card form"$/m);
  assert.match(text, /^## feature:shop\/checkout .*\n1 change, 1 decision, 1 source\nnothing here matches$/m);
  // words only a source carries: its change is shown for it, with that source alone
  h = history(loaded, 'feature:shop/saved-cards', { node: true, kinds: ALL, match: 'spec' });
  assert.deepEqual(
    h.nodes[0].changes.map((c) => [c.key, c.decisions!.length, c.sources!.map((s) => s.key)]),
    [['change:shop/card-form', 0, ['url:https://example.com/spec']]],
  );
  // without the changes, a change that carries the words still brings what was asked for beneath it, and is no more
  // than the key they sit under; one with nothing asked for beneath it is not carried at all
  h = history(loaded, 'feature:shop/card-scan', { kinds: ['decisions'], match: 'card form' });
  assert.deepEqual(h.nodes[1].changes, [
    {
      key: 'change:shop/card-form',
      decisions: [
        {
          key: 'decision:shop/card-form/vault',
          name: 'Where cards are kept',
          gist: 'Where cards are kept',
          status: 'decided',
        },
      ],
    },
  ]);
  assert.deepEqual(
    history(loaded, 'feature:shop/saved-cards', { node: true, kinds: ['decisions'] }).nodes[0].changes.map(
      (c) => c.key,
    ),
    ['change:shop/card-form'],
  );
  // a kind not asked for is not searched
  assert.deepEqual(history(loaded, 'feature:shop/saved-cards', { node: true, match: 'spec' }).nodes[0].changes, []);
});

test('the command: a slug or a key in, text or JSON out, the kinds and the words as flags', () => {
  let r = pj(['history', 'card-scan']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^# history of feature:card-scan — 3 nodes, nearest first$/m);
  assert.match(
    r.out,
    /^## feature:checkout \(feature\) — Checkout: People pay\n1 change, 1 decision \(--decisions\), 1 source \(--sources\)$/m,
  );
  assert.doesNotMatch(r.out, /decision:|file:/);
  r = pj(['history', 'card-scan', '--all']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^## feature:checkout \(feature\) — Checkout: People pay\n1 change, 1 decision, 1 source$/m);
  assert.match(r.out, /^ {2}- decision:pay-button\/colour \[proposed\] — /m);
  assert.match(r.out, /^ {2}- links file:src\/pay\.ts$/m);
  r = pj(['history', 'change:card-form', '--node', '--changes', '--sources', '--json']);
  assert.equal(r.code, 0, r.err);
  const h = JSON.parse(r.out);
  assert.equal(h.of, 'change:shop/card-form');
  assert.deepEqual(h.kinds, ['changes', 'sources']);
  assert.deepEqual(
    h.nodes.map((n: { key: string }) => n.key),
    ['feature:shop/saved-cards'],
  );
  assert.deepEqual(
    h.nodes[0].changes.map((c: { key: string }) => c.key),
    ['change:shop/card-endpoint'],
  );
  assert.equal(h.nodes[0].changes[0].decisions, undefined);
  r = pj(['history', 'card-scan', '--match', 'pay button', '--json']);
  assert.deepEqual(
    JSON.parse(r.out).nodes.flatMap((n: { changes: { key: string }[] }) => n.changes.map((c) => c.key)),
    ['change:shop/pay-button'],
  );
  assert.equal(pj(['history']).code, 2);
  r = pj(['history', 'product:shop']);
  assert.equal(r.code, 1);
  assert.match(r.err, /reads a change or a node of the map/);
  assert.equal(pj(['history', 'nothing-here']).code, 1);
});
