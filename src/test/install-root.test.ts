// The plugin is registered where the install stays across upgrades (change:pjman-18): a package under a Homebrew
// Cellar's versioned folder is named through the opt link brew repoints, any other path is its own name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { installClaudeAdapter } from '../cli/init.js';
import { stableRoot } from '../cli/start.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-root-')));
const pkg = 'libexec/lib/node_modules/@vinhvanvu/pjman';

test('a Cellar path is named through the opt link that leads to it', () => {
  const prefix = tmp();
  const keg = path.join(prefix, 'Cellar', 'pjman', '0.3.1');
  fs.mkdirSync(path.join(keg, pkg), { recursive: true });
  fs.mkdirSync(path.join(prefix, 'opt'), { recursive: true });
  fs.symlinkSync('../Cellar/pjman/0.3.1', path.join(prefix, 'opt', 'pjman'));
  assert.equal(stableRoot(path.join(keg, pkg)), path.join(prefix, 'opt', 'pjman', pkg));
});

test('a Cellar path whose opt link leads to another version stays as it is', () => {
  const prefix = tmp();
  for (const v of ['0.3.1', '0.3.2']) fs.mkdirSync(path.join(prefix, 'Cellar', 'pjman', v, pkg), { recursive: true });
  fs.mkdirSync(path.join(prefix, 'opt'), { recursive: true });
  fs.symlinkSync('../Cellar/pjman/0.3.2', path.join(prefix, 'opt', 'pjman'));
  const old = path.join(prefix, 'Cellar', 'pjman', '0.3.1', pkg);
  assert.equal(stableRoot(old), old);
});

test('a Cellar path with no opt link, and any other path, stay as they are', () => {
  const prefix = tmp();
  const keg = path.join(prefix, 'Cellar', 'pjman', '0.3.1', pkg);
  fs.mkdirSync(keg, { recursive: true });
  assert.equal(stableRoot(keg), keg);
  const npm = path.join(prefix, 'lib', 'node_modules', '@vinhvanvu', 'pjman');
  fs.mkdirSync(npm, { recursive: true });
  assert.equal(stableRoot(npm), npm);
  assert.equal(stableRoot(path.join(prefix, 'gone')), path.join(prefix, 'gone'));
});

// init repoints a marketplace left by another install (change:pjman-15), carrying the adapter's files out of the plugin
// data folder first; a checkout replaces only one whose folder is gone. `claude` is a fake that records its calls.
test('init replaces a marketplace whose folder is gone and carries the adapter files across; one that exists is left to the install', () => {
  const dir = tmp();
  const calls = path.join(dir, 'calls');
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'claude'), `#!/bin/sh\necho "$*" >> ${calls}\n`, { mode: 0o755 });
  const cfg = path.join(dir, 'claude');
  fs.mkdirSync(path.join(cfg, 'plugins', 'data', 'pjman-pjman', 'state'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'plugins', 'data', 'pjman-pjman', 'state', 's1.json'), '{"pane":"p1"}');
  const known = (p: string) => fs.writeFileSync(path.join(cfg, 'plugins', 'known_marketplaces.json'), JSON.stringify({ pjman: { source: { source: 'directory', path: p } } }));
  const saved = { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PJMAN_HOME: process.env.PJMAN_HOME };
  Object.assign(process.env, { PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: cfg, PJMAN_HOME: path.join(dir, 'home') });
  try {
    known(path.join(dir, 'gone'));
    const out = installClaudeAdapter();
    assert.match(out, /now loads from .* \(it read .*gone\)/);
    const log = fs.readFileSync(calls, 'utf8');
    assert.match(log, /plugin marketplace remove pjman\n.*plugin marketplace add /);
    assert.equal(fs.readFileSync(path.join(dir, 'home', 'claude-code', 'state', 's1.json'), 'utf8'), '{"pane":"p1"}');
    fs.rmSync(calls);
    const other = path.join(dir, 'other-install');
    fs.mkdirSync(other);
    known(other);
    assert.doesNotMatch(installClaudeAdapter(), /now loads from/);
    assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /marketplace remove/, 'a checkout never takes over an install that exists');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
