import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../cli/init.js';
import { globalStore, readUserConfig, type Store } from '../store/config.js';
import { formatIdentity, identity } from '../model/identity.js';
import { slugify } from '../store/keys.js';
import { loadStore } from '../store/records.js';

// Each scenario is a person on a fresh machine: its own home, its own global config for the committer name, no writer
// in the environment. Commits need a committer, which the environment gives without touching the
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

const person = (store: Store, key: string) => loadStore(store).byKey.get(key)?.[0];

test("there is always an actor: with no committer name the handle is this machine's account name", () => {
  const { project } = machine('');
  const me = slugify(os.userInfo().username);
  const lines = init({ cwd: project });
  assert.equal(readUserConfig().actor, `person:${me}`);
  const store = globalStore()!;
  assert.deepEqual(person(store, `person:${me}`)!.data.links ?? [], []);
  assert.ok(
    lines.some((l) => l === `created person:${me}`),
    lines.join('\n'),
  );
  const id = identity(store);
  assert.deepEqual(id.notices, []);
  assert.equal(formatIdentity(id)[0], `you are person:${me}`);
  assert.ok(
    lines.some((l) => l === `you are person:${me}`),
    lines.join('\n'),
  );
});

test('the committer name comes first, its email linked; an actor already named is kept', () => {
  const { project } = machine('[user]\n\tname = Ada Lovelace\n\temail = ADA@Example.com\n');
  init({ cwd: project });
  const store = globalStore()!;
  assert.equal(readUserConfig().actor, 'person:ada-lovelace');
  assert.deepEqual(person(store, 'person:ada-lovelace')!.data.links, ['email:ada@example.com']);
  assert.match(formatIdentity(identity(store))[0], /^you are person:ada-lovelace \(Ada Lovelace\)$/);
  init({ cwd: project });
  assert.equal(readUserConfig().actor, 'person:ada-lovelace');
});

test('no actor and no record are said with the way out', () => {
  const { project } = machine('[user]\n\tname = Carol\n');
  const store = {
    root: path.join(project, 'nowhere'),
    config: { name: 'x', layers: [], vocabulary: {}, source_kinds: ['github-user', 'email'], tree_levels: [] },
  } as Store;
  let id = identity(store);
  assert.equal(id.actor, null);
  assert.match(id.notices[0], /^no actor is configured: run pjman init/);
  assert.equal(formatIdentity(id)[0], 'no actor configured');
  init({ cwd: project });
  const g = globalStore()!;
  fs.rmSync(path.join(g.root, 'actors', 'carol.md'));
  id = identity(g);
  assert.equal(id.record, false);
  assert.match(id.notices[0], /^person:carol has no record: run pjman init/);
  assert.match(formatIdentity(id)[0], /\(no record\)$/);
});
