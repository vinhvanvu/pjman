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
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
const project = path.join(tmp, 'project');
process.env.PJMAN_HOME = home;
process.env.PJMAN_WRITER = 'person:tester';
delete process.env.PJMAN_SESSION;
delete process.env.PJMAN_STORE;

const { readUserConfig, surfacesReach, userConfigPath } = await import('../store/config.js');
const { init } = await import('../cli/init.js');
const { configure, surfacesFlag } = await import('../cli/configure.js');
const { BRIEF, briefFor, installBrief } = await import('../cli/brief.js');
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

test('the first init writes its answer before anything that can fail, so a failed init does not lose it', () => {
  assert.throws(() => init({ cwd: project, name: '!!!', surfaces: 'dashboard' }), /does not make a project slug/);
  assert.match(cfgText(), /^surfaces: dashboard$/m);
  fs.rmSync(userConfigPath());
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

test('the dock answered clears the finer switches an earlier config turned off', () => {
  fs.writeFileSync(userConfigPath(), cfgText() + 'dock: false\nfollow_window: false\n');
  const r = configure({ surfaces: 'dock' });
  assert.deepEqual(r.cleared, ['dock: false', 'follow_window: false']);
  assert.doesNotMatch(cfgText(), /^(dock|follow_window): false$/m);
  configure({ surfaces: 'store' });
});

test('a changed answer rewrites a brief an earlier init put in the always-on file', () => {
  const file = installBrief('claude-md').path;
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /pjman start/);
  const up = configure({ surfaces: 'dashboard' });
  assert.deepEqual(up.briefs, [file]);
  assert.match(fs.readFileSync(file, 'utf8'), /the dashboard: `pjman start`/);
  assert.deepEqual(configure({ surfaces: 'dashboard' }).briefs, [], 'an unchanged answer leaves it');
  configure({ surfaces: 'store' });
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /pjman start/);
});

test('init --surfaces does what configure does: clears the dock switches, rewrites the brief', () => {
  const file = installBrief('claude-md').path;
  fs.writeFileSync(userConfigPath(), cfgText() + 'dock: false\n');
  const lines = init({ cwd: project, surfaces: 'dock' });
  assert.ok(lines.includes('cleared dock: false: the dock answer turns the whole dock on'));
  assert.ok(lines.includes(`rewrote the brief in ${file}`));
  assert.match(fs.readFileSync(file, 'utf8'), /the dashboard: `pjman start`/);
  init({ cwd: project, surfaces: 'store' });
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /pjman start/);
});

test('a configure run that answers nothing keeps the dock switches of a config an earlier pjman wrote', () => {
  const text = cfgText().replace(/^surfaces:.*\n/m, '') + 'dock: false\n';
  fs.writeFileSync(userConfigPath(), text);
  const r = configure({ ask: true });
  assert.deepEqual([r.surfaces, r.cleared], ['dock', []]);
  assert.match(cfgText(), /^dock: false$/m);
  configure({ surfaces: 'store' });
});
