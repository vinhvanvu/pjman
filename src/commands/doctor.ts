// pjman doctor: what is wrong with this install, read-only (change:pjman-19). One line per finding, each with the command
// that fixes it; pjman init makes the fixes, doctor only reports. Exit 1 when anything is off.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globalStore, readUserConfig, userDir } from '../config.js';
import { loadStore } from '../records.js';
import { readServeAddress, serveAddressPath } from '../server.js';
import { summarise, validate } from '../validate.js';
import { TOOL_VERSION } from '../version.js';
import { knownMarketplace } from './init.js';
import { describeMigration, pendingMigration } from './migrate.js';
import { stableRoot } from './start.js';

export type Area = 'binary' | 'plugin' | 'sessions' | 'hook' | 'dashboard' | 'store' | 'config';
export interface Finding {
  area: Area;
  /** ok: nothing to do; warn: works, but not as it should; error: broken. */
  level: 'ok' | 'warn' | 'error';
  message: string;
  /** The command (or act) that fixes it; absent when nothing is off. */
  fix?: string;
}

export interface DoctorOpts {
  /** The PATH searched for pjman (default: the environment's). */
  path?: string;
  /** Claude Code's config folder (default: CLAUDE_CONFIG_DIR or ~/.claude). */
  claudeDir?: string;
  /** Claude Code processes and when each started (tests pass fakes; default: ps). */
  processes?: () => { pid: number; started: Date }[];
  /** Whether a URL answers (tests pass fakes; default: a fetch with a short timeout, in a child). */
  answers?: (url: string) => boolean;
}

const claudeDirOf = (o: DoctorOpts) => o.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

type Binary = { file: string; real: string; version: string | null };
const found = new Map<string, Binary[]>(); // one doctor run asks each copy its version once

/** Every pjman on the PATH, in the order the shell finds them, with the version each reports. */
function binaries(searchPath: string): Binary[] {
  const cached = found.get(searchPath);
  if (cached) return cached;
  const seen = new Set<string>();
  const out: Binary[] = [];
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, 'pjman');
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      continue;
    }
    let version: string | null = null;
    try {
      version = execFileSync(file, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim().replace(/^pjman\s+/, '');
    } catch {
      // a broken copy reports no version; it is still a copy on the PATH
    }
    out.push({ file, real: real(file) ?? file, version });
  }
  found.set(searchPath, out);
  return out;
}

function checkBinary(o: DoctorOpts): Finding[] {
  const copies = binaries(o.path ?? process.env.PATH ?? '');
  if (!copies.length) return [{ area: 'binary', level: 'error', message: 'no pjman on the PATH', fix: 'npm install -g @vinhvanvu/pjman, or brew install vinhvanvu/pjman/pjman' }];
  const [first, ...rest] = copies;
  const out: Finding[] = [{ area: 'binary', level: 'ok', message: `${first.file} runs pjman ${first.version ?? '(no version reported)'}` }];
  const others = rest.filter((b) => b.real !== first.real);
  for (const b of others) {
    out.push({
      area: 'binary',
      level: 'warn',
      message: `${b.file} (pjman ${b.version ?? '?'}) is shadowed by ${first.file} (pjman ${first.version ?? '?'})`,
      fix: /node_modules/.test(first.real) ? 'npm uninstall -g @vinhvanvu/pjman (or pjman) if you keep the other, then pjman init' : `remove the copy you do not use (${b.file}), then pjman init`,
    });
  }
  return out;
}

