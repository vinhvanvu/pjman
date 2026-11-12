// The host: where a session runs (change:rex-adapter). A terminal multiplexer, today; a cloud session later. pjman
// asks six things of a host, and each host is one implementation of the same interface, so pjman stays host-agnostic:
//   identify  the host's own ids for the session, read from the environment the hook runs in; never configured
//   version   the host's version, by its own command, so the session record says what it ran on
//   status    what the program in the session reports: idle, working, done, blocked (and why), error
//   label     a short line on the block: the change and where the work stands
//   send      text into the session, as if typed
//   open      the session's block brought to the front
//   launch    a session for a change in its worktree, named for it
//   follow    the host's events for one session, as they happen
// An adapter carries a manifest (decision rex-adapter/adapter-versioning, bundled-ranged): its environment, the
// interface version it implements and the environment version range it was validated against. The registry below is
// the only place that knows where adapters come from. With no host in the environment, every caller gets null and
// nothing changes.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { compareVersions } from '../store/version.js';

/** The version of this interface an adapter implements. */
export const HOST_INTERFACE = 1;

export interface HostManifest {
  /** The environment the adapter serves: the name the session record carries. */
  environment: string;
  /** The interface version it implements. */
  interface: number;
  /** The environment versions it was validated against, as a range: `>=0.1 <1`. */
  validated: string;
  /** The command the environment answers to, so a host's presence on this machine can be told. */
  command: string;
}

/** A host's own ids for a session: the session it runs in, and the block (pane, surface) inside it when the host has one. */
export interface HostId {
  session: string;
  block?: string;
}

export type ProgramState = 'idle' | 'working' | 'done' | 'blocked' | 'error';
export type BlockedKind = 'permission' | 'question' | 'auth';

/** What the program in the session reports (Rex's program status protocol; cmux's agent lifecycle). */
export interface HostStatus {
  state: ProgramState;
  /** Why it is blocked, when it is. */
  kind?: BlockedKind;
  title?: string;
  msg?: string;
  /** When the host last said so. */
  at: string;
}

export interface LaunchOpts {
  /** The directory the session starts in. */
  cwd: string;
  /** The session's name on the host. */
  name: string;
  /** The command the session runs. */
  command: string[];
}

export interface HostAdapter {
  manifest: HostManifest;
  identify(env: NodeJS.ProcessEnv): HostId | null;
  version(env?: NodeJS.ProcessEnv): string | null;
  status(id: HostId, env?: NodeJS.ProcessEnv): HostStatus | null;
  label(id: HostId, text: string, env?: NodeJS.ProcessEnv): boolean;
  send(id: HostId, text: string, env?: NodeJS.ProcessEnv): boolean;
  open(id: HostId, env?: NodeJS.ProcessEnv): boolean;
  launch(opts: LaunchOpts, env?: NodeJS.ProcessEnv): HostId | null;
  /** The host's own events for one session: each status the program reports, and the exit of its process. Returns the
   *  stop function. A host without a stream returns a stop that does nothing, and the caller polls `status`. */
  follow(id: HostId, fn: (ev: HostEvent) => void, env?: NodeJS.ProcessEnv): () => void;
}

export type HostEvent = { kind: 'status'; status: HostStatus } | { kind: 'exited'; code?: number };

/** What the session record carries about its host. */
export interface SessionHost {
  name: string;
  session: string;
  block?: string;
  version?: string;
  /** Whether the version sits in the adapter's validated range; absent when the version could not be read. */
  validated?: boolean;
}

// --- running a host's command ---------------------------------------------------------------------------------------

const TIMEOUT_MS = 5000;

/** A host's command run, its stdout; null when the command is missing, refuses or times out. */
export function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, input?: string): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], timeout: TIMEOUT_MS, env, input });
  } catch {
    return null;
  }
}

