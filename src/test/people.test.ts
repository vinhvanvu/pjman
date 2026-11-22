// People (change:people-in-graph): a person record heads their accounts and holds their role and typed ties; person
// intake finds a mention before creating one (decision people-in-graph/person-intake); a stake on a map node is
// inherited beneath it, the nearest node naming a stake winning it; what is set outright overrides what was said
// (decision people-in-graph/ownership-from); a synced ticket's accounts reach their person; a change names its POCs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, loadStoreConfig, type Store } from '../store/config.js';
import { newRecord } from '../ops/new.js';
import { set } from '../ops/set.js';
import { rm } from '../ops/rm.js';
import { personIntake, tie } from '../ops/people.js';
import { decision } from '../ops/decision.js';
import { findPerson, formatPerson, peopleOn, personAt, personView, pocsOf } from '../model/people.js';
import { get } from '../model/graph.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { validate } from '../model/validate.js';
import { loadStore } from '../store/records.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-people-'));
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
const rec = (key: string) => loadStore(store).byKey.get(key)![0];

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  newRecord(store, 'product', 'shop', { title: 'The shop' });
  set(store, 'project:web', ['product=product:shop'], {});
  rm(store, 'product:web');
  newRecord(store, 'feature', 'checkout', {
    title: 'Paying for the cart',
    product: 'product:shop',
  });
  newRecord(store, 'feature', 'tax', {
    title: 'Tax on the total',
    parent: 'feature:shop/checkout',
  });
  newRecord(store, 'feature', 'search', {
    title: 'Finding a product',
    product: 'product:shop',
  });
  change(store, 'round-tax', {
    title: 'Round the tax up',
    summary: 's',
    project: 'project:web',
    features: ['changes feature:shop/tax'],
  });
});

test('person intake creates a person once, then finds them by handle, full name, alias or account', () => {
  const made = personIntake(store, 'Sam Lee', {
    role: 'designer',
    accounts: ['github-user:samlee'],
    aliases: ['sammy'],
  });
  assert.equal(made.status, 'created');
  assert.equal(made.key, 'person:sam-lee');
  assert.equal(rec('person:sam-lee').data.role, 'designer');
  for (const m of ['Sam Lee', 'sam lee', 'person:sam-lee', 'sammy', 'github-user:samlee']) {
    const r = personIntake(store, m);
    assert.equal(r.status, 'found', m);
    assert.equal(r.key, 'person:sam-lee', m);
    assert.equal(r.commit, null, `${m}: nothing new, nothing written`);
  }
  const more = personIntake(store, 'Sam Lee', {
    accounts: ['email:Sam@Example.com'],
  });
  assert.deepEqual(more.added, ['email:sam@example.com']);
  assert.deepEqual(rec('person:sam-lee').data.links, ['github-user:samlee', 'email:sam@example.com']);
  assert.equal(errors().length, 0);
});

test('a first name alone only offers candidates, and --new makes someone else; nothing is merged on a name', () => {
  const one = personIntake(store, 'Sam');
  assert.equal(one.status, 'candidates');
  assert.deepEqual(
    one.candidates.map((c) => c.key),
    ['person:sam-lee'],
  );
  assert.equal(one.commit, null);
  const other = personIntake(store, 'Sam Park', {
    new: true,
    role: 'engineer',
  });
  assert.equal(other.status, 'created');
  assert.equal(personIntake(store, 'Sam').candidates.length, 2);
});

test('an account and a name that point at different people are a conflict, and nothing is written', () => {
  const r = personIntake(store, 'Sam Park', {
    accounts: ['github-user:samlee'],
  });
  assert.equal(r.status, 'conflict');
  assert.equal(r.commit, null);
  assert.equal(rec('person:sam-park').data.links, undefined);
});

