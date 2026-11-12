// pjman doctor reports what is wrong with an install and writes nothing (change:pjman-19): each finding names the
// command that fixes it, and the run is clean only when nothing is off.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { doctor, formatFindings, type Finding } from '../cli/doctor.js';
import { TOOL_VERSION } from '../store/version.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-doctor-')));
const home = path.join(tmp, 'home');
const claude = path.join(tmp, 'claude');
const fake = (dir: string, version: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pjman'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
};
const of = (fs_: Finding[], area: Finding['area']) => fs_.filter((f) => f.area === area && f.level !== 'ok');

before(() => {
  process.env.PJMAN_HOME = home;
  delete process.env.PJMAN_SESSION;
  fs.mkdirSync(path.join(home, 'claude-code'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'config.yaml'),
    `actor: person:tester\nstores:\n  - name: global\n    path: ${path.join(home, 'store')}\n    projects:\n      - path: ${path.join(tmp, 'moved-away')}\n`,
  );
  fs.writeFileSync(
    path.join(home, 'serve.json'),
    JSON.stringify({ url: 'http://127.0.0.1:9', port: 9, pid: 2 ** 22 + 7, host: '127.0.0.1' }),
  );
  const stamp = new Date().toISOString();
  fs.writeFileSync(
    path.join(home, 'claude-code', 'hook.log'),
    `${stamp} SessionStart pjman serve did not come up in time\n2020-01-01T00:00:00.000Z SessionStart old thing failed\n`,
  );
  fs.mkdirSync(path.join(claude, 'plugins'), { recursive: true });
  fs.writeFileSync(
    path.join(claude, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({ pjman: { source: { path: path.join(tmp, 'gone') } } }),
  );
  fs.writeFileSync(
    path.join(claude, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'pjman@pjman': [{ version: '0.0.1', lastUpdated: '2026-11-10T12:00:00.000Z' }] } }),
  );
  fake(path.join(tmp, 'npm-bin'), '0.3.0');
  fake(path.join(tmp, 'brew-bin'), '0.3.1');
});

test('doctor names what is off in each area, with the command that fixes it', () => {
  const before = fs.readdirSync(home).toSorted();
  const f = doctor({
    path: `${path.join(tmp, 'npm-bin')}:${path.join(tmp, 'brew-bin')}`,
    claudeDir: claude,
    processes: () => [
      { pid: 101, started: new Date('2026-11-09T00:00:00Z') },
      { pid: 102, started: new Date('2026-11-11T00:00:00Z') },
    ],
    answers: () => false,
  });
  assert.match(
    of(f, 'binary')[0].message,
    /brew-bin\/pjman \(pjman 0\.3\.1\) is shadowed by .*npm-bin\/pjman \(pjman 0\.3\.0\)/,
  );
  const plugin = of(f, 'plugin');
  assert.match(plugin[0].message, /reads .*gone, which is gone/);
  assert.equal(plugin[0].fix, 'pjman init');
  assert.match(
    plugin[1].message,
    new RegExp(`installed plugin is 0\\.0\\.1, the tool ${TOOL_VERSION.replace(/\./g, '\\.')}`),
  );
  assert.match(of(f, 'sessions')[0].message, /1 Claude Code process started before .*pid 101$/);
  const hook = of(f, 'hook');
  assert.equal(hook.length, 1);
  assert.match(hook[0].message, /1 hook error in the last day; the latest: .*did not come up/);
  assert.match(of(f, 'dashboard')[0].message, /names a dashboard whose process is gone/);
  assert.equal(of(f, 'dashboard')[0].fix, 'pjman start');
  assert.match(of(f, 'store')[0].message, /no global store/);
  assert.match(of(f, 'config')[0].message, /registered project folder is gone: .*moved-away/);
  const lines = formatFindings(f);
  assert.match(lines[lines.length - 1], /^\d+ things to fix$/);
  assert.ok(
    lines.slice(0, -1).every((l) => / — fix: /.test(l)),
    'every line names its fix',
  );
  assert.deepEqual(fs.readdirSync(home).toSorted(), before, 'doctor writes nothing');
});

test('a dashboard that is alive but does not answer is an error; one that answers is fine', () => {
  fs.writeFileSync(
    path.join(home, 'serve.json'),
    JSON.stringify({ url: 'http://127.0.0.1:9', port: 9, pid: process.pid, host: '127.0.0.1' }),
  );
  const opts = { path: path.join(tmp, 'brew-bin'), claudeDir: claude, processes: () => [] };
  assert.equal(of(doctor({ ...opts, answers: () => false }), 'dashboard')[0].level, 'error');
  assert.equal(of(doctor({ ...opts, answers: () => true }), 'dashboard').length, 0);
});
