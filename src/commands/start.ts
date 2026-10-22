// pjman start / stop: the dashboard server, detached, with the app's packages installed and the app built when needed.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultStaticDir, readServeAddress, serveAddressPath, type ServeAddress } from '../server.js';
import { CliError } from '../util.js';

/** The tool's own checkout or install root (dist/commands → root). */
export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** True when the dashboard's built assets exist, building them from ui/ when the checkout has the source but no build. */
export function ensureUi(log: (line: string) => void = () => {}): boolean {
  if (defaultStaticDir()) return true;
  const ui = path.join(packageRoot(), 'ui');
  if (!fs.existsSync(path.join(ui, 'package.json'))) return false;
  try {
    if (!fs.existsSync(path.join(ui, 'node_modules'))) {
      log("installing the dashboard's packages…");
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ui, stdio: 'ignore' });
    }
    log('building the dashboard…');
    execFileSync('npm', ['run', 'build'], { cwd: ui, stdio: 'ignore' });
  } catch (e) {
    log(`the dashboard could not be built (${(e as Error).message.split('\n')[0]}); the API still serves`);
  }
  return defaultStaticDir() !== null;
}

export interface StartOpts {
  cwd: string;
  port?: number;
  /** Build the app when missing (default true). */
  ui?: boolean;
  log?: (line: string) => void;
}

/** Start the server detached unless one is running; resolve its address. Idempotent. */
export function start(opts: StartOpts): { address: ServeAddress; started: boolean; ui: boolean } {
  const log = opts.log ?? (() => {});
  const running = readServeAddress();
  if (running) return { address: running, started: false, ui: defaultStaticDir() !== null };
  const ui = opts.ui === false ? defaultStaticDir() !== null : ensureUi(log);
  const bin = path.join(packageRoot(), 'bin', 'pjman.js');
  const args = [bin, 'serve'];
  if (opts.port) args.push('--port', String(opts.port));
  const child = spawn(process.execPath, args, { cwd: opts.cwd, detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let waited = 0; waited < 8000; waited += 100) {
    const a = readServeAddress();
    if (a) return { address: a, started: true, ui };
    sleep(100);
  }
  throw new CliError('the server did not start in time; run `pjman serve` in the foreground to see why');
}

/** Stop the running server; null when none was running. */
export function stop(): ServeAddress | null {
  const a = readServeAddress();
  if (!a) {
    fs.rmSync(serveAddressPath(), { force: true });
    return null;
  }
  try {
    process.kill(a.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  for (let waited = 0; waited < 3000; waited += 100) {
    try {
      process.kill(a.pid, 0);
      sleep(100);
    } catch {
      break;
    }
  }
  fs.rmSync(serveAddressPath(), { force: true });
  return a;
}
