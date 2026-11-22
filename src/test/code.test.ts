// The code a capability is built from (change:capability-code-paths): files are code sources linked to the leaf
// capabilities they implement, by the agent that finds them, a person who pins them, and the merge that touches them
// (decisions capability-code-paths/code-field and capability-code-paths/upkeep); a parent shows its children's,
// rolled up; a gone path is said; every write is one commit that pjman undo reverts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { step } from '../ops/step.js';
import { undo } from '../ops/apply.js';
import {
  codeLink,
  codeMove,
  codeSeed,
  codeUnlink,
  codeUpkeep,
  foldDiffs,
  isNoise,
  learnedOf,
  mergedDiff,
  parseNameStatus,
} from '../ops/code.js';
import { pendingMigration } from '../ops/migrate.js';
import { findStore, writeStoreConfig, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';
import { mergedInto, syncGit } from '../sync/git.js';
import {
  codeOf,
  formatChangeCode,
  globMatches,
  globRegex,
  implementsOf,
  nodeCode,
  QUIET_LIMIT,
} from '../model/code.js';
import { changeContext, formatChangeContext } from '../model/view.js';
import { validate } from '../model/validate.js';
import { get } from '../model/graph.js';
import { change } from './shape.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-code-')));
const dir = path.join(tmp, 'web');
let store: Store;

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};
const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env }).trim();
const write = (rel: string, text = `${rel}\n`) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commitAll = (subject: string) => {
  g('add', '-A');
  g('commit', '-q', '-m', subject);
};
const asAgent = { cwd: dir, writer: 'agent:claude-code' };
const asPerson = { cwd: dir, writer: 'person:tester' };
const entriesAt = (p: string) => {
  const r = loadStore(store).byKey.get(`code:web/${p}`)?.[0];
  return r ? implementsOf(r) : null;
};

before(() => {
  process.env.PJMAN_HOME = path.join(tmp, 'home');
  delete process.env.PJMAN_SESSION;
  delete process.env.PJMAN_WRITER;
  fs.mkdirSync(process.env.PJMAN_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.PJMAN_HOME, 'config.yaml'), 'actor: person:tester\nstores: []\n');
  fs.mkdirSync(dir, { recursive: true });
  g('init', '-q', '-b', 'main');
  write('src/pay/card.ts');
  write('src/pay/scan.ts');
  write('src/pay/shared.ts');
  write('README.md');
  commitAll('chore: start');
  init({ cwd: dir, name: 'web', map: false });
  store = findStore(dir)!;
  newRecord(store, 'feature', 'checkout', { title: 'Checkout', product: 'product:web' });
  newRecord(store, 'feature', 'saved-cards', { title: 'Pay with a saved card', parent: 'feature:web/checkout' });
  newRecord(store, 'feature', 'card-scan', { title: 'Scan a card', parent: 'feature:web/checkout' });
});

test('an agent links what it found; a person pins; a parent holds none of its own', () => {
  const w = codeLink(store, 'saved-cards', ['src/pay/card.ts', 'src/pay/shared.ts'], asAgent);
  assert.deepEqual(w.created.toSorted(), ['code:web/src/pay/card.ts', 'code:web/src/pay/shared.ts']);
  assert.ok(w.commit, 'one commit');
  assert.deepEqual(entriesAt('src/pay/card.ts'), [{ feature: 'feature:web/saved-cards', by: 'agent', n: 0 }]);
  // a path relative to where the command runs, inside the repository
  codeLink(store, 'card-scan', ['scan.ts', 'shared.ts'], { ...asAgent, cwd: path.join(dir, 'src/pay') });
  assert.equal(entriesAt('src/pay/scan.ts')?.[0].feature, 'feature:web/card-scan');
  assert.equal(entriesAt('src/pay/shared.ts')?.length, 2, 'a file shared by two capabilities names both');
  // a person linking it pins it
  codeLink(store, 'saved-cards', ['src/pay/card.ts'], asPerson);
  assert.equal(entriesAt('src/pay/card.ts')?.[0].by, 'person');
  assert.throws(() => codeLink(store, 'checkout', ['src/pay/card.ts'], asAgent), /capabilities beneath it/);
  assert.throws(() => codeLink(store, 'saved-cards', ['src/pay/nope.ts'], asAgent), /no such file/);
  assert.throws(() => codeLink(store, 'no-such-feature', ['src/pay/card.ts'], asAgent), /not a feature/);
});