function checkPlugin(o: DoctorOpts): Finding[] {
  const dir = claudeDirOf(o);
  const market = knownMarketplace(dir);
  if (!market) return [{ area: 'plugin', level: 'warn', message: 'the Claude Code plugin is not registered', fix: 'pjman init (with claude on the PATH)' }];
  const out: Finding[] = [];
  // the install the plugin should follow is the pjman the person runs: the first on the PATH (bin/pjman.js under its
  // package), else this one
  const first = binaries(o.path ?? process.env.PATH ?? '')[0];
  const here = stableRoot(first && /\/bin\/pjman\.js$/.test(first.real) ? path.dirname(path.dirname(first.real)) : undefined);
  if (!fs.existsSync(market)) out.push({ area: 'plugin', level: 'error', message: `the plugin marketplace reads ${market}, which is gone`, fix: 'pjman init' });
  else if (/\/Cellar\/[^/]+\/[^/]+\//.test(market)) out.push({ area: 'plugin', level: 'warn', message: `the plugin marketplace reads a versioned Homebrew folder (${market}); brew upgrade removes it`, fix: 'pjman init' });
  else if (real(market) !== real(here)) out.push({ area: 'plugin', level: 'warn', message: `the plugin marketplace reads another install (${market}), not the pjman on the PATH (${here})`, fix: 'pjman init' });
  else out.push({ area: 'plugin', level: 'ok', message: `the plugin marketplace reads the pjman on the PATH (${market})` });
  const installed = readJson<{ plugins?: Record<string, { version?: string; lastUpdated?: string }[]> }>(path.join(dir, 'plugins', 'installed_plugins.json'))?.plugins?.['pjman@pjman']?.[0];
  if (!installed) out.push({ area: 'plugin', level: 'warn', message: 'the pjman plugin is not installed from the marketplace', fix: 'pjman init' });
  else if (installed.version !== TOOL_VERSION) out.push({ area: 'plugin', level: 'warn', message: `the installed plugin is ${installed.version ?? '?'}, the tool ${TOOL_VERSION}`, fix: 'pjman init (or start a new Claude Code session: the plugin refreshes itself)' });
  else out.push({ area: 'plugin', level: 'ok', message: `the installed plugin is ${installed.version}, as the tool` });
  return out;
}

/** Claude Code processes, from ps: each one's pid and start time. */
function claudeProcesses(): { pid: number; started: Date }[] {
  try {
    const ps = execFileSync('ps', ['-Ao', 'pid=,lstart=,comm='], { encoding: 'utf8', timeout: 5000 });
    return ps
      .split('\n')
      .map((l) => /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m && /(^|\/)claude$/.test(m[3].trim()))
      .map((m) => ({ pid: Number(m[1]), started: new Date(m[2]) }));
  } catch {
    return [];
  }
}

function checkSessions(o: DoctorOpts): Finding[] {
  const installed = readJson<{ plugins?: Record<string, { lastUpdated?: string; installedAt?: string }[]> }>(path.join(claudeDirOf(o), 'plugins', 'installed_plugins.json'))?.plugins?.['pjman@pjman']?.[0];
  const since = installed?.lastUpdated ?? installed?.installedAt;
  if (!since) return [];
  const at = new Date(since);
  const older = (o.processes ?? claudeProcesses)().filter((p) => p.started < at);
  if (!older.length) return [{ area: 'sessions', level: 'ok', message: 'every running Claude Code session started after the plugin was last installed or refreshed' }];
  return [{ area: 'sessions', level: 'warn', message: `${older.length} Claude Code ${older.length === 1 ? 'process' : 'processes'} started before the plugin was refreshed (${at.toISOString()}) and may run the older hooks: pid ${older.map((p) => p.pid).join(', ')}`, fix: 'restart those sessions, or run /reload-plugins in each' }];
}

function checkHook(): Finding[] {
  const dir = path.join(userDir(), 'claude-code');
  if (!fs.existsSync(dir)) return [{ area: 'hook', level: 'ok', message: `no adapter files yet (${dir}); the first session creates them` }];
  const out: Finding[] = [];
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    out.push({ area: 'hook', level: 'ok', message: `the adapter's folder is writable (${dir})` });
  } catch {
    out.push({ area: 'hook', level: 'error', message: `the adapter's folder is not writable (${dir})`, fix: `chmod u+w ${dir}` });
  }
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(path.join(dir, 'hook.log'), 'utf8').split('\n');
  } catch {
    return out;
  }
  const day = Date.now() - 24 * 3600_000;
  const errors = lines.filter((l) => /failed|did not|error/i.test(l) && Date.parse(l.slice(0, l.indexOf(' '))) >= day);
  if (errors.length) out.push({ area: 'hook', level: 'warn', message: `${errors.length} hook ${errors.length === 1 ? 'error' : 'errors'} in the last day; the latest: ${errors[errors.length - 1].slice(0, 200)}`, fix: `read ${path.join(dir, 'hook.log')}` });
  return out;
}

