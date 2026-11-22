// The part a source plays (change:source-edge-roles): one primary bound, a pull request that delivers, a design, the
// rest linked; the kind stays on the source's key.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { findStore, loadStoreConfig, writeStoreConfig, type Store } from '../store/config.js';
import { migrate, pendingMigration } from '../ops/migrate.js';
import { newRecord } from '../ops/new.js';
import { sessionObserve, sessionUnobserve } from '../ops/session.js';
import { set } from '../ops/set.js';
import { undo } from '../ops/apply.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { primaryOf } from '../model/roles.js';
import { findSession, loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { change } from './shape.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-roles-'));
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
let store: Store;
const errors = () => validate(loadStore(store)).filter((p) => p.level === 'error');
const rec = (key: string) => loadStore(store).byKey.get(key)?.[0];
const observed = (id: string) =>
  ((findSession(loadStore(store), id)!.data.observed as { edge: string; from: string; to: string }[]) ?? []).map(
    (o) => `${o.edge} ${o.from} ${o.to}`,
  );

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  const dir = path.join(tmp, 'web');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  const kinds = ['entire-trail', 'github-issue', 'github-pr', 'url', 'jira', 'git-repo'];
  writeStoreConfig(store.root, {
    ...store.config,
    source_kinds: [...new Set([...store.config.source_kinds, ...kinds])],
  });
  execFileSync('git', ['commit', '-qam', 'test: kinds', '--allow-empty'], { cwd: store.root });
  store = findStore(dir)!;
  change(store, 'cart', { title: 'The cart', summary: 's', project: 'project:web' });
  set(store, 'project:web', ['links+=git-repo:acme/web'], {});
});

test("a change binds one primary, a tracker's ticket of any tracker; delivers names a pull request; design takes any source", () => {
  assert.throws(
    () => set(store, 'change:web/cart', ['binds+=entire-trail:gh/acme/1'], {}),
    /binds names the primary, a tracker's ticket; entire-trail:gh\/acme\/1 is a entire-trail: link it/,
  );
  assert.throws(
    () => set(store, 'change:web/cart', ['binds+=github-pr:acme/web#1'], {}),
    /binds names the primary, a tracker's ticket; github-pr:acme\/web#1 is a github-pr: it delivers/,
  );
  // a tracker with no short form to scan for is a tracker all the same
  change(store, 'jira-work', { title: 'Jira work', summary: 's', project: 'project:web', binds: ['jira:ABC-1234'] });
  set(store, 'change:web/cart', ['binds+=github-issue:acme/web#3'], {});
  assert.throws(
    () => set(store, 'change:web/cart', ['binds+=github-issue:acme/web#4'], {}),
    /binds names the primary, one source; github-issue:acme\/web#4 go in links/,
  );
  assert.throws(
    () => set(store, 'change:web/cart', ['delivers+=github-issue:acme/web#5'], {}),
    /delivers names a pull request/,
  );
  set(store, 'change:web/cart', ['delivers+=github-pr:acme/web#9', 'design+=url:https://example.com/canvas'], {});
  assert.deepEqual(errors(), []);
});