test('a capability lists its files ranked; its parent and the product roll them up', () => {
  const loaded = loadStore(store);
  assert.deepEqual(
    codeOf(loaded, 'feature:web/saved-cards').map((f) => [f.path, f.by]),
    [
      ['src/pay/card.ts', 'person'],
      ['src/pay/shared.ts', 'agent'],
    ],
  );
  const parent = nodeCode(loaded, 'feature:web/checkout');
  assert.equal(parent.own.length, 0);
  assert.deepEqual(parent.rolled.map((f) => f.path).toSorted(), [
    'src/pay/card.ts',
    'src/pay/scan.ts',
    'src/pay/shared.ts',
  ]);
  const shared = parent.rolled.find((f) => f.path === 'src/pay/shared.ts')!;
  assert.deepEqual(shared.features?.toSorted(), ['feature:web/card-scan', 'feature:web/saved-cards']);
  assert.equal(nodeCode(loaded, 'product:web').rolled.length, 3);
  // the graph: a code file implements its capabilities
  const n = get(loaded, 'code:web/src/pay/shared.ts', { cwd: dir });
  assert.deepEqual(
    n.out
      .filter((e) => e.edge === 'implements')
      .map((e) => e.to)
      .toSorted(),
    ['feature:web/card-scan', 'feature:web/saved-cards'],
  );
});

test("a change's context lists the code of the capabilities it names", () => {
  change(store, 'faster-cards', {
    title: 'Faster cards',
    project: 'project:web',
    features: ['changes feature:web/saved-cards'],
  });
  const c = changeContext(store, 'change:web/faster-cards');
  assert.equal(c.code.length, 1);
  const text = formatChangeContext(c);
  assert.match(
    text,
    /## Code\n\nfeature:web\/saved-cards:\n- src\/pay\/card\.ts \(pinned\)\n- src\/pay\/shared\.ts \(found\)/,
  );
  assert.deepEqual(formatChangeCode([]), [], 'a change naming nothing with code says nothing');
});

test('unlink takes a file off, a file implementing nothing goes, and undo puts it back', () => {
  const w = codeUnlink(store, 'card-scan', ['src/pay/scan.ts'], asAgent);
  assert.deepEqual(w.removed, ['code:web/src/pay/scan.ts']);
  assert.equal(entriesAt('src/pay/scan.ts'), null);
  undo(store, { commit: w.commit! });
  assert.equal(entriesAt('src/pay/scan.ts')?.[0].feature, 'feature:web/card-scan');
  assert.throws(() => codeUnlink(store, 'card-scan', ['src/pay/card.ts'], asAgent), /not linked/);
});

test('a gone path is said by validate and in the read, and mv follows it', () => {
  g('mv', 'src/pay/scan.ts', 'src/pay/camera.ts');
  commitAll('refactor: rename scan');
  const loaded = loadStore(store);
  const warned = validate(loaded).filter(
    (p) => p.level === 'warning' && /src\/pay\/scan\.ts is in no checkout/.test(p.message),
  );
  assert.equal(warned.length, 1);
  assert.equal(
    codeOf(loaded, 'feature:web/card-scan', new Map([['web', [dir]]])).find((f) => f.path === 'src/pay/scan.ts')?.gone,
    true,
  );
  codeMove(store, 'src/pay/scan.ts', 'src/pay/camera.ts', asAgent);
  assert.equal(entriesAt('src/pay/scan.ts'), null);
  assert.equal(entriesAt('src/pay/camera.ts')?.[0].feature, 'feature:web/card-scan');
});

test('name-status lines read as entries, and noise is never linked by a merge', () => {
  assert.deepEqual(parseNameStatus('M\ta.ts\nR087\told.ts\tnew.ts\nD\tgone.ts\nA\tadded.ts\n'), [
    { status: 'M', path: 'a.ts' },
    { status: 'R', path: 'new.ts', from: 'old.ts' },
    { status: 'D', path: 'gone.ts' },
    { status: 'A', path: 'added.ts' },
  ]);
  for (const p of [
    'package-lock.json',
    'README.md',
    'docs/reference.md',
    'ui/src/routeTree.gen.ts',
    '.claude/x',
    'dist/a.js',
  ])
    assert.ok(isNoise(p), p);
  for (const p of ['src/pay/card.ts', 'adapters/x/SKILL.md']) assert.ok(!isNoise(p), p);
});