/** Whether a URL answers within a few seconds; run in a child so the command stays synchronous. */
function answers(url: string): boolean {
  try {
    execFileSync(process.execPath, ['-e', `fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(2500) }).then(() => process.exit(0), () => process.exit(1))`], { stdio: 'ignore', timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

function checkDashboard(o: DoctorOpts): Finding[] {
  const file = serveAddressPath();
  if (!fs.existsSync(file)) return [{ area: 'dashboard', level: 'ok', message: 'no dashboard is running (pjman start starts one)' }];
  const a = readServeAddress();
  if (!a) return [{ area: 'dashboard', level: 'warn', message: `${file} names a dashboard whose process is gone`, fix: 'pjman start' }];
  if (!(o.answers ?? answers)(`${a.url}/api/v1`)) return [{ area: 'dashboard', level: 'error', message: `the dashboard (pid ${a.pid}) does not answer at ${a.url}`, fix: 'pjman stop && pjman start' }];
  return [{ area: 'dashboard', level: 'ok', message: `the dashboard answers at ${a.url} (pid ${a.pid})` }];
}

function checkStore(): Finding[] {
  const store = globalStore();
  if (!store) return [{ area: 'store', level: 'warn', message: 'no global store', fix: 'pjman init' }];
  const out: Finding[] = [];
  try {
    const s = summarise(validate(loadStore(store)));
    out.push(s.errors ? { area: 'store', level: 'error', message: `the store has ${s.errors} validation ${s.errors === 1 ? 'error' : 'errors'}`, fix: 'pjman validate' } : { area: 'store', level: 'ok', message: `the store validates (${store.root})` });
  } catch (e) {
    out.push({ area: 'store', level: 'error', message: `the store could not be read: ${(e as Error).message.split('\n')[0]}`, fix: 'pjman validate' });
  }
  const pending = pendingMigration(store);
  if (pending) out.push({ area: 'store', level: 'warn', message: `the store waits for ${describeMigration(pending)}`, fix: 'pjman migrate (until it reports nothing to migrate)' });
  return out;
}

function checkConfig(): Finding[] {
  const cfg = readUserConfig();
  const gone = cfg.stores.flatMap((s) => s.projects.map((p) => p.path)).filter((p) => !fs.existsSync(p));
  const out: Finding[] = [];
  if (!cfg.actor) out.push({ area: 'config', level: 'warn', message: 'no actor in the user config', fix: 'pjman init' });
  for (const p of gone) out.push({ area: 'config', level: 'warn', message: `a registered project folder is gone: ${p}`, fix: `remove it from ${path.join(userDir(), 'config.yaml')}, or pjman init where it moved` });
  if (!out.length) out.push({ area: 'config', level: 'ok', message: 'every registered project folder exists' });
  return out;
}

/** Every check, in the order the issue named them. Writes nothing. */
export function doctor(o: DoctorOpts = {}): Finding[] {
  found.clear();
  return [...checkBinary(o), ...checkPlugin(o), ...checkSessions(o), ...checkHook(), ...checkDashboard(o), ...checkStore(), ...checkConfig()];
}

export function formatFindings(findings: Finding[], all = false): string[] {
  const mark = { ok: 'ok   ', warn: 'warn ', error: 'error' };
  const shown = all ? findings : findings.filter((f) => f.level !== 'ok');
  const lines = shown.map((f) => `${mark[f.level]} ${f.area}: ${f.message}${f.fix ? ` — fix: ${f.fix}` : ''}`);
  const off = findings.filter((f) => f.level !== 'ok').length;
  lines.push(off ? `${off} ${off === 1 ? 'thing' : 'things'} to fix` : `nothing to fix (${findings.length} checks)`);
  return lines;
}
