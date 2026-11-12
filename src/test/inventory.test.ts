import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { describeInventory, inventory, mapGuidance } from '../model/inventory.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-inventory-'));
const make = (name: string, files: Record<string, string>): string => {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
};

test('a repository with nothing but a short README, a licence and git is bare', () => {
  const dir = make('bare', { 'README.md': '# astro\n\nnpm install\n', LICENSE: 'MIT', '.git/HEAD': 'ref: refs/heads/main' });
  const inv = inventory(dir);
  assert.deepEqual(inv, { holds: 'bare', docs: [], code: [] });
  assert.equal(describeInventory(inv), 'nothing yet');
  assert.match(mapGuidance('bare'), /grows from the work/);
});

test('documentation alone: a README that says more than a title, a docs folder, a spec at the top', () => {
  const dir = make('docs', { 'README.md': '# astro\n\n' + 'Astro schedules the observatory: the dome, the instruments, the nights.\n'.repeat(6), 'docs/design.md': '# design', 'docs/adr/0001.md': '# adr', 'SPEC.md': '# spec', 'CHANGELOG.md': '# changes', 'CONTRIBUTING.md': '# how' });
  const inv = inventory(dir);
  assert.equal(inv.holds, 'docs');
  assert.deepEqual(inv.docs, ['README.md', 'docs/ (2 files)', 'SPEC.md']);
  assert.deepEqual(inv.code, []);
  assert.equal(describeInventory(inv), 'docs (README.md, docs/ (2 files), SPEC.md)');
});

test('code alone: a manifest first, then the directories that hold source; node_modules and dist are not looked at', () => {
  const dir = make('code', { 'package.json': '{}', 'src/index.ts': 'export {}', 'src/lib/util.ts': 'export {}', 'ui/src/App.tsx': 'export {}', 'node_modules/x/index.js': '', 'dist/index.js': '', 'README.md': '# code\n' });
  const inv = inventory(dir);
  assert.equal(inv.holds, 'code');
  assert.deepEqual(inv.code, ['package.json', 'src/', 'ui/']);
  assert.deepEqual(inv.docs, []);
  assert.match(mapGuidance('code'), /code's split/);
});

test('both: the documentation and the code, the better proposal', () => {
  const dir = make('both', { 'README.md': 'x'.repeat(400), 'go.mod': 'module x', 'cmd/astro/main.go': 'package main', 'docs/guide.md': '# guide' });
  const inv = inventory(dir);
  assert.equal(inv.holds, 'docs+code');
  assert.equal(describeInventory(inv), 'docs and code (README.md, docs/ (1 file); go.mod, cmd/)');
  assert.match(mapGuidance('docs+code'), /both/);
});

test('a directory that does not exist is bare', () => {
  assert.equal(inventory(path.join(tmp, 'nowhere')).holds, 'bare');
});

test('a manifest named like a text file is code, not docs; a tooling folder of a script or two is not code', () => {
  const cmake = inventory(make('cmake', { 'CMakeLists.txt': 'project(x)', 'src/main.cpp': 'int main() {}' }));
  assert.deepEqual([cmake.holds, cmake.docs, cmake.code], ['code', [], ['CMakeLists.txt', 'src/']]);
  const py = inventory(make('py', { 'requirements.txt': 'flask', 'README.md': '# x\n' }));
  assert.deepEqual([py.holds, py.code], ['code', ['requirements.txt']]);
  const docsOnly = inventory(make('docs-tooling', { 'README.md': 'x'.repeat(400), 'docs/a.md': '# a', 'scripts/build.sh': 'echo', '.github/workflows/ci.yml': 'on: push' }));
  assert.deepEqual([docsOnly.holds, docsOnly.code], ['docs', []]);
  const shell = inventory(make('shell', { 'bin/a.sh': '', 'bin/b.sh': '', 'bin/c.sh': '' }));
  assert.deepEqual([shell.holds, shell.code], ['code', ['bin/']], 'a product of scripts is code');
});