test('a role, a stake or a part new to the store is added to its words on first use', () => {
  personIntake(store, 'Priya Rao', { role: 'qa' });
  assert.deepEqual(loadStoreConfig(store.root).roles, ['qa']);
  const t = tie(store, 'priya-rao', 'approver', 'change:shop/round-tax');
  assert.match(t.notes.join(' '), /added 'approver' to the store's parts/);
  assert.deepEqual(loadStoreConfig(store.root).parts, ['approver']);
  assert.equal(errors().length, 0);
});

test('a stake is inherited beneath its node, the nearest node naming a stake winning it', () => {
  tie(store, 'sam-lee', 'owner', 'feature:shop/checkout');
  tie(store, 'priya-rao', 'stakeholder', 'product:shop');
  const loaded = loadStore(store);
  const on = peopleOn(loaded, 'feature:shop/tax');
  assert.deepEqual(
    on.map((o) => [o.type, o.who, o.from]),
    [
      ['owner', 'person:sam-lee', 'feature:shop/checkout'],
      ['stakeholder', 'person:priya-rao', 'product:shop'],
    ],
  );
  tie(store, 'sam-park', 'owner', 'feature:shop/tax');
  const near = peopleOn(loadStore(store), 'feature:shop/tax');
  assert.deepEqual(
    near.filter((o) => o.type === 'owner').map((o) => o.who),
    ['person:sam-park'],
  );
  assert.equal(errors().length, 0);
});

test('what is set outright overrides what was said; what is said where it is set changes nothing; --remove takes it back', () => {
  tie(store, 'priya-rao', 'owner', 'feature:shop/search', { said: true });
  let on = peopleOn(loadStore(store), 'feature:shop/search');
  assert.deepEqual(
    on.filter((o) => o.type === 'owner').map((o) => [o.who, o.via]),
    [['person:priya-rao', 'said']],
  );
  // another person set outright: their word is the answer, what was said of the same stake gives way
  tie(store, 'sam-lee', 'owner', 'feature:shop/search');
  on = peopleOn(loadStore(store), 'feature:shop/search');
  assert.deepEqual(
    on.filter((o) => o.type === 'owner').map((o) => [o.who, o.via]),
    [['person:sam-lee', 'tie']],
  );
  // the same person set outright: the said tie is replaced in the record
  const r = tie(store, 'priya-rao', 'owner', 'feature:shop/search');
  assert.match(r.notes.join(' '), /replaces what was said/);
  assert.equal(rec('person:priya-rao').data.said, undefined);
  assert.equal(tie(store, 'priya-rao', 'owner', 'feature:shop/search', { said: true }).op, 'unchanged');
  assert.equal(tie(store, 'priya-rao', 'owner', 'feature:shop/search', { remove: true }).op, 'removed');
  assert.equal(tie(store, 'sam-lee', 'owner', 'feature:shop/search', { remove: true }).op, 'removed');
  assert.equal(peopleOn(loadStore(store), 'feature:shop/search').filter((o) => o.type === 'owner').length, 0);
});

test('a tie reaches anything: a part on a source with no record; the graph carries it as a typed edge', () => {
  tie(store, 'sam-lee', 'author', 'url:https://example.com/design-doc');
  const loaded = loadStore(store);
  const n = get(loaded, 'url:https://example.com/design-doc');
  assert.ok(n.in.some((e) => e.edge === 'author' && e.from === 'person:sam-lee'));
  assert.deepEqual(
    n.people.map((o) => [o.type, o.who]),
    [['author', 'person:sam-lee']],
  );
  const me = get(loaded, 'person:sam-lee');
  assert.ok(me.out.some((e) => e.edge === 'owner' && e.to === 'feature:shop/checkout'));
  assert.ok(me.out.some((e) => e.edge === 'links' && e.to === 'github-user:samlee'));
  assert.equal(errors().length, 0);
});

test("a synced ticket's accounts reach their person; an account no person claims shows as itself", () => {
  newRecord(store, 'source', 'github-issue:acme/web#3', {
    title: 'Tax rounds down',
  });
  // the observed fields, as the sync writes them under ext.github
  fs.writeFileSync(
    rec('github-issue:acme/web#3').abs,
    `---\nkind: github-issue\nkey: "acme/web#3"\ntitle: Tax rounds down\next:\n  github:\n    assignees:\n      - samlee\n      - stranger\n    author: samlee\n---\n`,
  );
  const loaded = loadStore(store);
  const on = peopleOn(loaded, 'github-issue:acme/web#3');
  assert.deepEqual(
    on.map((o) => [o.type, o.who, o.account]),
    [
      ['assignee', 'person:sam-lee', 'github-user:samlee'],
      ['assignee', 'github-user:stranger', 'github-user:stranger'],
      ['author', 'person:sam-lee', 'github-user:samlee'],
    ],
  );
  assert.deepEqual(
    personView(loaded, rec('person:sam-lee')).through.map((a) => `${a.type} ${a.source}`),
    ['assignee github-issue:acme/web#3', 'author github-issue:acme/web#3'],
  );
});

test('a change names who to reference: the stakes on the nodes it names, inherited, and the people tied to it', () => {
  const loaded = loadStore(store);
  const pocs = pocsOf(loaded, 'change:shop/round-tax');
  assert.deepEqual(
    pocs.map((p) => [p.type, p.who, p.on.join(',')]),
    [
      ['owner', 'person:sam-park', 'feature:shop/tax'],
      ['stakeholder', 'person:priya-rao', 'product:shop'],
      ['approver', 'person:priya-rao', 'change:shop/round-tax'],
    ],
  );
  const text = formatChangeContext(changeContext(store, 'change:shop/round-tax', loaded));
  assert.match(text, /## People\n\n- owner: person:sam-park \(Sam Park, engineer\) · on feature:shop\/tax/);
});

test('validate refuses a tie of a word the store lacks, and a stake word off the map', () => {
  personIntake(store, 'Bad Ties');
  const p = rec('person:bad-ties');
  const before = fs.readFileSync(p.abs, 'utf8');
  fs.writeFileSync(
    p.abs,
    before.replace(
      'kind: person',
      'kind: person\nties:\n  - overlord feature:shop/tax\n  - owner change:shop/round-tax',
    ),
  );
  const msgs = errors()
    .filter((e) => e.path === p.path)
    .map((e) => e.message)
    .join('\n');
  assert.match(msgs, /'overlord' is not one of the store's stakes/);
  assert.match(msgs, /'owner' is not one of the store's parts/);
  fs.writeFileSync(p.abs, before);
});

test("the graph's tie edges are the ties as they stand: a said tie another person's outright one shadows is no edge", () => {
  tie(store, 'priya-rao', 'owner', 'feature:shop/search', { said: true });
  tie(store, 'sam-park', 'owner', 'feature:shop/search');
  const n = get(loadStore(store), 'feature:shop/search');
  assert.deepEqual(
    n.in.filter((e) => e.edge === 'owner').map((e) => e.from),
    ['person:sam-park'],
  );
});

test('a key reads as a person only when it is the person or an account they hold, never a source they link', () => {
  set(store, 'person:sam-lee', ['links+=url:https://example.com/portfolio'], {});
  const loaded = loadStore(store);
  assert.equal(personAt(loaded, 'github-user:samlee')?.key, 'person:sam-lee');
  assert.equal(personAt(loaded, 'person:sam-lee')?.key, 'person:sam-lee');
  assert.equal(personAt(loaded, 'url:https://example.com/portfolio'), undefined);
});

test('a handle or alias beside others whose name holds the word offers candidates; a full name is the person', () => {
  personIntake(store, 'Alice');
  personIntake(store, 'Alice Jones', { new: true });
  const loaded = loadStore(store);
  const r = findPerson(loaded, 'alice');
  assert.equal(r.status, 'candidates');
  assert.deepEqual(r.candidates.map((c) => c.key).toSorted(), ['person:alice', 'person:alice-jones']);
  assert.equal(findPerson(loaded, 'Alice Jones').match?.key, 'person:alice-jones');
  assert.equal(findPerson(loaded, 'person:alice').match?.key, 'person:alice');
});

test("a change that names no node is the product's: its stakes are the ones to reference; a bound ticket's people join", () => {
  change(store, 'bare', { title: 'No node named', summary: 's', project: 'project:web' });
  set(store, 'change:shop/bare', ['binds+=github-issue:acme/web#3'], {});
  const seen = pocsOf(loadStore(store), 'change:shop/bare').map((p) => `${p.type} ${p.who} ${p.on.join(',')}`);
  for (const want of [
    'stakeholder person:priya-rao product:shop',
    'assignee person:sam-lee github-issue:acme/web#3',
    'author person:sam-lee github-issue:acme/web#3',
    'assignee github-user:stranger github-issue:acme/web#3',
  ])
    assert.ok(seen.includes(want), `${want} in\n${seen.join('\n')}`);
});

test('get on a person lists the sources that name their accounts', () => {
  const n = get(loadStore(store), 'person:sam-lee');
  assert.deepEqual(
    n.through.map((a) => `${a.type} ${a.source}`),
    ['assignee github-issue:acme/web#3', 'author github-issue:acme/web#3'],
  );
});

test("a refused intake puts back the role it added to the store's words", () => {
  const before = fs.readFileSync(path.join(store.root, 'pjman.yaml'), 'utf8');
  assert.throws(() => personIntake(store, 'Nobody New', { role: 'lawyer', aliases: ['!!!'] }), /makes no alias/);
  assert.equal(fs.readFileSync(path.join(store.root, 'pjman.yaml'), 'utf8'), before);
  assert.equal(store.config.roles?.includes('lawyer') ?? false, false);
});

// --- the dossier (change:person-dossier): read live from keys and titles the store holds, nothing ingested ---------

test("a person's dossier: the open changes they are on and how, never from a stake on the product root alone", () => {
  const loaded = loadStore(store);
  const park = personView(loaded, rec('person:sam-park'));
  assert.deepEqual(
    park.onNow.filter((c) => c.key === 'change:shop/round-tax').map((c) => c.as),
    [['owner on feature:shop/tax']],
  );
  const priya = personView(loaded, rec('person:priya-rao'));
  assert.deepEqual(
    priya.onNow.find((c) => c.key === 'change:shop/round-tax')?.as,
    ['approver on change:shop/round-tax'],
    'her stake on product:shop alone puts her on no change',
  );
  assert.equal(
    priya.onNow.some((c) => c.key === 'change:shop/bare'),
    false,
  );
  const lee = personView(loaded, rec('person:sam-lee'));
  assert.deepEqual(lee.onNow.find((c) => c.key === 'change:shop/bare')?.as, [
    'assignee on github-issue:acme/web#3',
    'author on github-issue:acme/web#3',
  ]);
  assert.deepEqual(
    lee.through.map((a) => [a.type, a.title]),
    [
      ['assignee', 'Tax rounds down'],
      ['author', 'Tax rounds down'],
    ],
  );
});

test('a dossier names the decisions they decided, rejected or commented on, and when they last wrote', () => {
  decision(store, 'round-tax/rounding', {
    name: 'Rounding',
    gist: 'How tax rounds',
    entries: [
      { type: 'question', text: 'Up or to the nearest cent?' },
      { type: 'option', id: 'up', text: 'Up' },
      { type: 'option', id: 'nearest', text: 'Nearest' },
      { type: 'comment', text: 'up reads safer', by: 'person:priya-rao' },
    ],
  });
  decision(store, 'round-tax/display', {
    name: 'Display',
    gist: 'How tax shows',
    entries: [
      { type: 'question', text: 'Line or total?' },
      { type: 'option', id: 'line', text: 'Per line' },
      { type: 'accept', option: 'line', by: 'person:priya-rao', text: 'per line' },
    ],
  });
  const v = personView(loadStore(store), rec('person:priya-rao'));
  assert.deepEqual(v.decided.map((d) => [d.how, d.key]).toSorted(), [
    ['commented', 'decision:shop/round-tax/rounding'],
    ['decided', 'decision:shop/round-tax/display'],
  ]);
  assert.ok(v.lastSeen?.key.startsWith('decision:shop/round-tax/'), JSON.stringify(v.lastSeen));
  const text = formatPerson(v).join('\n');
  assert.match(text, /## On now\n\n- change:shop\/round-tax/);
  assert.match(text, /## Decided\n\n- /);
  assert.match(text, /last seen \d{4}-\d{2}-\d{2} on decision:shop\/round-tax\//);
});
