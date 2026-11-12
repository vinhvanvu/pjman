// The scale budget (change:dashboard-reads-slow): a generated store ten times this project's own, every read the
// dashboard makes asked through the server, and the CLI's cold calls. The budgets sit well above what the bench reads
// on a laptop and far below what a scan per node or a parse per read costs, so a regression of either kind fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { bench } from '../bench/run.js';

const BUDGET = {
  /** A read asked again with nothing written between: served from the held store and its lookups. */
  again: 150,
  /** A read after a write: the store loaded again from the index and the page's lookups built again. */
  afterWrite: 1000,
  /** A cold CLI call, as a hook makes one: the process, the index, the command. */
  cli: 2000,
};

test('at ten times this project, every read stays inside its budget', { timeout: 300_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pjman-scale-'));
  const home = process.env.PJMAN_HOME;
  try {
    const r = await bench(path.join(root, 'x10'), 10);
    const over = r.timings.filter((t) => {
      if (t.name.endsWith(' again')) return t.ms > BUDGET.again;
      if (t.name.endsWith(' after a write')) return t.ms > BUDGET.afterWrite;
      if (t.name.startsWith('cli ')) return t.ms > BUDGET.cli;
      return false;
    });
    assert.deepEqual(
      over.map((t) => `${t.name}: ${t.ms.toFixed(0)}ms`),
      [],
    );
  } finally {
    if (home === undefined) delete process.env.PJMAN_HOME;
    else process.env.PJMAN_HOME = home;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