function runJson(command: string, args: string[], env?: NodeJS.ProcessEnv): unknown {
  const out = run(command, args, env);
  if (out === null) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const VERSION_RE = /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/;

/** The first semver in a text. */
export function versionIn(text: string | null | undefined): string | null {
  const m = text ? VERSION_RE.exec(text) : null;
  return m ? m[0] : null;
}

/** Whether a version sits in a range written as `>=a <b` (either bound optional, `<=` and `>` accepted). */
export function inRange(version: string, range: string): boolean {
  const v = versionIn(version);
  if (!v) return false;
  for (const part of range.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part);
    if (!m) return false;
    const [, op = '=', bound] = m;
    // a bound may be short (`0.1`, `1`): the missing parts are zero
    const full = (x: string) => x.split('.').concat(['0', '0']).slice(0, 3).join('.');
    const c = compareVersions(v.replace(/[-+].*$/, ''), full(bound));
    if ((op === '>=' && c < 0) || (op === '>' && c <= 0) || (op === '<=' && c > 0) || (op === '<' && c >= 0) || (op === '=' && c !== 0)) return false;
  }
  return true;
}

const now = () => new Date().toISOString();

const PROGRAM_STATES: ReadonlySet<string> = new Set(['idle', 'working', 'done', 'blocked', 'error']);
const BLOCKED_KINDS: ReadonlySet<string> = new Set(['permission', 'question', 'auth']);

/** A status record as a host reports it, read defensively: the state is what counts, the rest is kept when it is there. */
export function statusOf(record: unknown, at = now()): HostStatus | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  const state = typeof r.state === 'string' ? r.state : undefined;
  if (!state || !PROGRAM_STATES.has(state)) return null;
  const kind = typeof r.kind === 'string' && BLOCKED_KINDS.has(r.kind) ? (r.kind as BlockedKind) : undefined;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { state: state as ProgramState, kind: state === 'blocked' ? kind : undefined, title: text(r.title), msg: text(r.msg), at };
}

/** The record that stands for the program among several (a program may report children, `build/test`): the root
 *  record, the one with no id, else the one reported last. */
