#!/usr/bin/env node
// The scale bench: `npm run bench -- 1 10 100` generates a store at each scale and prints every read's time.
// Stores are written under the system's temporary folder (or BENCH_DIR) and kept for a second look.
import os from 'node:os';
import path from 'node:path';
import { bench } from '../dist/bench/run.js';

const scales = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0);
const dir = process.env.BENCH_DIR ?? path.join(os.tmpdir(), 'pjman-bench');
const results = [];
for (const scale of scales.length ? scales : [1, 10]) {
  const r = await bench(path.join(dir, `x${scale}`), scale, { cli: process.env.BENCH_CLI !== '0' });
  results.push(r);
  console.error(`x${scale}: ${r.records} records, ${r.events} events`);
}
const names = results[0].timings.map((t) => t.name);
const w = Math.max(...names.map((n) => n.length));
console.log(`${''.padEnd(w)}  ${results.map((r) => `x${r.scale}`.padStart(9)).join('')}`);
for (const n of names)
  console.log(
    `${n.padEnd(w)}  ${results.map((r) => `${r.timings.find((t) => t.name === n).ms.toFixed(0)}ms`.padStart(9)).join('')}`,
  );
