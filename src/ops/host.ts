// pjman host (change:rex-adapter): what the host of a session is asked for from the command line. `label` writes the
// change and where the work stands onto the session's block; `send` types text into it; `open` brings it to the
// front; with no verb, the host this machine runs, its version and whether the adapter validated it.
import type { Store } from '../store/config.js';
import { nextStep, stepsOf } from '../model/foundation.js';
import { hostOfRecord, hostPresent, inRange, type HostId, type HostStatus, type SessionHost } from '../hosts/host.js';
import { worktreeNameFor } from '../model/branch.js';
import { resolve, findSession, loadStore, type Loaded, type Rec } from '../store/records.js';
import { changeOfDecision } from '../model/bridge.js';
import { sessionLogOf } from '../model/session-state.js';
import { proposedDecisions } from '../model/scope.js';
import { live } from '../model/tree.js';
import { CliError, notFound } from '../store/util.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function sessionRec(loaded: Loaded, ident: string): Rec {
  const id = ident.startsWith('session:') ? ident.slice(8) : ident;
  const rec = findSession(loaded, id);
  if (!rec) throw notFound(`session:${id}`, { as: 'session' });
  return rec;
}

/** The change a session is credited with: its last bound change that still resolves. */
function changeOf(loaded: Loaded, rec: Rec): Rec | undefined {
  const bound = (Array.isArray(rec.data.changes) ? (rec.data.changes as unknown[]) : [])
    .map((k) => live(loaded, k))
    .filter((r): r is Rec => !!r);
  return bound.at(-1);
}

/** The label a session's block carries: the change's name and where the work stands. A decision proposed on the
 *  change comes first, since it waits on the person: `Rex adapter · waits: Adapter versioning`; else the step the
 *  work stands on over the steps counted: `Rex adapter · 4/7`; a plan with no step, the name alone; no change, the
 *  tool's name. */
export function labelText(loaded: Loaded, rec: Rec): string {
  const c = changeOf(loaded, rec);
  if (!c) return 'pjman';
  const name = str(c.data.name) ?? str(c.data.gist) ?? c.key.slice(c.key.lastIndexOf('/') + 1);
  const waiting = proposedDecisions(loaded, (d) => changeOfDecision(d.key) === c.key);
  if (waiting.length)
    return `${name} · waits: ${waiting[0].name ?? waiting[0].key.slice(waiting[0].key.lastIndexOf('/') + 1)}`;
  const steps = stepsOf(c.data);
  const counted = steps.filter((s) => s.state !== 'dropped');
  const next = nextStep(steps);
  if (!counted.length) return name;
  const n = next ? counted.indexOf(next.step) + 1 : counted.length;
  return `${name} · ${n}/${counted.length}`;
}

export interface HostResult {
  session: string;
  host: SessionHost;
  /** What was asked of the host, and whether it took it. */
  did: 'label' | 'send' | 'open';
  text?: string;
  ok: boolean;
}

function hosted(
  store: Store,
  ident: string,
): {
  loaded: Loaded;
  rec: Rec;
  adapter: NonNullable<ReturnType<typeof hostOfRecord>>['adapter'];
  id: NonNullable<ReturnType<typeof hostOfRecord>>['id'];
  host: SessionHost;
} {
  const loaded = loadStore(store);
  const rec = sessionRec(loaded, ident);
  const h = hostOfRecord(rec.data);
  if (!h) throw new CliError(`${rec.key} runs in no host the tool knows; nothing to ask`);
  return { loaded, rec, ...h };
}

/** The session's block labelled with the change and where the work stands; `clear` takes the label off. */
export function hostLabel(store: Store, ident: string, opts: { clear?: boolean } = {}): HostResult {
  const { loaded, rec, adapter, id, host } = hosted(store, ident);
  const text = opts.clear ? '' : labelText(loaded, rec);
  return { session: rec.key, host, did: 'label', text, ok: adapter.label(id, text) };
}

/** Text typed into the session, as the person would. */
export function hostSend(store: Store, ident: string, text: string): HostResult {
  if (!text.trim()) throw new CliError('nothing to send', 2);
  const { rec, adapter, id, host } = hosted(store, ident);
  return { session: rec.key, host, did: 'send', text, ok: adapter.send(id, text) };
}

/** The session's block brought to the front. */
export function hostOpen(store: Store, ident: string): HostResult {
  const { rec, adapter, id, host } = hosted(store, ident);
  return { session: rec.key, host, did: 'open', ok: adapter.open(id) };
}

