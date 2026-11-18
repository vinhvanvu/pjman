// pjman sync entire links the Entire checkpoints behind a project's commits to the changes and sessions that made
// them (change:checkpoint-link). The repository here carries `Entire-Checkpoint` trailers as Entire's commit hook
// writes them; Entire is a fake binary answering `checkpoint explain`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { MIGRATIONS, migrate, pendingMigration } from '../ops/migrate.js';
import { newRecord } from '../ops/new.js';
import { set } from '../ops/set.js';
import { findStore, loadStoreConfig, openStore, writeStoreConfig, type Store } from '../store/config.js';
import { findSession, loadStore } from '../store/records.js';
import { validate } from '../model/validate.js';
import { checkpointCommits, syncEntire } from '../sync/entire.js';
import { mergedBranch } from '../sync/git.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-entire-sync-')));
const dir = path.join(tmp, 'web');
const A = '01AAAAAAAAAAAAAAAAAAAAAAAA';
const B = '01BBBBBBBBBBBBBBBBBBBBBBBB';
const C = '01CCCCCCCCCCCCCCCCCCCCCCCC';
const D = '01DDDDDDDDDDDDDDDDDDDDDDDD';
let store: Store;
let n = 0;

const g = (...args: string[]) =>
  execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
const commit = (subject: string, checkpoint?: string): string => {
  fs.writeFileSync(path.join(dir, `f${++n}.txt`), String(n));
  g('add', '-A');
  g('commit', '-q', '-m', checkpoint ? `${subject}\n\nEntire-Checkpoint: ${checkpoint}` : subject);
  return g('rev-parse', 'HEAD');
};

