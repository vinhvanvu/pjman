// The one place pjman talks to Entire (change:entire-adapter; decision entire-opt-in/wrapper, verbs). Entire is an
// opt-in per project (`ext.entire.enabled` on the project record): off, nothing here spawns and pjman is as it was.
// On, every call goes through `runEntire`, which runs `entire … --json` and never throws: a call that cannot be made
// or fails answers `pending` with the reason, so no pjman write waits on Entire. What is the person's to run (login,
// enable, approve) is refused here and only ever suggested.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Loaded } from '../store/records.js';

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** Whether the project opted in to Entire: `pjman set <project> ext.entire.enabled=true`. */
export function entireOn(loaded: Loaded, project?: string): boolean {
  if (!project) return false;
  const v = obj(obj(loaded.byKey.get(project)?.[0]?.data.ext)?.entire)?.enabled;
  return v === true || v === 'true' || v === 'on';
}

export interface EntireOpts {
  /** The directory the command runs in: the project's checkout (Entire reads the repository from it). */
  cwd?: string;
  /** The entire binary (tests pass a fake; default: PJMAN_ENTIRE_BIN, else the first `entire` on the PATH). */
  bin?: string;
  /** The PATH searched for entire (default: the environment's). */
  path?: string;
  /** Milliseconds before the call is given up as pending (default 20s). */
  timeout?: number;
  /** Text handed to the command on its standard input. */
  input?: string;
  /** Leave `--json` off, for the few commands that print text only (`entire version`). */
  text?: boolean;
}

/** Why a call did not answer: no binary, the person's own command, a failure, a timeout, or output that is not JSON. */
export type PendingKind = 'missing' | 'person' | 'failed' | 'timeout' | 'unreadable';
export type EntireResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; pending: true; kind: PendingKind; reason: string };

const pending = (kind: PendingKind, reason: string): EntireResult<never> => ({
  ok: false,
  pending: true,
  kind,
  reason,
});

/** Entire's commands that are the person's: pjman suggests them and never runs them (entire agent-help says the same
 *  of its setup commands; approving a Trail is the person's as accepting a decision is). */
const PERSON_ONLY = new Set([
  'agent',
  'clean',
  'cluster',
  'configure',
  'disable',
  'enable',
  'login',
  'logout',
  'org',
  'plugin',
  'project',
  'repo',
  'service-account',
]);
const personOnly = (args: string[]): boolean => {
  const [a, b] = args;
  if (a === 'auth') return b !== 'status';
  if (a === 'trail') return b === 'approve';
  return PERSON_ONLY.has(a);
};

/** The entire binary pjman would run, or null when there is none. */
export function entireBinary(o: EntireOpts = {}): string | null {
  const named = o.bin ?? process.env.PJMAN_ENTIRE_BIN;
  if (named) return fs.existsSync(named) ? named : null;
  for (const dir of (o.path ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, 'entire');
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {
      // not in this folder
    }
  }
  return null;
}

/** Run one entire command and read its JSON. Never throws: anything short of an answer is `pending`, with the reason
 *  in a line a person can read. */
