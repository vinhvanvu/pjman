// pjman configure: what runs beside the store, as one ladder (change:store-first-surfaces). The store is the product;
// the dashboard and the dock are opted into here or at init (decision store-first-surfaces/dock-and-dashboard).

import fs from 'node:fs';
import {
  SURFACES,
  type Surfaces,
  readUserConfig,
  surfacesOf,
  surfacesReach,
  userConfigPath,
  writeUserConfig,
} from '../store/config.js';
import { CliError } from '../store/util.js';
import { refreshInstalledBriefs } from './brief.js';
import { readServeAddress } from '../server/server.js';

/** What each rung runs, one line each, as the question and the report print them. */
export const SURFACE_LINES: Record<Surfaces, string> = {
  store: 'the record and the agent’s guidance, nothing running beside it',
  dashboard: 'also the dashboard in a browser (pjman start)',
  dock: 'also the dashboard beside each session (a cmux pane, the desktop app’s follow window)',
};

/** One line read from the terminal, or null when it cannot be read. */
function readLine(): string | null {
  const buf = Buffer.alloc(256);
  try {
    return buf.toString('utf8', 0, fs.readSync(0, buf, 0, buf.length, null));
  } catch {
    return null;
  }
}

/** The surfaces question; `dflt` when the answer is empty or cannot be read. `typed` says the person named a rung, so a
 *  typed dock is told from Enter keeping it. `read` stands in for the terminal (tests). */
export function askSurfaces(
  dflt: Surfaces,
  read: () => string | null = readLine,
): { surfaces: Surfaces; typed: boolean } {
  const lines = SURFACES.map((s, i) => `  ${i + 1}. ${s.padEnd(9)} ${SURFACE_LINES[s]}`);
  for (;;) {
    process.stdout.write(`What runs beside the store?\n${lines.join('\n')}\nChoose [${SURFACES.indexOf(dflt) + 1}]: `);
    const a = read()?.trim().toLowerCase();
    if (!a) return { surfaces: dflt, typed: false };
    const picked = surfacesOf(a) ?? SURFACES[Number(a) - 1];
    if (picked) return { surfaces: picked, typed: true };
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
  /** The finer switches an earlier config held that the dock answer cleared (`dock: false`, `follow_window: false`). */
  cleared: string[];
  /** The always-on files whose brief was rewritten for the new answer. */
  briefs: string[];
  /** The answer before this run. */
  was: Surfaces;
  changed: boolean;
  /** The answer went below the dashboard while one runs: it keeps running until pjman stop. */
  stillRunning: boolean;
  config: string;
}

/** Set what runs beside the store: the answer given, else the one asked on a terminal, else the current one kept. */
export function configure(opts: {
  surfaces?: Surfaces;
  ask?: boolean;
  /** Stands in for the terminal when asking (tests). */
  read?: () => string | null;
}): ConfigureResult {
  const user = readUserConfig();
  const was = user.surfaces ?? 'store';
  const asked = !opts.surfaces && opts.ask && (opts.read !== undefined || process.stdin.isTTY);
  const answer = asked ? askSurfaces(was, opts.read) : null;
  const surfaces = opts.surfaces ?? answer?.surfaces ?? was;
  // the dock answered in so many words (the flag, or typed on the terminal) is the whole dock: the finer switches an
  // earlier config turned off go with it. Enter on the dock an earlier pjman ran keeps them.
  const cleared: string[] = [];
  if (surfaces === 'dock' && (opts.surfaces || answer?.typed)) {
    if (user.dock === false) {
      delete user.dock;
      cleared.push('dock: false');
    }
    if (user.follow_window === false) {
      delete user.follow_window;
      cleared.push('follow_window: false');
    }
  }
  // written even when unchanged, so a config an earlier pjman wrote gets its answer down in words; but a read with no
  // answer never creates the config, so the first init still asks
  if (opts.surfaces || asked || fs.existsSync(userConfigPath())) {
    user.surfaces = surfaces;
    writeUserConfig(user);
  }
  const changed = surfaces !== was;
  return {
    surfaces,
    was,
    changed,
    cleared,
    briefs: changed ? refreshInstalledBriefs() : [],
    stillRunning: changed && !surfacesReach(surfaces, 'dashboard') && readServeAddress() !== null,
    config: userConfigPath(),
  };
}

/** What a configure run did beyond the answer, one line each, as configure and init print it. */
export function configureLines(r: ConfigureResult): string[] {
  return [
    ...(r.cleared.length ? [`cleared ${r.cleared.join(', ')}: the dock answer turns the whole dock on`] : []),
    ...r.briefs.map((b) => `rewrote the brief in ${b}`),
    ...(r.stillRunning ? ['a dashboard is still running; pjman stop stops it'] : []),
  ];
}