/** A fake entire: `checkpoint explain <id>` names the sessions behind it; one id fails. */
function fake(): string {
  const file = path.join(tmp, 'entire');
  fs.writeFileSync(
    file,
    `#!/bin/sh
echo "$@" >> ${path.join(tmp, 'calls.log')}
case "$1 $2 $3" in
  "checkpoint explain ${A}") echo '{"checkpoint_id":"${A}","sessions":[{"session_id":"s1"}]}' ;;
  "checkpoint explain ${B}") echo '{"checkpoint_id":"${B}","sessions":[{"session_id":"s1"},{"session_id":"not-in-the-store"}]}' ;;
  "checkpoint explain ${C}") echo '{"checkpoint_id":"${C}","sessions":[{"session_id":"s2"}]}' ;;
  *) echo "checkpoint not found on the remote" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  return file;
}
const calls = (): string[] => {
  try {
    return fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim().split('\n');
  } catch {
    return [];
  }
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  init({ cwd: dir, name: 'web' });
  store = findStore(dir)!;
  set(store, 'project:web', ['ext.github.repo=acme/web'], {});
  change(store, 'cart', { title: 'Cart', summary: 's', project: 'project:web' });
  change(store, 'search', { title: 'Search', summary: 's', project: 'project:web' });
  newRecord(store, 'session', 's1', { agent: 'agent:claude-code' });
  newRecord(store, 'session', 's2', { agent: 'agent:claude-code' });
  // history: a commit on main with no trailer; cart built on its branch and merged; search on a branch still open;
  // one checkpoint on main that names no change
  commit('chore: start');
  g('switch', '-q', '-c', 'cart');
  commit('feat: the cart holds items', A);
  commit('feat: the cart totals', B);
  g('switch', '-q', 'main');
  g('merge', '-q', '--no-ff', 'cart', '-m', "Merge branch 'cart': the cart");
  g('branch', '-q', '-D', 'cart');
  commit('chore: tidy', D);
  g('switch', '-q', '-c', 'vinh/search');
  commit('feat: search finds things (change:search)', C);
  g('switch', '-q', 'main');
});

test('the commits carrying a checkpoint are read from git, each with the branch whose work it is', () => {
  const found = checkpointCommits(dir);
  assert.deepEqual(
    found.map((c) => [c.subject, c.checkpoints, c.branches]).toSorted(),
    [
      ['chore: tidy', [D], []],
      ['feat: search finds things (change:search)', [C], ['vinh/search']],
      ['feat: the cart holds items', [A], ['cart']],
      ['feat: the cart totals', [B], ['cart']],
    ].toSorted(),
  );
  assert.equal(mergedBranch("Merge branch 'cart': the cart"), 'cart');
  assert.equal(mergedBranch('Merge pull request #12 from acme/vinh/search'), 'vinh/search');
  assert.equal(mergedBranch('feat: merge things'), null);
});

test('a project that has not opted in is refused, and nothing of Entire runs', () => {
  assert.throws(() => syncEntire(store, { entire: { bin: fake() } }), /project:web has not opted in to Entire/);
  assert.deepEqual(calls(), []);
});

test('opted in: each checkpoint becomes a source on its change, observed by the sessions that made it', () => {
  set(store, 'project:web', ['ext.entire.enabled=true'], {});
  const r = syncEntire(store, { entire: { bin: fake() } });
  assert.equal(r.checkpoints, 4);
  assert.equal(r.unplaced, 1, 'the tidy commit names no change');
  assert.deepEqual(
    r.linked.map((l) => [l.checkpoint, l.change, l.sessions]).toSorted(),
    [
      [`entire-checkpoint:${A}`, 'change:web/cart', ['session:s1']],
      [`entire-checkpoint:${B}`, 'change:web/cart', ['session:s1']],
      [`entire-checkpoint:${C}`, 'change:web/search', ['session:s2']],
    ].toSorted(),
  );
  assert.deepEqual(r.pending, []);
  assert.ok(r.commit, 'one commit for the whole sync');
  const loaded = loadStore(store);
  assert.deepEqual(
    validate(loaded).filter((p) => p.level === 'error'),
    [],
  );
  const cart = loaded.byKey.get('change:web/cart')![0];
  assert.deepEqual(cart.data.links, [`entire-checkpoint:${A}`, `entire-checkpoint:${B}`]);
  const src = loaded.byKey.get(`entire-checkpoint:${A}`)![0];
  assert.equal(src.data.title, 'feat: the cart holds items');
  assert.match(String(src.data.url), /^https:\/\/entire\.com\/gh\/acme\/web\/commit\/[0-9a-f]{40}$/);
  assert.deepEqual((src.data.ext as { entire: { sessions: string[] } }).entire.sessions, ['s1']);
  const s1 = findSession(loaded, 's1')!;
  assert.deepEqual(
    (s1.data.observed as { edge: string; from: string; to: string }[]).map((o) => [o.edge, o.from, o.to]),
    [
      ['links', 'change:web/cart', `entire-checkpoint:${A}`],
      ['links', 'change:web/cart', `entire-checkpoint:${B}`],
    ],
  );
});

test('a second sync writes nothing and asks Entire nothing it already knows', () => {
  const before = calls().length;
  const r = syncEntire(store, { entire: { bin: fake() } });
  assert.equal(r.linked.length, 0);
  assert.equal(r.commit, null);
  assert.equal(calls().length, before);
});

test('what Entire does not answer is pending: the link is made from git alone, and the sessions are read next time', () => {
  g('switch', '-q', 'vinh/search');
  commit('feat: search ranks (change:search)', '01EEEEEEEEEEEEEEEEEEEEEEEE');
  g('switch', '-q', 'main');
  const r = syncEntire(store, { entire: { bin: fake() } });
  assert.deepEqual(r.linked, [
    { checkpoint: 'entire-checkpoint:01EEEEEEEEEEEEEEEEEEEEEEEE', change: 'change:web/search', sessions: [] },
  ]);
  assert.equal(r.pending.length, 1);
  assert.match(r.pending[0], /entire checkpoint explain 01E+ failed: checkpoint not found on the remote/);
  const none = syncEntire(store, { entire: { bin: path.join(tmp, 'no-entire') } });
  assert.deepEqual(none.pending, ['no entire on the PATH']);
  assert.equal(none.commit, null);
});

test("Entire is not asked again in a run once it fails, a checkpoint follows its commit, and stacked work is the lower branch's", () => {
  const F = '01FFFFFFFFFFFFFFFFFFFFFFFF';
  const G = '01GGGGGGGGGGGGGGGGGGGGGGGG';
  g('switch', '-q', 'vinh/search');
  commit('feat: search sorts (change:search)', F);
  commit('feat: search pages (change:search)', G);
  g('switch', '-q', 'main');
  // three checkpoints Entire cannot answer for: one call fails, and the run asks no more
  const asked = calls().length;
  const r = syncEntire(store, { entire: { bin: fake() } });
  assert.equal(calls().length - asked, 1);
  assert.equal(r.pending.length, 1);
  assert.equal(r.linked.length, 2);
  // the commit is amended: the trailer sits on a new commit, and the source follows it there
  g('switch', '-q', 'vinh/search');
  g('commit', '-q', '--amend', '-m', `feat: search pages well (change:search)\n\nEntire-Checkpoint: ${G}`);
  const amended = g('rev-parse', 'HEAD');
  g('switch', '-q', 'main');
  syncEntire(store, { entire: { bin: fake() } });
  const src = loadStore(store).byKey.get(`entire-checkpoint:${G}`)![0];
  assert.equal((src.data.ext as { entire: { commit: string } }).entire.commit, amended);
  assert.match(String(src.data.url), new RegExp(`${amended}$`));
  // a branch stacked on another: the lower branch's commit is the lower branch's alone
  g('switch', '-q', '-c', 'lower', 'main');
  const low = commit('feat: lower', '01HHHHHHHHHHHHHHHHHHHHHHHH');
  g('switch', '-q', '-c', 'upper');
  const up = commit('feat: upper', '01KKKKKKKKKKKKKKKKKKKKKKKK');
  g('switch', '-q', 'main');
  const found = checkpointCommits(dir);
  assert.deepEqual(found.find((c) => c.sha === low)!.branches, ['lower']);
  assert.deepEqual(found.find((c) => c.sha === up)!.branches, ['upper']);
  g('branch', '-q', '-D', 'lower', 'upper');
});

test('the entire-kinds move: a store from before 0.7.0 gains the two source kinds, then the stamp', () => {
  const cfg = loadStoreConfig(store.root);
  assert.ok(cfg.source_kinds.includes('entire-checkpoint') && cfg.source_kinds.includes('entire-trail'));
  const m = MIGRATIONS.find((x) => x.name === 'entire-kinds')!;
  assert.equal(m.since, '0.7.0');
  const oldRoot = path.join(tmp, 'old');
  fs.cpSync(store.root, oldRoot, { recursive: true });
  for (const k of fs.readdirSync(path.join(oldRoot, 'sources', 'entire-checkpoint')))
    fs.rmSync(path.join(oldRoot, 'sources', 'entire-checkpoint', k));
  writeStoreConfig(oldRoot, {
    ...cfg,
    source_kinds: [...cfg.source_kinds.filter((k) => !k.startsWith('entire-')), 'my-own-kind'],
    version: '0.3.0',
  });
  execFileSync('git', ['checkout', '-q', '--', 'products', 'sessions'], { cwd: oldRoot });
  execFileSync('git', ['add', '-A'], { cwd: oldRoot });
  execFileSync('git', ['commit', '-q', '-m', 'an older store'], { cwd: oldRoot });
  const old = openStore(oldRoot);
  assert.equal(pendingMigration(old), 'entire-kinds');
  const r = migrate(old);
  assert.equal(r.kind, 'entire-kinds');
  assert.equal(r.rewritten, 2);
  assert.deepEqual(loadStoreConfig(oldRoot).source_kinds.slice(-3), [
    'my-own-kind',
    'entire-checkpoint',
    'entire-trail',
  ]);
  assert.equal(pendingMigration(openStore(oldRoot)), 'stamp');
  assert.equal(migrate(openStore(oldRoot)).version, '0.7.0');
  assert.equal(pendingMigration(openStore(oldRoot)), null);
});