export function runEntire<T = unknown>(args: string[], o: EntireOpts = {}): EntireResult<T> {
  const said = `entire ${args.join(' ')}`;
  if (personOnly(args)) return pending('person', `${said} is yours to run; pjman never runs it`);
  const bin = entireBinary(o);
  if (!bin) return pending('missing', 'no entire on the PATH');
  let stdout: string;
  try {
    stdout = execFileSync(bin, o.text ? args : [...args, '--json'], {
      cwd: o.cwd,
      encoding: 'utf8',
      stdio: [o.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      timeout: o.timeout ?? 20_000,
      maxBuffer: 32 * 1024 * 1024,
      ...(o.input === undefined ? {} : { input: o.input }),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string | Buffer; stdout?: string | Buffer; killed?: boolean };
    if (err.code === 'ETIMEDOUT' || err.killed) return pending('timeout', `${said} did not answer in time`);
    const line = `${String(err.stderr ?? '')}\n${String(err.stdout ?? '')}`
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    return pending('failed', `${said} failed: ${(line ?? err.message).slice(0, 300)}`);
  }
  if (o.text) return { ok: true, data: stdout.trim() as T };
  try {
    return { ok: true, data: JSON.parse(stdout) as T };
  } catch {
    return pending('unreadable', `${said} answered something that is not JSON`);
  }
}

/** One line for a call left pending, as a command prints it beside its own result. */
export const pendingLine = (r: { reason: string }): string => `entire: pending (${r.reason})`;

/** The git hooks Entire installs in a repository, and the Claude Code events its hooks answer. */
export const ENTIRE_GIT_HOOKS = ['prepare-commit-msg', 'commit-msg', 'post-commit', 'post-rewrite', 'pre-push'];

export interface EntireState {
  /** The binary pjman would run, with the version it reports. */
  binary: string | null;
  version: string | null;
  /** Whether the repository has Entire turned on (`entire status`), null when it could not be asked. */
  enabled: boolean | null;
  /** The agents Entire captures in this repository. */
  agents: string[];
  /** Where checkpoints are pushed, when a dedicated repository is set. */
  checkpointRemote: string | null;
  /** Whether a login is saved, null when it could not be asked; the account's display name when there is one. */
  loggedIn: boolean | null;
  user: string | null;
  /** Entire's git hooks that are not installed in the repository. */
  missingGitHooks: string[];
  /** Entire's Claude Code hooks in the project's settings: the events they answer, and the commands that would fail
   *  a session where entire is not installed (not guarded by a `command -v entire` check). */
  claudeEvents: string[];
  unguarded: string[];
  /** What could not be asked, in Entire's words. */
  pending: string[];
}

/** The folder git reads hooks from for a checkout: `core.hooksPath`, else the common git dir's `hooks`. */
function hooksDir(dir: string): string | null {
  try {
    const run = (a: string[]) =>
      execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let custom = '';
    try {
      custom = run(['config', '--get', 'core.hooksPath']);
    } catch {
      // unset
    }
    if (custom) return path.resolve(dir, custom);
    return path.resolve(dir, run(['rev-parse', '--git-common-dir']), 'hooks');
  } catch {
    return null;
  }
}

/** What Entire's Claude Code hooks in a project's settings answer, and which of them are not guarded. */
function claudeHooks(dir: string): { events: string[]; unguarded: string[] } {
  const events: string[] = [];
  const unguarded: string[] = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    let hooks: Record<string, unknown> | undefined;
    try {
      hooks = obj(obj(JSON.parse(fs.readFileSync(path.join(dir, '.claude', name), 'utf8')))?.hooks);
    } catch {
      continue;
    }
    for (const [event, matchers] of Object.entries(hooks ?? {})) {
      for (const m of Array.isArray(matchers) ? matchers : []) {
        const list = obj(m)?.hooks;
        for (const h of Array.isArray(list) ? list : []) {
          const command = obj(h)?.command;
          if (typeof command !== 'string' || !/\bentire hooks\b/.test(command)) continue;
          if (!events.includes(event)) events.push(event);
          if (!/command -v entire/.test(command) && !unguarded.includes(command)) unguarded.push(command);
        }
      }
    }
  }
  return { events, unguarded };
}

/** Everything pjman needs to know of Entire in one checkout: the binary, the repository's enablement, the login and
 *  both hook sets. Reads only; a question Entire did not answer is listed under `pending`. */
export function entireState(dir: string, o: EntireOpts = {}): EntireState {
  const opts = { ...o, cwd: dir };
  const binary = entireBinary(opts);
  const state: EntireState = {
    binary,
    version: null,
    enabled: null,
    agents: [],
    checkpointRemote: null,
    loggedIn: null,
    user: null,
    missingGitHooks: [],
    ...(() => {
      const c = claudeHooks(dir);
      return { claudeEvents: c.events, unguarded: c.unguarded };
    })(),
    pending: [],
  };
  const hooks = hooksDir(dir);
  state.missingGitHooks = ENTIRE_GIT_HOOKS.filter((h) => {
    try {
      return !hooks || !/\bentire hooks git\b/.test(fs.readFileSync(path.join(hooks, h), 'utf8'));
    } catch {
      return true;
    }
  });
  if (!binary) return state;
  const version = runEntire<string>(['version'], { ...opts, text: true });
  if (version.ok) state.version = /(\d+\.\d+\.\d+\S*)/.exec(version.data)?.[1] ?? null;
  const status = runEntire<Record<string, unknown>>(['status'], opts);
  if (status.ok) {
    state.enabled = status.data.enabled === true;
    state.agents = Array.isArray(status.data.agents) ? status.data.agents.map(String) : [];
    state.checkpointRemote =
      typeof status.data.checkpoint_sync_remote === 'string' ? status.data.checkpoint_sync_remote : null;
  } else state.pending.push(status.reason);
  const auth = runEntire<Record<string, unknown>>(['auth', 'status'], opts);
  if (auth.ok) {
    state.loggedIn = auth.data.logged_in === true;
    state.user = typeof auth.data.display_name === 'string' ? auth.data.display_name : null;
  } else if (/not logged in|logged out|no (saved )?login/i.test(auth.reason)) state.loggedIn = false;
  else state.pending.push(auth.reason);
  return state;
}
