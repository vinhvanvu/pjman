// What runs beside the store (change:store-first-surfaces): the store alone by default, the dashboard and the dock opted
// into at init or with pjman configure, and a config an earlier pjman wrote keeping what it ran.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-surfaces-'));
const home = path.join(tmp, 'home');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const { readUserConfig, surfacesReach, userConfigPath } = await import('../store/config.js');
const { init } = await import('../cli/init.js');
const { configure, surfacesFlag } = await import('../cli/configure.js');
const { BRIEF, briefFor } = await import('../cli/brief.js');
const { doctor } = await import('../cli/doctor.js');

const cfgText = () => fs.readFileSync(userConfigPath(), 'utf8');

before(() => {
  fs.mkdirSync(project, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: project });
});

test('the ladder: each rung holds the ones below it', () => {
  assert.ok(surfacesReach('dock', 'dashboard'));
  assert.ok(surfacesReach('dashboard', 'store'));
  assert.ok(!surfacesReach('store', 'dashboard'));
  assert.ok(!surfacesReach('dashboard', 'dock'));
  assert.ok(!surfacesReach(undefined, 'dashboard'));
});

test('no config reads the store alone', () => {
  assert.equal(readUserConfig().surfaces, 'store');
});

test('a first init with no answer (no terminal) is the store alone and starts no dashboard', () => {
  const lines = init({ cwd: project, start: true });
  assert.match(cfgText(), /^surfaces: store$/m);
  assert.ok(lines.some((l) => l.startsWith('surfaces: store, ')));
  assert.ok(!lines.some((l) => l.startsWith('dashboard:')), 'no dashboard started');
  assert.ok(!fs.existsSync(path.join(home, 'serve.json')));
});

test('the brief names no dashboard with the store alone, and does from the dashboard up', () => {
  assert.doesNotMatch(briefFor('store'), /pjman start/);
  assert.equal(briefFor('dashboard'), BRIEF);
  assert.equal(briefFor('dock'), BRIEF);
  assert.match(BRIEF, /the dashboard: `pjman start`/);
});

test('doctor says the store runs alone and points at configure', () => {
  const f = doctor({ path: '', processes: () => [], answers: () => false }).filter((x) => x.area === 'dashboard');
  assert.ok(f.some((x) => x.message.startsWith('surfaces: store (the store alone; pjman configure')));
  assert.ok(f.some((x) => x.message === 'no dashboard is running'));
});

test('configure sets the answer, reports the change, and keeps it on a run with none', () => {
  const r = configure({ surfaces: 'dashboard' });
  assert.deepEqual([r.was, r.surfaces, r.changed], ['store', 'dashboard', true]);
  assert.match(cfgText(), /^surfaces: dashboard$/m);
  const kept = configure({});
  assert.deepEqual([kept.surfaces, kept.changed], ['dashboard', false]);
  configure({ surfaces: 'store' });
});

test('a later init keeps the answer, and --surfaces changes it', () => {
  configure({ surfaces: 'dock' });
  init({ cwd: project });
  assert.equal(readUserConfig().surfaces, 'dock');
  init({ cwd: project, surfaces: 'store' });
  assert.equal(readUserConfig().surfaces, 'store');
});

test('a config an earlier pjman wrote, with no answer, keeps the dock; an answer that is no rung is the store', () => {
  const text = cfgText().replace(/^surfaces:.*\n/m, '');
  fs.writeFileSync(userConfigPath(), text);
  assert.equal(readUserConfig().surfaces, 'dock');
  // the next write of the config puts the answer down in words
  configure({});
  assert.match(cfgText(), /^surfaces: dock$/m);
  fs.writeFileSync(userConfigPath(), text + 'surfaces: everything\n');
  assert.equal(readUserConfig().surfaces, 'store');
  configure({ surfaces: 'store' });
});

test('--surfaces takes only the rungs', () => {
  assert.equal(surfacesFlag(undefined), undefined);
  assert.equal(surfacesFlag('dock'), 'dock');
  assert.throws(() => surfacesFlag('all'), /--surfaces takes store, dashboard, dock/);
});