test('a merged change teaches its capabilities: touched files count, renames follow, deletions go, once', () => {
  change(store, 'card-limits', {
    title: 'Card limits',
    project: 'project:web',
    features: ['changes feature:web/saved-cards'],
    next: 'build it',
  });
  g('switch', '-q', '-c', 'card-limits');
  write('src/pay/card.ts', 'limits\n');
  write('src/pay/limits.ts');
  write('README.md', 'more docs\n');
  g('mv', 'src/pay/shared.ts', 'src/pay/common.ts');
  commitAll('feat: card limits (change:card-limits)');
  g('switch', '-q', 'main');
  g('merge', '-q', '--no-ff', 'card-limits', '-m', "Merge branch 'card-limits'");
  const m = mergedInto(dir, 'card-limits', { named: 'change:card-limits' })!;
  assert.deepEqual(
    mergedDiff(dir, 'card-limits', m, 'change:card-limits')
      .map((d) => d.status + ' ' + d.path)
      .toSorted(),
    ['A src/pay/limits.ts', 'M README.md', 'M src/pay/card.ts', 'R src/pay/common.ts'],
  );
  step(store, 'change:web/card-limits', 'done', 1, {});
  const r = syncGit(store);
  assert.deepEqual(
    r.done.map((d) => d.change),
    ['change:web/card-limits'],
  );
  assert.match(r.code?.[0] ?? '', /code: .*linked/);
  assert.deepEqual(entriesAt('src/pay/card.ts'), [
    { feature: 'feature:web/saved-cards', by: 'person', n: 1, last: 'change:web/card-limits' },
  ]);
  assert.deepEqual(entriesAt('src/pay/limits.ts'), [
    { feature: 'feature:web/saved-cards', by: 'merge', n: 1, last: 'change:web/card-limits' },
  ]);
  assert.equal(entriesAt('src/pay/shared.ts'), null, 'a renamed file leaves its old path');
  assert.deepEqual(
    entriesAt('src/pay/common.ts')
      ?.map((e) => [e.feature, e.n])
      .toSorted(),
    [
      ['feature:web/card-scan', 0],
      ['feature:web/saved-cards', 1],
    ],
    'its links follow it, and the change touched it for the capability it names',
  );
  assert.equal(entriesAt('README.md'), null, 'documentation is not linked by a merge');
  const again = codeUpkeep(store, 'change:web/card-limits', { diff: [{ status: 'M', path: 'src/pay/card.ts' }] });
  assert.equal(again.skipped, 'already learned from');
});

test('a link no person wrote drops once enough merged changes pass it by; a pinned one stays', () => {
  for (let i = 0; i < QUIET_LIMIT; i++) {
    change(store, `tweak-${i}`, {
      title: `Tweak ${i}`,
      project: 'project:web',
      features: ['changes feature:web/saved-cards'],
    });
    codeUpkeep(store, `change:web/tweak-${i}`, { diff: [{ status: 'M', path: 'src/pay/card.ts' }] });
    const left = entriesAt('src/pay/limits.ts');
    if (i < QUIET_LIMIT - 1) assert.equal(left?.[0].quiet, i + 1);
  }
  assert.equal(entriesAt('src/pay/limits.ts'), null, 'the merge-written link dropped');
  assert.equal(entriesAt('src/pay/card.ts')?.[0].n, 1 + QUIET_LIMIT, 'the touched one counted each time');
  change(store, 'unrelated', {
    title: 'Unrelated',
    project: 'project:web',
    features: ['changes feature:web/saved-cards'],
  });
  codeUpkeep(store, 'change:web/unrelated', { diff: [{ status: 'M', path: 'src/pay/common.ts' }] });
  assert.deepEqual(
    entriesAt('src/pay/card.ts')?.map((e) => [e.by, e.quiet]),
    [['person', undefined]],
    'a pinned link is never counted down',
  );
});

