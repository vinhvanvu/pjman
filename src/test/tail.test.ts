import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Store } from '../store/config.js';
import { readEvents, tailEvents } from '../store/events.js';

/** A store folder holding only a stream of `n` events, every tenth with a field long enough to cross a read's chunk. */
function streamOf(n: number): Store {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-tail-'));
  const lines: string[] = [];
  for (let i = 1; i <= n; i++) {
    const at = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
    lines.push(
      JSON.stringify({
        seq: i,
        at,
        op: 'set',
        key: `change:p/c-${i}`,
        type: 'change',
        path: `products/p/changes/c-${i}/change.md`,
        fields: i % 10 === 0 ? ['x'.repeat(i === 500 ? 200_000 : 3_000)] : ['gist'],
      }),
    );
  }
  fs.writeFileSync(path.join(root, 'events.jsonl'), lines.join('\n') + '\n');
  return { root } as Store;
}

test('the tail past a sequence number is what the whole stream holds past it', () => {
  const store = streamOf(1200);
  for (const since of [1, 499, 500, 1100, 1199]) {
    assert.deepEqual(
      tailEvents(store, { seq: since + 1 }).map((e) => e.seq),
      Array.from({ length: 1200 - since }, (_, i) => since + 1 + i),
    );
  }
  assert.deepEqual(tailEvents(store, { seq: 1201 }), []);
});

test('the tail stops only once an event is before both the number and the instant', () => {
  const store = streamOf(300);
  const at = new Date(Date.UTC(2026, 0, 1) + 100 * 60_000).toISOString();
  // the number reaches back to 250, the instant to 100: the instant holds it open
  assert.equal(tailEvents(store, { seq: 250, at })[0].seq, 100);
});

test('readEvents after a point reads the tail, and matches the whole stream', () => {
  const store = streamOf(800);
  const tail = readEvents(store, 700).map((e) => e.seq);
  const whole = readEvents(store)
    .filter((e) => e.seq > 700)
    .map((e) => e.seq);
  assert.deepEqual(tail, whole);
});
