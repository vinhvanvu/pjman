// The plugin is registered where the install stays across upgrades (change:pjman-18): a package under a Homebrew
// Cellar's versioned folder is named through the opt link brew repoints, any other path is its own name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { stableRoot } from '../commands/start.js';

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