test('seed gives a project its first links from the commits that name one change', () => {
  change(store, 'scan-flash', {
    title: 'Scan flash',
    project: 'project:web',
    features: ['adds feature:web/card-scan'],
  });
  write('src/pay/flash.ts');
  commitAll('feat: flash (change:scan-flash)');
  write('src/pay/both.ts');
  commitAll('feat: two at once (change:scan-flash, change:card-limits)');
  const dry = codeSeed(store, { ...asAgent, write: false });
  const scan = dry.capabilities.find((c) => c.feature === 'feature:web/card-scan');
  assert.deepEqual(
    scan?.files.map((f) => f.path),
    ['src/pay/flash.ts'],
    'a commit naming two changes gives nothing',
  );
  assert.equal(entriesAt('src/pay/flash.ts'), null, 'a check writes nothing');
  const w = codeSeed(store, asAgent);
  assert.ok(w.created.includes('code:web/src/pay/flash.ts'));
  assert.deepEqual(entriesAt('src/pay/flash.ts'), [
    { feature: 'feature:web/card-scan', by: 'merge', n: 1, last: 'change:web/scan-flash' },
  ]);
  assert.equal(validate(loadStore(store)).filter((p) => p.level === 'error').length, 0);
});

test('a store without the code kind waits for the migration that adds it', () => {
  const cfg = {
    ...store.config,
    version: '0.8.0',
    source_kinds: store.config.source_kinds.filter((k) => k !== 'code'),
  };
  const copy = path.join(tmp, 'old-store');
  fs.cpSync(store.root, copy, { recursive: true });
  writeStoreConfig(copy, cfg);
  const old = findStore(tmp, copy)!;
  assert.equal(pendingMigration(old), 'code-kinds');
});

test('unlink and mv read a path as link does: relative to where they run', () => {
  const sub = { ...asAgent, cwd: path.join(dir, 'src/pay') };
  codeLink(store, 'card-scan', ['flash.ts'], sub); // already linked by the seed: nothing to write
  codeUnlink(store, 'card-scan', ['./flash.ts'], sub);
  assert.equal(entriesAt('src/pay/flash.ts'), null);
  codeLink(store, 'card-scan', ['flash.ts'], sub);
  g('mv', 'src/pay/flash.ts', 'src/pay/torch.ts');
  commitAll('refactor: flash is a torch');
  codeMove(store, './flash.ts', './torch.ts', sub);
  assert.equal(entriesAt('src/pay/flash.ts'), null);
  assert.equal(entriesAt('src/pay/torch.ts')?.[0].feature, 'feature:web/card-scan');
});

test('a glob is linked only when it matches a file, said gone when it matches none, and counts what falls under it', () => {
  assert.ok(globRegex('src/**/*.ts').test('src/pay/card.ts'));
  assert.ok(globRegex('src/**/*.ts').test('src/a.ts'), '**/ is any depth, none included');
  assert.ok(!globRegex('src/*.ts').test('src/pay/card.ts'), '* stays in one segment');
  assert.ok(globMatches(dir, 'src/pay/*.ts'));
  assert.ok(!globMatches(dir, 'src/pay/*.tsx'));
  assert.ok(!globMatches(dir, '**/nowhere.ts'));
  assert.throws(() => codeLink(store, 'card-scan', ['src/pay/*.tsx'], asAgent), /the glob matches no file/);
  write('src/scan/lens.ts');
  write('src/scan/focus.ts');
  commitAll('feat: a scan folder');
  codeLink(store, 'card-scan', ['src/scan/*.ts'], asAgent);
  change(store, 'lens-fix', { title: 'Lens fix', project: 'project:web', features: ['changes feature:web/card-scan'] });
  codeUpkeep(store, 'change:web/lens-fix', { diff: [{ status: 'M', path: 'src/scan/lens.ts' }] });
  assert.deepEqual(
    entriesAt('src/scan/*.ts')?.map((e) => [e.n, e.quiet]),
    [[1, undefined]],
    'the glob was touched: counted, not quieter',
  );
  assert.equal(entriesAt('src/scan/lens.ts'), null, 'a path under the glob is not linked again on its own');
  // validate: a glob that matches nothing is gone
  fs.rmSync(path.join(dir, 'src/scan'), { recursive: true });
  const gone = validate(loadStore(store)).filter((p) => /src\/scan\/\*\.ts is in no checkout/.test(p.message));
  assert.equal(gone.length, 1);
  g('checkout', '-q', '--', 'src/scan');
});