export function rootStatus(records: unknown): HostStatus | null {
  const list: unknown[] = Array.isArray(records) ? records : records && typeof records === 'object' ? (Object.values(records as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? [records] : [];
  const root = list.find((r) => r && typeof r === 'object' && !(r as Record<string, unknown>).id) ?? list.at(-1);
  return statusOf(root);
}

// --- Rex (Superlogical) -----------------------------------------------------------------------------------------------

/** Rex: `rex new`, REX_SESSION and REX_BLOCK in every terminal, the program status protocol (OSC 7501) read by a
 *  block method and streamed by `rex events`, `rex send`, `rex block rename`, `rex focus`. */
export const rex: HostAdapter = {
  manifest: { environment: 'rex', interface: HOST_INTERFACE, validated: '>=0.1 <1', command: 'rex' },
  identify: (env) => (env.REX_SESSION ? { session: env.REX_SESSION, block: env.REX_BLOCK || undefined } : null),
  version: (env) => {
    const j = runJson('rex', ['version', '--json'], env) as Record<string, unknown> | null;
    const fromJson = j ? versionIn([j.version, j.rex_version, j.client, j.server].find((v) => typeof v === 'string') as string | undefined) : null;
    return fromJson ?? versionIn(run('rex', ['version'], env));
  },
  status: (id, env) => {
    if (!id.block) return null;
    return rootStatus(runJson('rex', ['block', 'call', '-s', id.session, '-b', id.block, 'program_status'], env));
  },
  // an empty label clears nothing on Rex: a block keeps a label, so the tool's name stands in
  label: (id, text, env) => (id.block ? run('rex', ['block', 'rename', '-s', id.session, id.block, text || 'pjman'], env) !== null : false),
  // text as typed, then the carriage return a terminal reads as Enter
  send: (id, text, env) => run('rex', ['send', '-s', id.session, ...(id.block ? ['-b', id.block] : []), `${text}\r`], env) !== null,
  open: (id, env) => run('rex', ['focus', '-s', id.session, ...(id.block ? [id.block] : [])], env) !== null,
  launch: (opts, env) => {
    const j = runJson('rex', ['new', opts.name, '-c', opts.cwd, '--json', '--', ...opts.command], env) as Record<string, unknown> | null;
    const session = typeof j?.session_id === 'string' ? j.session_id : typeof (j?.session as Record<string, unknown> | undefined)?.session_id === 'string' ? ((j!.session as Record<string, unknown>).session_id as string) : null;
    if (!session) return null;
    const blocks = runJson('rex', ['block', 'ls', '-s', session, '--json'], env);
    const first = Array.isArray(blocks) ? (blocks[0] as Record<string, unknown> | undefined) : undefined;
    return { session, block: typeof first?.block_id === 'string' ? first.block_id : typeof first?.id === 'string' ? first.id : undefined };
  },
  follow: (id, fn, env) => followLines('rex', ['events', '-s', id.session, '--json'], env, (line) => {
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    const ev = rexEvent(e, id);
    if (ev) fn(ev);
  }),
};

/** A line of `rex events --json` read as a host event for one block: a program status it reported, or its exit.
 *  The wire wraps a block's event twice: session_event {session_id, event: block_event {block_id, name, payload}}. */
export function rexEvent(e: unknown, id: HostId): HostEvent | null {
  if (!e || typeof e !== 'object') return null;
  let o = e as Record<string, unknown>;
  if (o.type === 'session_event') {
    const p = o.payload as Record<string, unknown> | undefined;
    if (!p || (typeof p.session_id === 'string' && p.session_id !== id.session)) return null;
    o = (p.event as Record<string, unknown>) ?? {};
  }
  if (o.type !== 'block_event') return null;
  const p = o.payload as Record<string, unknown> | undefined;
  if (!p || (id.block && p.block_id !== id.block)) return null;
  const body = p.payload as Record<string, unknown> | undefined;
  if (p.name === 'child_exited') return { kind: 'exited', code: typeof body?.exit_code === 'number' ? body.exit_code : undefined };
  if (p.name === 'program_status_changed') {
    const status = statusOf(body?.record ?? body);
    return status ? { kind: 'status', status } : null;
  }
  if (p.name === 'program_status_removed') return { kind: 'status', status: { state: 'idle', at: now() } };
  return null;
}

// --- cmux -----------------------------------------------------------------------------------------------------------

/** cmux: CMUX_WORKSPACE_ID and CMUX_SURFACE_ID in every terminal, a sidebar status pill as the label, `cmux send`,
 *  `select-workspace`, `new-workspace`. The installed cmux (0.62) reports no program status and streams no events to
 *  the CLI, so state falls back to the record; later cmux versions carry both, under the same interface. */
export const cmux: HostAdapter = {
  manifest: { environment: 'cmux', interface: HOST_INTERFACE, validated: '>=0.62 <1', command: 'cmux' },
  identify: (env) => (env.CMUX_WORKSPACE_ID ? { session: env.CMUX_WORKSPACE_ID, block: env.CMUX_SURFACE_ID || env.CMUX_PANEL_ID || undefined } : null),
  version: (env) => versionIn(run('cmux', ['--version'], env)),
  status: () => null,
  label: (id, text, env) => run('cmux', text ? ['set-status', 'pjman', text, '--icon', 'point.3.connected.trianglepath.dotted', '--workspace', id.session] : ['clear-status', 'pjman', '--workspace', id.session], env) !== null,
  send: (id, text, env) => run('cmux', ['send', '--workspace', id.session, ...(id.block ? ['--surface', id.block] : []), '--', `${text}\n`], env) !== null,
  open: (id, env) => run('cmux', ['select-workspace', '--workspace', id.session], env) !== null,
  launch: (opts, env) => {
    const out = run('cmux', ['new-workspace', '--cwd', opts.cwd, '--command', opts.command.map(shellWord).join(' ')], env);
    if (out === null) return null;
    const m = /(workspace:[\w-]+|[0-9a-fA-F-]{36})/.exec(out);
    const session = m ? m[1] : null;
    if (!session) return null;
    run('cmux', ['rename-workspace', '--workspace', session, '--', opts.name], env);
    return { session };
  },
  follow: () => () => {},
};

const shellWord = (w: string): string => (/^[\w./:@=+-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);

// --- the registry ---------------------------------------------------------------------------------------------------

/** Every host adapter, in the order they are tried. The only place that knows where adapters come from. */
export const HOSTS: readonly HostAdapter[] = [rex, cmux];

export function hostNamed(name: string | undefined): HostAdapter | undefined {
  return HOSTS.find((h) => h.manifest.environment === name);
}

/** The host this environment runs in, with its ids; null outside any. */
export function detectHost(env: NodeJS.ProcessEnv = process.env): { adapter: HostAdapter; id: HostId } | null {
  for (const adapter of HOSTS) {
    const id = adapter.identify(env);
    if (id) return { adapter, id };
  }
  return null;
}

/** What a session record carries about the host it runs in: the ids from the environment, the version by the host's
 *  command, and whether that version sits in the adapter's validated range. */
export function sessionHost(env: NodeJS.ProcessEnv = process.env): SessionHost | null {
  const found = detectHost(env);
  if (!found) return null;
  const version = found.adapter.version(env) ?? undefined;
  return { name: found.adapter.manifest.environment, session: found.id.session, block: found.id.block, version, validated: version ? inRange(version, found.adapter.manifest.validated) : undefined };
}

/** The host present on this machine, whether or not this process runs inside it: the first whose command answers. */
export function hostPresent(env: NodeJS.ProcessEnv = process.env): { adapter: HostAdapter; version: string | null } | null {
  for (const adapter of HOSTS) {
    const version = adapter.version(env);
    if (version !== null) return { adapter, version };
  }
  return null;
}

/** The host a session record names, with its ids, when an adapter for it is registered. */
export function hostOfRecord(data: Record<string, unknown>): { adapter: HostAdapter; id: HostId; host: SessionHost } | null {
  const h = data.host;
  if (!h || typeof h !== 'object') return null;
  const host = h as SessionHost;
  const adapter = hostNamed(host.name);
  if (!adapter || typeof host.session !== 'string') return null;
  return { adapter, id: { session: host.session, block: typeof host.block === 'string' ? host.block : undefined }, host };
}

// --- following a command's lines --------------------------------------------------------------------------------------

/** A command spawned for its lines, one call per line; the stop kills it. A command that is missing or exits stops
 *  quietly: the caller reads `status` instead. */
export function followLines(command: string, args: string[], env: NodeJS.ProcessEnv | undefined, fn: (line: string) => void): () => void {
  let child: ChildProcess | null;
  try {
    child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return () => {};
  }
  let buf = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) fn(line);
    }
  });
  child.on('error', () => {});
  return () => {
    if (child && child.exitCode === null && !child.killed) child.kill();
    child = null;
  };
}

/** `status` by the host, without blocking: for the server, which reads many sessions at once. */
export function statusAsync(adapter: HostAdapter, id: HostId, env: NodeJS.ProcessEnv = process.env): Promise<HostStatus | null> {
  if (adapter === rex) {
    if (!id.block) return Promise.resolve(null);
    return new Promise((resolve) => {
      execFile('rex', ['block', 'call', '-s', id.session, '-b', id.block!, 'program_status'], { encoding: 'utf8', timeout: TIMEOUT_MS, env }, (err, out) => {
        if (err) return resolve(null);
        try {
          resolve(rootStatus(JSON.parse(out)));
        } catch {
          resolve(null);
        }
      });
    });
  }
  return Promise.resolve(adapter.status(id, env));
}