/** What the host of a session reports its program is doing, asked once. */
export function hostStatus(
  store: Store,
  ident: string,
): { session: string; host: SessionHost; status: HostStatus | null } {
  const { rec, adapter, id, host } = hosted(store, ident);
  return { session: rec.key, host, status: adapter.status(id) };
}

/** The agents whose harness adapter wakes a session itself (the Claude Code plugin's wake module submits a turn for a
 *  decision decided on its bound change): the host does not deliver to them, so no session hears an acceptance twice
 *  (decision rex-adapter/delivery-through-the-host, by-agent). A harness adapter with a wake module adds its agent here. */
export const WAKING_AGENTS: ReadonlySet<string> = new Set(['agent:claude-code']);

/** How long after its last line a session is still delivered to. */
const DELIVER_HOURS = 12;

export interface Delivery {
  session: string;
  host: string;
  ok: boolean;
}

/** An accepted decision delivered into the sessions working its change through their hosts: every session bound to
 *  the change that runs in a host, has not ended, spoke inside the window, and whose agent has no waking adapter.
 *  The text names the decision, the option and the person's words, and says where to read on. */
export function deliverDecision(
  loaded: Loaded,
  decisionKey: string,
  option: string,
  words: string | undefined,
  by: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Delivery[] {
  const change = changeOfDecision(decisionKey);
  if (!change) return [];
  const since = new Date(now - DELIVER_HOURS * 3_600_000).toISOString();
  const text = `pjman: ${decisionKey} decided by ${by}: ${option}${words ? ` — ${words}` : ''}. Read pjman context ${change} and act on it as the record now says.`;
  const out: Delivery[] = [];
  for (const rec of loaded.records) {
    if (rec.type !== 'session' || !rec.valid) continue;
    const agent = typeof rec.data.agent === 'string' ? rec.data.agent : '';
    if (WAKING_AGENTS.has(agent)) continue;
    const bound = Array.isArray(rec.data.changes) ? (rec.data.changes as unknown[]) : [];
    if (!bound.some((k) => live(loaded, k)?.key === change)) continue;
    const h = hostOfRecord(rec.data);
    if (!h) continue;
    const { ended, line } = sessionLogOf(rec);
    if (ended) continue;
    const started = typeof rec.data.started === 'string' ? rec.data.started : '';
    if ((line?.at ?? started) < since) continue;
    out.push({ session: rec.key, host: h.adapter.manifest.environment, ok: h.adapter.send(h.id, text, env) });
  }
  return out;
}

/** The command a launched session runs: the harness opened in the change's worktree, as the pjman skill has it
 *  (`claude --worktree <slug>`). The harness adapter owns this line; a second harness adds its own here. */
export function launchCommand(changeKey: string): string[] {
  return ['claude', '--worktree', worktreeNameFor(changeKey)];
}

export interface LaunchResult {
  change: string;
  host: string;
  /** The host's ids for the new session; the session record comes once the harness's start hook runs. */
  id: HostId;
  cwd: string;
  command: string[];
}

/** A session for a change, launched on the host this machine runs: in the project's directory, the harness opened in
 *  the change's worktree, the session named for the change. */
export function hostLaunch(store: Store, changeRef: string, env: NodeJS.ProcessEnv = process.env): LaunchResult {
  const here = hostPresent(env);
  if (!here) throw new CliError('no host: no terminal multiplexer the tool knows answers on this machine');
  const loaded = loadStore(store);
  const raw = changeRef.includes(':') ? changeRef : `change:${changeRef}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw notFound(raw, { as: 'change' });
  const c = res.rec;
  if (c.type !== 'change') throw new CliError(`${c.key} is a ${c.type}, not a change`);
  if (c.data.status === 'done' || c.data.status === 'dropped')
    throw new CliError(`${c.key} is ${c.data.status}; a session is launched for open work`);
  const cwd = store.projectDir ?? process.cwd();
  const command = launchCommand(c.key);
  const id = here.adapter.launch({ cwd, name: worktreeNameFor(c.key), command }, env);
  if (!id) throw new CliError(`${here.adapter.manifest.environment} did not open a session`);
  return { change: c.key, host: here.adapter.manifest.environment, id, cwd, command };
}

/** The host this machine runs: the first whose command answers, its version, and whether the adapter validated it. */
export function hostHere(
  env: NodeJS.ProcessEnv = process.env,
): { name: string; version: string | null; validated: boolean | null; interface: number; range: string } | null {
  const here = hostPresent(env);
  if (!here) return null;
  const { manifest } = here.adapter;
  return {
    name: manifest.environment,
    version: here.version,
    validated: here.version ? inRange(here.version, manifest.validated) : null,
    interface: manifest.interface,
    range: manifest.validated,
  };
}