test('a deleted file loses the links merged work and agents made, and keeps a pinned one to relink', () => {
  write('src/pay/old.ts');
  commitAll('feat: an old file');
  codeLink(store, 'saved-cards', ['src/pay/old.ts'], asPerson);
  codeLink(store, 'card-scan', ['src/pay/old.ts'], asAgent);
  change(store, 'drop-old', {
    title: 'Drop old',
    project: 'project:web',
    features: ['changes feature:web/saved-cards'],
  });
  codeUpkeep(store, 'change:web/drop-old', { diff: [{ status: 'D', path: 'src/pay/old.ts' }] });
  assert.deepEqual(
    entriesAt('src/pay/old.ts')?.map((e) => [e.feature, e.by]),
    [['feature:web/saved-cards', 'person']],
  );
});

test('a change is learned from once, by the mark it keeps, even when it touched none of its files', () => {
  change(store, 'once', { title: 'Once', project: 'project:web', features: ['changes feature:web/saved-cards'] });
  // a merge that touched none of its capabilities' files is still learned from once
  const first = codeUpkeep(store, 'change:web/once', { diff: [{ status: 'M', path: 'README.md' }] });
  assert.equal(first.skipped, undefined);
  assert.ok(learnedOf(loadStore(store).byKey.get('change:web/once')![0]));
  const second = codeUpkeep(store, 'change:web/once', { diff: [{ status: 'M', path: 'src/pay/card.ts' }] });
  assert.equal(second.skipped, 'already learned from');
});

test("a merged branch's diff is read however it merged, and a fast-forward reads its own commits alone", () => {
  const on = (subject: string, files: Record<string, string>) => {
    for (const [p, t] of Object.entries(files)) write(p, t);
    commitAll(subject);
  };
  const diffOf = (branch: string, slug: string) => {
    const m = mergedInto(dir, branch, { named: `change:${slug}` });
    assert.ok(m, `${branch} is merged`);
    return mergedDiff(dir, branch, m, `change:${slug}`)
      .map((d) => `${d.status} ${d.from ? `${d.from}→` : ''}${d.path}`)
      .toSorted();
  };
  // squash
  g('switch', '-q', '-c', 'sq');
  on('feat: sq one (change:sq)', { 'src/sq/a.ts': 'a\n' });
  on('feat: sq two (change:sq)', { 'src/sq/b.ts': 'b\n' });
  g('switch', '-q', 'main');
  on('chore: main moves', { 'src/other.ts': 'o\n' });
  g('merge', '-q', '--squash', 'sq');
  g('commit', '-q', '-m', 'Squashed sq (#1)');
  assert.deepEqual(diffOf('sq', 'sq'), ['A src/sq/a.ts', 'A src/sq/b.ts']);
  // rebase
  g('switch', '-q', '-c', 'rb');
  on('feat: rb (change:rb)', { 'src/rb.ts': 'r\n' });
  g('switch', '-q', 'main');
  on('chore: main moves again', { 'src/other.ts': 'o2\n' });
  g('cherry-pick', 'main..rb');
  assert.deepEqual(diffOf('rb', 'rb'), ['A src/rb.ts']);
  // fast-forward, with a commit of change:ff-more and one of another change between its own
  g('switch', '-q', '-c', 'ff');
  on('feat: ff one (change:ff)', { 'src/ff/a.ts': 'a\n' });
  on('feat: not it (change:ff-more)', { 'src/ff/more.ts': 'm\n' });
  on('feat: another (change:else)', { 'src/else.ts': 'e\n' });
  on('feat: ff two (change:ff)', { 'src/ff/a.ts': 'a2\n', 'src/ff/b.ts': 'b\n' });
  g('switch', '-q', 'main');
  g('merge', '-q', '--ff-only', 'ff');
  assert.deepEqual(diffOf('ff', 'ff'), ['A src/ff/a.ts', 'A src/ff/b.ts']);
});

test('diffs fold oldest first: added then changed is added, added then deleted is nothing, renamed twice is one rename', () => {
  assert.deepEqual(
    foldDiffs([
      [
        { status: 'A', path: 'a' },
        { status: 'R', path: 'y', from: 'x' },
        { status: 'M', path: 'm' },
      ],
      [
        { status: 'M', path: 'a' },
        { status: 'R', path: 'z', from: 'y' },
        { status: 'A', path: 'tmp' },
      ],
      [{ status: 'D', path: 'tmp' }],
    ]).map((d) => `${d.status} ${d.from ?? ''}${d.from ? '→' : ''}${d.path}`),
    ['A a', 'M m', 'R x→z'],
  );
});
