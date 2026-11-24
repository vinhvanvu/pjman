// pjman configure: what runs beside the store, as one ladder (change:store-first-surfaces). The store is the product;
// the dashboard and the dock are opted into here or at init (decision store-first-surfaces/dock-and-dashboard).

import fs from 'node:fs';
import { SURFACES, type Surfaces, readUserConfig, surfacesOf, userConfigPath, writeUserConfig } from '../store/config.js';
import { CliError } from '../store/util.js';

/** What each rung runs, one line each, as the question and the report print them. */
export const SURFACE_LINES: Record<Surfaces, string> = {
  store: 'the record and the agent’s guidance, nothing running beside it',
  dashboard: 'also the dashboard in a browser (pjman start)',
  dock: 'also the dashboard beside each session (a cmux pane, the desktop app’s follow window)',
};

/** The surfaces question on the terminal; `dflt` when stdin is not a terminal or the answer is empty. */
export function askSurfaces(dflt: Surfaces): Surfaces {
  if (!process.stdin.isTTY) return dflt;
  const lines = SURFACES.map((s, i) => `  ${i + 1}. ${s.padEnd(9)} ${SURFACE_LINES[s]}`);
  for (;;) {
    process.stdout.write(
      `What runs beside the store?\n${lines.join('\n')}\nChoose [${SURFACES.indexOf(dflt) + 1}]: `,
    );
    const buf = Buffer.alloc(256);
    let n = 0;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch {
      return dflt;
    }
    const a = buf.toString('utf8', 0, n).trim().toLowerCase();
    if (!a) return dflt;
    const picked = surfacesOf(a) ?? SURFACES[Number(a) - 1];
    if (picked) return picked;
    process.stdout.write(`'${a}' is none of 1-3 or ${SURFACES.join(', ')}\n`);
  }
}

/** A --surfaces flag read, refused when it is none of the rungs. */
export function surfacesFlag(v: string | undefined): Surfaces | undefined {
  if (v === undefined) return undefined;
  const s = surfacesOf(v);
  if (!s) throw new CliError(`--surfaces takes ${SURFACES.join(', ')}`);
  return s;
}

export interface ConfigureResult {
  surfaces: Surfaces;
  /** The answer before this run. */
  was: Surfaces;
  changed: boolean;
  config: string;
}

/** Set what runs beside the store: the answer given, else the one asked on a terminal, else the current one kept. */
export function configure(opts: { surfaces?: Surfaces; ask?: boolean }): ConfigureResult {
  const user = readUserConfig();
  const was = user.surfaces ?? 'store';
  const asked = !opts.surfaces && opts.ask && process.stdin.isTTY;
  const surfaces = opts.surfaces ?? (asked ? askSurfaces(was) : was);
  // written even when unchanged, so a config an earlier pjman wrote gets its answer down in words; but a read with no
  // answer never creates the config, so the first init still asks
  if (opts.surfaces || asked || fs.existsSync(userConfigPath())) {
    user.surfaces = surfaces;
    writeUserConfig(user);
  }
  return { surfaces, was, changed: surfaces !== was, config: userConfigPath() };
}
