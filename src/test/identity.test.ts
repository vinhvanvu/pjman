import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../cli/init.js';
import { newRecord } from '../ops/new.js';
import { set } from '../ops/set.js';
import { globalStore, readUserConfig, type Store } from '../store/config.js';
import { cached, formatIdentity, identity, machineName, type Checker } from '../model/identity.js';
import { slugify } from '../store/keys.js';
import { loadStore } from '../store/records.js';

// Each scenario is a person on a fresh machine: its own home, its own global config for the committer name, no writer
// in the environment, and a fake forge. Commits need a committer, which the environment gives without touching the
// config the fallback reads.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-identity-'));
delete process.env.PJMAN_WRITER;
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;
process.env.GIT_AUTHOR_NAME = 'Test Committer';
process.env.GIT_AUTHOR_EMAIL = 'commits@example.com';
process.env.GIT_COMMITTER_NAME = 'Test Committer';
process.env.GIT_COMMITTER_EMAIL = 'commits@example.com';
process.env.GIT_CONFIG_NOSYSTEM = '1';

let n = 0;
function machine(gitconfig: string): { project: string } {
  const home = path.join(tmp, `home-${++n}`);
  fs.mkdirSync(home, { recursive: true });
  process.env.PJMAN_HOME = home;
  const cfg = path.join(home, 'gitconfig');
  fs.writeFileSync(cfg, gitconfig);
  process.env.GIT_CONFIG_GLOBAL = cfg;
  const project = path.join(home, 'app');
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  return { project };
}

/** A forge with a signed-in login, a set of known accounts and, when it allows, a list of emails. */
function forge(opts: {
  self?: string | null;
  known?: string[];
  emails?: string[] | string;
  calls?: { self: number };
}): Checker {
  return {
    kind: 'github-user',
    app: 'GitHub',
    self: () => {
      if (opts.calls) opts.calls.self += 1;
      return opts.self ?? null;
    },
    exists: (id) => (opts.known ? opts.known.includes(id) : null),
    emails: () =>
      Array.isArray(opts.emails)
        ? { list: opts.emails }
        : { reason: typeof opts.emails === 'string' ? opts.emails : 'no scope' },
  };
}

const person = (store: Store, key: string) => loadStore(store).byKey.get(key)?.[0];

test("there is always an actor: with no forge and no committer name the handle is this machine's account name, provisional", () => {
  const { project } = machine('');
  const me = slugify(machineName()!);
  const lines = init({ cwd: project, checkers: [forge({ self: null })] });
  assert.equal(readUserConfig().actor, `person:${me}`);
  const store = globalStore()!;
  const rec = person(store, `person:${me}`)!;
  assert.deepEqual(rec.data.links ?? [], []);
  assert.ok(
    lines.some((l) => l === `created person:${me}`),
    lines.join('\n'),
  );
  const id = identity(store, { verify: true, checkers: [forge({ self: null })] });
  assert.equal(id.provisional, true);
  assert.equal(id.primary, null);
  assert.equal(id.origin, 'machine');
  assert.equal(id.notices.length, 1);
  assert.match(
    id.notices[0],
    /came from this machine's account name and claims no account of a handle kind, so it is provisional; sign in to the forge/,
  );
  assert.match(formatIdentity(id)[0], /^you are person:.* \(provisional\)$/);
  // the same, said by init itself
  assert.ok(
    lines.some((l) => /^note: your handle .* is provisional/.test(l)),
    lines.join('\n'),
  );
});