test('the context heads with the index and the design, and lists each source by its part, the primary first', () => {
  const c = changeContext(store, 'change:web/cart');
  assert.deepEqual(
    c.sources.map((s) => `${s.relation} ${s.key}`),
    ['binds github-issue:acme/web#3', 'delivers github-pr:acme/web#9', 'design url:https://example.com/canvas'],
  );
  const text = formatChangeContext(c);
  assert.match(text, /\nindex: github-issue:acme\/web#3/);
  assert.match(text, /\ndesign: url:https:\/\/example\.com\/canvas \(open it before building\)/);
  assert.equal(primaryOf(loadStore(store), rec('change:web/cart')!), 'github-issue:acme/web#3');
});

test('an observed link names its role: a pull request on a change delivers it; a session on no change binds the first it reads', () => {
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code' });
  sessionObserve(store, 's1', 'links', 'change:web/cart', 'github-pr:acme/web#10');
  sessionObserve(store, 's1', 'links', 'change:web/cart', 'branch:cart');
  // another repository's pull request, seen on the change, is cited
  sessionObserve(store, 's1', 'links', 'change:web/cart', 'github-pr:other/lib#5');
  assert.deepEqual(observed('s1'), [
    'delivers change:web/cart github-pr:acme/web#10',
    'links change:web/cart branch:cart',
    'links change:web/cart github-pr:other/lib#5',
  ]);
  // the same plain link again is the edge already held
  assert.equal(sessionObserve(store, 's1', 'links', 'change:web/cart', 'github-pr:acme/web#10').added, false);
  assert.equal(observed('s1').length, 3);
  // taken back by the plain link the host hands
  sessionUnobserve(store, 's1', 'links', 'change:web/cart', 'github-pr:acme/web#10');
  assert.deepEqual(observed('s1'), [
    'links change:web/cart branch:cart',
    'links change:web/cart github-pr:other/lib#5',
  ]);

  newRecord(store, 'session', 's2', { agent: 'agent:claude-code' });
  sessionObserve(store, 's2', 'links', 'session:s2', 'github-pr:acme/web#11');
  sessionObserve(store, 's2', 'links', 'session:s2', 'github-pr:acme/web#12');
  assert.deepEqual(observed('s2'), [
    'binds session:s2 github-pr:acme/web#11',
    'links session:s2 github-pr:acme/web#12',
  ]);
  // its own primary seen again is not a second edge beside it
  assert.equal(sessionObserve(store, 's2', 'links', 'session:s2', 'github-pr:acme/web#11').added, false);
  assert.equal(observed('s2').length, 2);
  assert.equal(primaryOf(loadStore(store), findSession(loadStore(store), 's2')!), 'github-pr:acme/web#11');
  assert.deepEqual(errors(), []);
});

test("the source-roles move: trails out of binds into links, the project's pull requests into delivers (another repository's stay cited), on changes and sessions; undo reverts it", () => {
  change(store, 'old', { title: 'Old shape', summary: 's', project: 'project:web' });
  const file = rec('change:web/old')!.abs;
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replace(
        /\nproject: project:web\n/,
        '\nproject: project:web\nbinds:\n  - github-issue:acme/web#20\n  - entire-trail:gh/acme/20\n  - github-pr:acme/web#22\n  - github-pr:other/lib#6\nlinks:\n  - github-pr:acme/web#21\n  - github-pr:other/lib#5\n  - url:https://example.com/doc\n',
      ),
  );
  newRecord(store, 'session', 's3', { agent: 'agent:claude-code' });
  const sfile = findSession(loadStore(store), 's3')!.abs;
  fs.writeFileSync(
    sfile,
    fs
      .readFileSync(sfile, 'utf8')
      .replace(
        /\n---\n/,
        '\nobserved:\n  - edge: links\n    from: change:web/old\n    to: github-pr:acme/web#21\n    at: 2026-11-22T00:00:00.000Z\n  - edge: links\n    from: change:web/old\n    to: github-pr:other/lib#7\n    at: 2026-11-22T00:00:00.000Z\n---\n',
      ),
  );
  execFileSync('git', ['add', '-A'], { cwd: store.root });
  execFileSync('git', ['commit', '-qm', 'test: the old shape'], { cwd: store.root });
  writeStoreConfig(store.root, { ...loadStoreConfig(store.root), version: '0.10.0' });
  execFileSync('git', ['commit', '-qam', 'test: stamped 0.10.0'], { cwd: store.root });
  const old = findStore(path.join(tmp, 'web'))!;
  assert.equal(pendingMigration(old), 'source-roles');
  const r = migrate(old, {});
  assert.equal(r.kind, 'source-roles');
  assert.ok(r.commit);
  const d = rec('change:web/old')!.data;
  assert.deepEqual(d.binds, ['github-issue:acme/web#20']);
  assert.deepEqual(d.delivers, ['github-pr:acme/web#22', 'github-pr:acme/web#21']);
  assert.deepEqual(d.links, [
    'github-pr:other/lib#5',
    'url:https://example.com/doc',
    'entire-trail:gh/acme/20',
    'github-pr:other/lib#6',
  ]);
  assert.deepEqual(observed('s3'), [
    'delivers change:web/old github-pr:acme/web#21',
    'links change:web/old github-pr:other/lib#7',
  ]);
  assert.deepEqual(errors(), []);
  undo(old, { commit: r.commit });
  assert.deepEqual(rec('change:web/old')!.data.binds, [
    'github-issue:acme/web#20',
    'entire-trail:gh/acme/20',
    'github-pr:acme/web#22',
    'github-pr:other/lib#6',
  ]);
  assert.deepEqual(observed('s3'), [
    'links change:web/old github-pr:acme/web#21',
    'links change:web/old github-pr:other/lib#7',
  ]);
});
