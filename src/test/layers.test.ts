// The source is in layers, each importing only from those below it (decision repo-hygiene/src-layers):
// store ← hosts ← entire ← model ← ops ← sync ← server ← cli (entire, the one module that talks to Entire, sits low
// so every layer above may call it: change:entire-adapter). A layer may import its own modules; an import that reaches up
// is refused here, naming the file and what it imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYERS = ['store', 'hosts', 'entire', 'model', 'ops', 'sync', 'server', 'cli'] as const;
const rank = (layer: string): number => LAYERS.indexOf(layer as (typeof LAYERS)[number]);

// the tests run from dist/test; the source sits two folders up, under src/
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

test('every layer imports only from layers below it', () => {
  const upward: string[] = [];
  for (const layer of LAYERS) {
    const dir = path.join(SRC, layer);
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const file = path.join(dir, name);
      for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
        const target = path.relative(SRC, path.resolve(dir, spec)).split(path.sep)[0];
        if (rank(target) > rank(layer)) upward.push(`${layer}/${name} imports ${spec} (${target} is above ${layer})`);
      }
    }
  }
  assert.deepEqual(upward, []);
});

test('the source holds only the layers and the tests', () => {
  const entries = fs.readdirSync(SRC).toSorted();
  assert.deepEqual(entries, [...LAYERS, 'test'].toSorted());
});

test('the package ships every layer', () => {
  // a layer left out of `files` builds and tests here, and is missing from the installed tool
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8')) as { files: string[] };
  assert.deepEqual(
    LAYERS.filter((l) => !pkg.files.includes(`dist/${l}`)),
    [],
  );
});