test('the committer name is the second fallback; the email is an account but not a handle kind, so the handle stays provisional until the login is claimed', () => {
  const { project } = machine('[user]\n\tname = Ada Lovelace\n\temail = ADA@Example.com\n');
  init({ cwd: project, checkers: [forge({ self: null })] });
  const store = globalStore()!;
  assert.equal(readUserConfig().actor, 'person:ada-lovelace');
  assert.deepEqual(person(store, 'person:ada-lovelace')!.data.links, ['email:ada@example.com']);

  // the plain read asks nothing and points at --verify
  let id = identity(store);
  assert.equal(id.verified, false);
  assert.equal(id.provisional, true);
  assert.equal(id.origin, 'committer');
  assert.equal(id.accounts[0].verdict, undefined);
  assert.match(id.notices[0], /pjman whoami --verify says what the forge knows$/);

  // the forge login differs from the handle: both ways out are offered, and a re-run of init claims nothing
  // (the forge changes between scenarios, so each verified read asks fresh; a session would take the day's cache)
  const other = forge({ self: 'ada-l', emails: ['ada@example.com'] });
  id = identity(store, { verify: true, checkers: [other], fresh: true });
  assert.match(
    id.notices[0],
    /rename it to your GitHub login: pjman mv person:ada-lovelace person:ada-l \(the old handle stays an alias.*or keep it and claim the login: pjman set person:ada-lovelace links=email:ada@example.com,github-user:ada-l$/,
  );
  assert.equal(id.accounts[0].verdict, 'verified'); // the email is on the signed-in account
  assert.deepEqual(id.signed_in, [{ kind: 'github-user', id: 'ada-l', key: 'github-user:ada-l', claimed_by: null }]);
  let lines = init({ cwd: project, checkers: [other] });
  assert.ok(!lines.some((l) => /^claimed /.test(l)), lines.join('\n'));
  assert.deepEqual(person(store, 'person:ada-lovelace')!.data.links, ['email:ada@example.com']);

  // the login is the handle: a re-run of init claims it, and the handle stops being provisional
  const same = forge({ self: 'ada-lovelace', emails: 'no scope here' });
  lines = init({ cwd: project, checkers: [same] });
  assert.ok(
    lines.some((l) => l === 'claimed github-user:ada-lovelace for person:ada-lovelace: it is your handle'),
    lines.join('\n'),
  );
  assert.deepEqual(person(store, 'person:ada-lovelace')!.data.links, [
    'email:ada@example.com',
    'github-user:ada-lovelace',
  ]);
  id = identity(store, { verify: true, checkers: [same], fresh: true });
  assert.equal(id.provisional, false);
  assert.equal(id.primary, 'github-user:ada-lovelace');
  assert.deepEqual(id.notices, []);
  assert.deepEqual(
    id.accounts.map((a) => [a.key, a.primary, a.verdict]),
    [
      ['email:ada@example.com', false, 'unchecked'],
      ['github-user:ada-lovelace', true, 'verified'],
    ],
  );
  assert.equal(id.accounts[0].note, 'no scope here');
  // a chosen handle: the login claimed under another handle is said by nothing
  const chosen = forge({ self: 'ada-l', emails: [] });
  set(store, 'person:ada-lovelace', ['links=github-user:ada-l,email:ada@example.com'], {});
  id = identity(store, { verify: true, checkers: [chosen], fresh: true });
  assert.equal(id.provisional, false);
  assert.ok(!id.notices.some((n) => /provisional|rename/.test(n)), id.notices.join('\n'));
  assert.equal(id.accounts[1].verdict, 'unknown'); // the forge lists the emails and this one is not among them: said, never dropped
  assert.deepEqual(id.notices, [
    'email:ada@example.com is not known: not among the emails of your GitHub account (it stays until you drop it: pjman set person:ada-lovelace links=…)',
  ]);
  assert.match(formatIdentity(id)[2], /unknown: not among the emails of your GitHub account/);
});

test('a sign-in claimed by another person is always said; an account the forge does not know is said and never dropped; a kind with no checker is unchecked', () => {
  const { project } = machine('[user]\n\tname = Bob\n');
  init({ cwd: project, checkers: [forge({ self: null })] });
  const store = globalStore()!;
  newRecord(store, 'actor', 'person:alice', { links: ['github-user:bob'], writer: 'person:bob' });
  // bob's record claims nothing; the forge says bob is signed in; alice claims that login
  let id = identity(store, { verify: true, checkers: [forge({ self: 'bob', known: ['bob'] })], fresh: true });
  assert.equal(id.provisional, true);
  assert.equal(id.notices.length, 2);
  assert.match(id.notices[0], /the GitHub login bob is claimed by person:alice$/);
  assert.match(
    id.notices[1],
    /^the github-user account bob you are signed in as is claimed by person:alice; one account is one person's$/,
  );
  // a re-run of init does not claim a login someone else holds
  const lines = init({ cwd: project, checkers: [forge({ self: 'bob', known: ['bob'] })] });
  assert.ok(!lines.some((l) => /^claimed /.test(l)));
  // accounts the record names: one the forge knows (but is not the sign-in), one it does not, one nobody can ask
  set(
    store,
    'person:bob',
    ['links=github-user:robert,github-user:ghost,linear-user:1b2c,git-author:Bob <bob@example.com>'],
    {},
  );
  id = identity(store, { verify: true, checkers: [forge({ self: 'bob', known: ['bob', 'robert'] })], fresh: true });
  assert.equal(id.provisional, false); // github-user:robert is a handle kind, claimed
  assert.equal(id.primary, 'github-user:robert');
  assert.deepEqual(
    id.accounts.map((a) => [a.key, a.verdict, a.note]),
    [
      ['github-user:robert', 'unchecked', 'exists at GitHub, but the sign-in is bob'],
      ['github-user:ghost', 'unknown', 'GitHub knows no such account'],
      ['linear-user:1b2c', 'unchecked', 'no checker for linear-user'],
      ['git-author:Bob <bob@example.com>', 'unchecked', 'no checker for git-author'],
    ],
  );
  assert.deepEqual(id.notices, [
    "the github-user account bob you are signed in as is claimed by person:alice; one account is one person's",
    'github-user:ghost is not known: GitHub knows no such account (it stays until you drop it: pjman set person:bob links=…)',
  ]);
  assert.deepEqual(person(store, 'person:bob')!.data.links, [
    'github-user:robert',
    'github-user:ghost',
    'linear-user:1b2c',
    'git-author:Bob <bob@example.com>',
  ]);
});

test('no actor and no record are said with the way out', () => {
  const { project } = machine('');
  const store = {
    root: path.join(project, 'nowhere'),
    mode: 'standalone',
    config: { name: 'x', layers: [], vocabulary: {}, source_kinds: ['github-user', 'email'], tree_levels: [] },
  } as Store;
  let id = identity(store);
  assert.equal(id.actor, null);
  assert.match(id.notices[0], /^no actor is configured: run pjman init/);
  assert.equal(formatIdentity(id)[0], 'no actor configured');
  init({ cwd: project, checkers: [forge({ self: 'carol' })] });
  const g = globalStore()!;
  fs.rmSync(path.join(g.root, 'actors', 'carol.md'));
  id = identity(g);
  assert.equal(id.record, false);
  assert.match(id.notices[0], /^person:carol has no record: run pjman init/);
  assert.match(formatIdentity(id)[0], /\(no record\)$/);
});

test("the checkers' answers are cached for a day under the user directory; --fresh asks again", () => {
  machine('');
  const calls = { self: 0 };
  const inner = forge({ self: 'dan', calls });
  const a = cached(inner);
  assert.equal(a.self(), 'dan');
  assert.equal(a.self(), 'dan');
  assert.equal(calls.self, 1);
  const b = cached(inner); // another process, the same day
  assert.equal(b.self(), 'dan');
  assert.equal(calls.self, 1);
  const file = path.join(process.env.PJMAN_HOME!, 'identity-cache.json');
  assert.ok(fs.existsSync(file));
  const c = cached(inner, true);
  assert.equal(c.self(), 'dan');
  assert.equal(calls.self, 2);
  // a stale entry is asked again
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw['github-user'].at = Date.now() - 25 * 60 * 60 * 1000;
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(cached(inner).self(), 'dan');
  assert.equal(calls.self, 3);
});
