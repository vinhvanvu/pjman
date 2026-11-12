#!/usr/bin/env node
// The Claude Code adapter for pjman: one script, one event per invocation, every write through `pjman`.
// Never blocks, never fails the session: on any error it logs to ~/.pjman/claude-code/hook.log and exits 0.
//
//   SessionStart      register the repository if it is not a project yet (auto_register); a start outside any repository (a parent
//                     directory, the home folder) is a session of the global store with no project, resolved to the project of the
//                     repository it first works in (PostToolUse); dock the view first; run the reads side by
//                     side (the brief, `pjman context`, who the person is at startup and /clear (`pjman whoami --verify`, cached a day
//                     by the tool; injected only when something is off, the rename or claim offered and never run), the receipt's
//                     watermark, the done changes for the stale-worktree scan, the open PR off main); then the one write, `pjman
//                     session start`: the session record unless it exists, the start line, the change the branch names bound and
//                     observed, the brief (the bound change's context in full on resume/compact/clear); the stale worktrees named
//                     ahead of the board
//   UserPromptSubmit  a prompt naming one change, a ticket or a URL binds the change it leads to (pjman refs); one naming several binds none and
//                     the agent is told the candidates; a ticket leads only to the change that binds it, and one of the project's tracker that
//                     no change binds is read from the tracker and created
//                     through the sync (gh for GitHub), or the agent is told to; a source it names that leads to no change (a PR, a branch)
//                     is observed on the session itself while nothing is bound, and the session is then named from its own record
//                     (pjman session name: a PR reads review); then the brief (pjman brief --session): the bound change's
//                     context in full when the binding moved, else what changed on it since the last brief
//   PostToolUse       an edit, or a shell call that writes the store, marks the turn as having acted; a file write in the project records an
//                     observed `links` edge from the bound change and marks the turn as having written code; a shell call that writes a
//                     decision marks the turn as having recorded one, and the harness's own question prompt marks it as having asked the person;
//                     a shell call that may bind (filing a change, a sync, `pjman session bind`) reads the session's binding, and a moved one is taken up as a prompt's bind is
//   Stop              a turn that wrote code for the bound change may end only where the change rests (pjman rest: a decision proposed, a
//                     blocker recorded, a status a person set, the plan run to its end); elsewhere the stop is refused once, with the open
//                     steps and the ways out, and the turn goes on (change:run-to-the-end). A reply on a bound change that asks the person
//                     to choose (questions laid out with options, or the harness's question prompt used this turn) while no decision was opened or
//                     added this turn is sent back once to record them as decisions (change:questions-become-decisions). Then a turn that acted appends one log line,
//                     from the harness's last message; the size of each brief given this turn and the receipt of what the store received
//                     since the last turn are shown to the person
//   SubagentStart     a child session with `parent`
//   SubagentStop      the child's log line
//   SessionEnd        a closing log line; the view's pane is closed, or parked on the bridge when the session was cleared, from
//                     whatever page the person had browsed it to (one already on the bridge keeps its pins)
//
//   The view beside the session. In cmux: the dashboard (pjman serve, started if none is running) is docked in a browser pane
//   beside the workspace's sessions, one pane per workspace (decision pjman-24/shared-pane): opened on the product's bridge by
//   the first session to start there, and moved to a session's page when the person prompts a session that holds a change
//   (or, while it is parked, when a session takes its first change from its branch or the agent's own bind). When the
//   session it shows ends it goes to the most recently prompted session there that holds a change, else back to the
//   bridge; the workspace's last session closes it, and a /clear parks it for the next. A session with no project opens
//   none. A pane the person closed stays closed while the workspace's sessions run; `dock: false` in ~/.pjman/config.yaml
//   turns the dock off (decision pjman-24/dock-off-switch). Elsewhere, and whenever the pane was closed, `pjman open
//   --session` brings the page back; the session's id is exported to the agent's shell as PJMAN_SESSION.
//
//   The follow window (change:follow-window). Every prompt in a main session tells a running dashboard that the person is on
//   this session, and the follow window goes there. Where there is no dock (Rex, Claude Code's desktop app), a session's start
//   opens that window when none is open (decision desktop-app/desktop-view): a detached copy of this hook (FollowWindow) starts the dashboard if none runs, tells it the session, asks
//   it whether to open one (yes to one caller only, so sessions started together never open two) and runs
//   `pjman open --follow`. `follow_window: false` in ~/.pjman/config.yaml turns the opening off.

import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = 'agent:claude-code';
const EVENT = process.argv[2] ?? '';
const here = path.dirname(fileURLToPath(import.meta.url));
// The adapter's own files (the hook log, each session's state, the docks) live with pjman's, not in the plugin's data
// folder: removing or repointing the plugin's marketplace deletes that folder, and open sessions would lose which pane is
// their dock (change:pjman-15). What an earlier version left there is carried across once, never over newer files.
const dataDir = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'claude-code');
const legacyDataDir = process.env.CLAUDE_PLUGIN_DATA;
if (
  legacyDataDir &&
  path.resolve(legacyDataDir) !== path.resolve(dataDir) &&
  !fs.existsSync(path.join(dataDir, '.carried'))
) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(legacyDataDir))
      fs.cpSync(legacyDataDir, dataDir, { recursive: true, force: false, errorOnExist: false });
    fs.writeFileSync(path.join(dataDir, '.carried'), `${new Date().toISOString()} from ${legacyDataDir}\n`);
  } catch {}
}
const logFile = path.join(dataDir, 'hook.log');

function note(msg) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${EVENT} ${msg}\n`);
  } catch {}
}

// --- the tool -----------------------------------------------------------------------------------
// In this repository the plugin sits at adapters/claude-code, so the checkout's own bin is preferred; otherwise `pjman` on PATH.
const localBin = path.resolve(here, '..', '..', '..', 'bin', 'pjman.js');
const PJMAN = fs.existsSync(localBin) ? [process.execPath, localBin] : ['pjman'];

function pjman(args, { cwd, env = {}, json = false, input } = {}) {
  const [cmd, ...pre] = PJMAN;
  const t0 = performance.now();
  try {
    const out = execFileSync(cmd, [...pre, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      input,
      env: { ...process.env, ...env },
    });
    return json ? JSON.parse(out) : out;
  } finally {
    if (TIMING) note(`${(performance.now() - t0).toFixed(0).padStart(5)} ms  pjman ${args.join(' ').slice(0, 74)}`);
  }
}

function tryPjman(args, opts) {
  try {
    return pjman(args, opts);
  } catch (e) {
    note(
      `pjman ${args.join(' ')} failed: ${
        String(e.stderr || e.message)
          .trim()
          .split('\n')[0]
      }`,
    );
    return null;
  }
}

// The same, without waiting: the session's start runs its reads side by side (each `pjman` is a process of its own,
// and the store is read in about the same time however many read it), then its writes one after another, since the
// store takes one writer at a time and a read during a write could see a record half written.
// With PJMAN_HOOK_TIMING set, each call's duration goes to the log: how a slow start is read.
const TIMING = Boolean(process.env.PJMAN_HOOK_TIMING);
function runAsync(cmd, args, { cwd, env = {}, input } = {}) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      },
      (err, stdout, stderr) => {
        if (TIMING)
          note(
            `${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${(cmd === PJMAN[0] && args[0] === PJMAN[1] ? ['pjman', ...args.slice(PJMAN.length - 1)] : [cmd, ...args]).join(' ').slice(0, 80)}`,
          );
        resolve({
          ok: !err,
          out: stdout ?? '',
          err: String(stderr || (err && err.message) || '')
            .trim()
            .split('\n')[0],
        });
      },
    );
    // a child that exits before reading its input closes the pipe: the write fails with EPIPE, which must not crash
    // the hook; the child's own result still arrives through the callback
    child.stdin?.on('error', () => {});
    child.stdin?.end(input ?? '');
  });
}
async function pjmanAsync(args, { cwd, env = {}, json = false, input } = {}) {
  const [cmd, ...pre] = PJMAN;
  const r = await runAsync(cmd, [...pre, ...args], { cwd, env, input });
  if (!r.ok) {
    note(`pjman ${args.join(' ')} failed: ${r.err}`);
    return null;
  }
  if (!json) return r.out;
  try {
    return JSON.parse(r.out);
  } catch {
    note(`pjman ${args.join(' ')} failed: not JSON`);
    return null;
  }
}
async function shAsync(cmd, args, cwd) {
  const r = await runAsync(cmd, args, { cwd });
  return r.ok ? r.out.trim() : null;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- state per session: what this adapter remembers between hook invocations --------------------
function stateFile(sid) {
  return path.join(dataDir, 'state', `${sid}.json`);
}
function loadState(sid) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8'));
  } catch {
    return { acted: 0, edited: 0, bound: null, observed: [], pane: null, seq: undefined, briefs: [] };
  }
}
function saveState(sid, st) {
  fs.mkdirSync(path.dirname(stateFile(sid)), { recursive: true });
  fs.writeFileSync(stateFile(sid), JSON.stringify(st));
}

// --- the repository, the branch, the pull request ---------------------------------------------------
function sh(cmd, args, cwd) {
  const t0 = performance.now();
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    }).trim();
  } catch {
    return null;
  } finally {
    if (TIMING) note(`${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${[cmd, ...args].join(' ').slice(0, 80)}`);
  }
}
const gitTop = (cwd) => sh('git', ['rev-parse', '--show-toplevel'], cwd);
/** The checkout a directory sits in and the repository it belongs to: its top level and its common git directory, both
 *  real paths, so a worktree and its main checkout share the second; null outside any repository. */
function checkoutOf(dir) {
  const out = sh('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], dir);
  const [top, common] = out ? out.split('\n') : [];
  if (!top || !common) return null;
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  return { top: real(top), common: real(common) };
}

/** The user config says auto_register: false. Read as text: the hook has no YAML parser. */
function autoRegisterOff() {
  try {
    const file = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'config.yaml');
    return /^auto_register:\s*false\s*$/m.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/** The person's global store, when it exists: where a session that starts outside any project is recorded. */
function globalStore() {
  const root = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'store');
  return fs.existsSync(path.join(root, 'pjman.yaml')) ? root : null;
}

/** The directory a tool call worked in: the file it wrote (the hook's matcher passes writes, never reads), or the
 *  directory a shell command changed into; a relative path is read against the session's working directory. */
function workedDir(input, cwd) {
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (file) return path.dirname(path.resolve(cwd, file));
  if (input.tool_name !== 'Bash') return null;
  const m = /(?:^|&&|;|\|)\s*cd\s+(?:--\s+)?(?:(["'])([^"']*)\1|([^\s"'&;|]+))/.exec(
    String(input.tool_input?.command ?? ''),
  );
  const dir = m ? (m[2] ?? m[3]) : null;
  return dir ? path.resolve(cwd, dir.replace(/^~(?=\/|$)/, os.homedir())) : null;
}

/** A session that started outside any project is resolved to the project of the repository it works in, the first time a
 *  tool call lands inside one: the record is told, and from here every hook call runs from that repository. The session
 *  lives in the global store, so only a project of that store resolves it; a repository carrying its own store is left
 *  alone. A directory that resolved to nothing is remembered, so a session working in its own folder asks once per folder. */
function resolveProject(st, sid, input, env, cwd, root) {
  const dir = workedDir(input, cwd);
  if (!dir || (st.tried ?? []).includes(dir) || !fs.existsSync(dir)) return false;
  st.tried = [...(st.tried ?? []), dir].slice(-50);
  const override = process.env.PJMAN_STORE;
  delete process.env.PJMAN_STORE;
  let where = null;
  try {
    where = pjman(['where', '--json'], { cwd: dir, json: true });
  } catch {
    where = null;
  }
  const ours = where?.project && where.project_dir && path.resolve(where.root) === path.resolve(root);
  if (!ours) {
    if (override !== undefined) process.env.PJMAN_STORE = override;
    if (where?.project)
      note(`${dir} is ${where.project}'s, in another store (${where.root}); the session stays unscoped`);
    return false;
  }
  if (tryPjman(['session', 'project', sid, where.project], { cwd: where.project_dir, env }) === null) {
    if (override !== undefined) process.env.PJMAN_STORE = override;
    return false;
  }
  st.projectDir = where.project_dir;
  st.unscoped = false;
  note(`resolved to ${where.project} from ${where.project_dir}`);
  return true;
}

/** Observed edges from the bound change to the branch and the open pull request, once each per session. */
/** A change the hook took up as the session's subject, remembered so a later read of the record does not take it up again. */
function taken(st, key) {
  st.taken = [...new Set([...(st.taken ?? []), key])];
  return key;
}
function observeWork(st, sid, cwd, env) {
  const branch = currentBranch(cwd);
  // a pull request is asked of the forge only off the default branch: the call reaches the network
  const prUrl =
    branch && store_sourceKinds().includes('github-pr')
      ? sh('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], cwd)
      : null;
  observeKeys(st, sid, cwd, env, workKeys(branch, prUrl));
}
/** The current branch, or null on the default branch or a detached head: nothing to observe there. */
function currentBranch(cwd) {
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return branch && !['HEAD', 'main', 'master'].includes(branch) ? branch : null;
}
function workKeys(branch, prUrl) {
  const keys = [];
  if (branch && store_sourceKinds().includes('branch')) keys.push(`branch:${branch}`);
  const m = prUrl && /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (m) keys.push(`github-pr:${m[1]}#${m[2]}`);
  return keys;
}
/** The edges observed: from the bound change, or, while nothing is bound, from the session itself (decision
 *  unbound-sessions/sources), so a review or a backlog pass is found from the PR or the ticket it read. Returns how
 *  many were new. */
function observeKeys(st, sid, cwd, env, keys) {
  const from = st.bound ?? `session:${sid}`;
  let added = 0;
  for (const key of keys) {
    const edge = `${from}|${key}`;
    if (st.observed.includes(edge)) continue;
    if (tryPjman(['session', 'observe', sid, 'links', from, key], { cwd, env }) !== null) {
      st.observed.push(edge);
      added += 1;
    }
  }
  return added;
}
/** A session with no change, once a source was observed on it, is named from its own record (pjman session name infers
 *  the kind and the name; decision unbound-sessions/naming): the hook adds no rule of its own. Nothing to infer from
 *  leaves it unnamed, and the agent names it when the person's words make the work clear. */
function nameUnbound(st, sid, cwd, env) {
  if (st.bound || st.named) return;
  const r = tryPjman(['session', 'name', sid, '--json'], { cwd, env, json: true });
  if (r) st.named = r.kind;
}
let _sourceKinds = null;
const store_sourceKinds = () => _sourceKinds ?? [];

/** Worktrees of this repository whose change is done and whose branch is already on the default branch: safe to remove.
 *  Starts from the store's done changes (decision session-start-fast/scan-off-the-path): the tool lists each with its
 *  branch and worktree name, and they are matched against one listing of the worktrees, so the scan costs the same
 *  however many worktrees there are; the ancestry check runs only for the matches. */
function staleWorktrees(cwd, done) {
  if (!done.length) return [];
  const list = sh('git', ['worktree', 'list', '--porcelain'], cwd);
  if (!list) return [];
  const trunk = sh('git', ['rev-parse', '--verify', '--quiet', 'main'], cwd)
    ? 'main'
    : sh('git', ['rev-parse', '--verify', '--quiet', 'master'], cwd)
      ? 'master'
      : null;
  if (!trunk) return [];
  const byBranch = new Map();
  const byName = new Map();
  let dir = null;
  for (const line of list.split('\n')) {
    if (line.startsWith('worktree ')) dir = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/') && dir) {
      const w = { dir, branch: line.slice('branch refs/heads/'.length) };
      byBranch.set(w.branch, w);
      byName.set(path.basename(dir), w);
    }
  }
  const out = [];
  let merged = null; // every branch already on the default branch, listed once and only when a match asks
  for (const c of done) {
    if (!c.branch) continue;
    const w = byBranch.get(c.branch.name) ?? byName.get(c.branch.worktree);
    if (!w || w.branch === trunk || out.some((o) => o.dir === w.dir)) continue;
    merged ??= new Set(
      (sh('git', ['branch', '--merged', trunk, '--format=%(refname:short)'], cwd) ?? '').split('\n').filter(Boolean),
    );
    if (!merged.has(w.branch)) continue;
    out.push({ dir: w.dir, branch: w.branch, change: c.printed ?? c.key });
  }
  return out;
}
function staleWorktreesText(stale) {
  if (!stale.length) return '';
  return `Worktrees whose change is done and whose branch is merged (remove them so checkouts do not pile up):\n${stale.map((w) => `- ${w.dir} (${w.change}, ${w.branch}): git worktree remove ${w.dir} && git branch -d ${w.branch}`).join('\n')}\n`;
}

// --- the view beside the session --------------------------------------------------------------
/** A watcher left by an earlier version of this adapter, which kept a Markdown view of the session current
 *  (decision session-open/open-not-markdown retired it): stopped at session end so none outlives its session. */
function stopLegacyWatcher(st) {
  if (!st.watcher) return;
  try {
    process.kill(st.watcher);
  } catch {}
  st.watcher = null;
}

/** The dashboard: the running server's address from ~/.pjman/serve.json, or a server started now (detached). */
function serveAddressFile() {
  return path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'serve.json');
}
function readServeAddress() {
  try {
    const a = JSON.parse(fs.readFileSync(serveAddressFile(), 'utf8'));
    process.kill(a.pid, 0);
    return a;
  } catch {
    return null;
  }
}
async function ensureServer(cwd) {
  const running = readServeAddress();
  if (running) return running;
  const [cmd, ...pre] = PJMAN;
  try {
    const child = spawn(cmd, [...pre, 'serve'], { cwd, detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  } catch (e) {
    note(`pjman serve failed to start: ${e.message}`);
    return null;
  }
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const a = readServeAddress();
    if (a) return a;
    await sleep(100);
  }
  note('pjman serve did not come up in time');
  return null;
}

/** A POST to the dashboard's API: its data, or null when it is not running, refuses, or takes longer than `ms`. */
async function postServer(server, route, body, ms = 1500) {
  try {
    const res = await fetch(`${server.url}/api/v1${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) return null;
    return (await res.json()).data ?? null;
  } catch {
    return null;
  }
}
/** Rex, when the session runs inside it: its blocks are terminals only, so the view is a follow window, not a dock. */
const inRex = () => Boolean(process.env.REX_SESSION);
/** Claude Code's desktop app, which runs its sessions under its own entrypoint: a mod pane there draws only the mod
 * elements, never the dock's page, so the view is the follow window (decision desktop-app/desktop-view). */
const inDesktop = () => process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop';
/** The user config says follow_window: false. Read as text: the hook has no YAML parser. */
function followWindowOff() {
  try {
    const file = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'config.yaml');
    return /^follow_window:\s*false\s*$/m.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}
/** The person is on this session (they prompted it): a running dashboard moves the follow window to it. */
async function followPrompted(sid) {
  const server = readServeAddress();
  if (server) await postServer(server, '/follow', { session: sid }, 800);
}
/** At a session's start in Rex or the desktop app: the follow window opened, unless one is open, detached so the start
 * does not wait. */
function startFollowWindow(sid, cwd) {
  if (!(inRex() || inDesktop()) || followWindowOff()) return;
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'FollowWindow'], {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PJMAN_FOLLOW_SESSION: sid },
    });
    child.unref();
  } catch (e) {
    note(`follow window: ${e.message}`);
  }
}
/** The detached half: the dashboard up, told the session, asked whether to open the window, and the window opened. */
async function followWindow(sid, cwd) {
  const server = await ensureServer(cwd);
  if (!server) return;
  await postServer(server, '/follow', { session: sid });
  // a dashboard just started waits a moment for a window that was open to reconnect before it answers
  const r = await postServer(server, '/follow/ensure', {}, 8000);
  if (!r?.open)
    return note(
      `follow window: ${r ? (r.reason === 'open' ? 'one is open' : 'another session is opening one') : 'the dashboard did not answer'}`,
    );
  const [cmd, ...pre] = PJMAN;
  const out = await runAsync(cmd, [...pre, 'open', '--follow'], { cwd });
  note(out.ok ? `follow window: ${out.out.trim()}` : `follow window: pjman open --follow failed: ${out.err}`);
}

/** cmux, when the session runs inside it: its socket CLI docks the view and names the change in the sidebar. */
const inCmux = () => Boolean(process.env.CMUX_PANEL_ID || process.env.CMUX_BUNDLE_ID);
function cmux(args) {
  if (!inCmux()) return null;
  try {
    return execFileSync('cmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  } catch (e) {
    note(
      `cmux ${args.join(' ')} failed: ${
        String(e.stderr || e.message)
          .trim()
          .split('\n')[0]
      }`,
    );
    return null;
  }
}
// The dock: one pane per cmux workspace, shared by every session in it (decision pjman-24/shared-pane). The dock file,
// ~/.pjman/dock/<workspace>.json, holds the pane, the session it shows (`sid: null` is a pane parked on the bridge), and the
// workspace's sessions, each with its terminal, when the person last prompted it and whether it holds a change. Every
// change to it runs under a lock, so tabs that start together open one pane. The pane moves only when the person prompts
// a session that holds a change, or when it is parked and a session takes its first change; when the session it shows
// ends it goes to the most recently prompted session there that still holds one, else back to the bridge, and it closes
// with the workspace's last session (a /clear parks it for the next). A pane the person closed stays closed while the
// workspace's sessions run; a new session there docks again. `dock: false` in ~/.pjman/config.yaml turns it off
// (decision pjman-24/dock-off-switch). `pjman open` adopts the same file (src/cli/open.ts). Surfaces are kept by UUID,
// never by the short refs cmux reuses. Outside a workspace id (an older cmux) the terminal stands in for the workspace.
const terminal = () => process.env.CMUX_SURFACE_ID || process.env.CMUX_PANEL_ID || null;
const workspace = () => process.env.CMUX_WORKSPACE_ID || terminal();
const dockDir = () => path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'dock');
function dockFile() {
  const w = workspace();
  return w ? path.join(dockDir(), `${w.replace(/[^\w.-]/g, '_')}.json`) : null;
}
/** The user config says dock: false. Read as text: the hook has no YAML parser. */
function dockOff() {
  try {
    const file = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'config.yaml');
    return /^dock:\s*false\s*$/m.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}
const dockOn = () => inCmux() && !dockOff() && Boolean(dockFile());
function readDock() {
  const file = dockFile();
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { pane: d.pane ?? null, sid: d.sid ?? null, sessions: d.sessions ?? {} };
  } catch {}
  // what an earlier version kept per terminal, carried across once: the pane stays known, never orphaned
  const t = terminal();
  const legacy = t ? path.join(dataDir, 'dock', `${t.replace(/[^\w.-]/g, '_')}.json`) : null;
  try {
    const d = JSON.parse(fs.readFileSync(legacy, 'utf8'));
    fs.rmSync(legacy, { force: true });
    return { pane: d.pane ?? null, sid: d.sid ?? null, sessions: {} };
  } catch {
    return null;
  }
}
/** The dock read, changed by `fn` and written back under the workspace's lock; `fn` returning null removes it. A lock
 *  older than 20s is a hook that died holding it. */
async function withDock(fn) {
  const file = dockFile();
  if (!file) return;
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const until = Date.now() + 10000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 20000) fs.rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > until) return note('dock: the workspace lock is held; left as it is');
      await sleep(50);
    }
  }
  try {
    const next = await fn(readDock());
    if (next === undefined) return;
    if (next === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, JSON.stringify(next));
  } catch (e) {
    note(`dock: ${e.message}`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
/** The surfaces alive in the workspace, by UUID; null when cmux could not say. */
async function liveSurfaces() {
  const w = process.env.CMUX_WORKSPACE_ID;
  const r = await runAsync('cmux', ['--id-format', 'uuids', 'tree', ...(w ? ['--workspace', w] : [])]);
  if (!r.ok) return null;
  return new Set([...r.out.matchAll(/\bsurface\s+(\S+)/g)].map((m) => m[1]));
}
/** The workspace's sessions whose terminal is gone dropped: a tab killed without its end reaching the hook. */
function prune(dock, alive, keep) {
  if (!alive) return;
  for (const [s, v] of Object.entries(dock.sessions))
    if (s !== keep && v.surface && !alive.has(v.surface)) delete dock.sessions[s];
}
function bridgeUrl(server, store) {
  return `${server.url}/bridge${store?.product ? `/${store.product}` : ''}`;
}
const sessionUrl = (server, sid) => `${server.url}/session/${encodeURIComponent(sid)}`;
/** A new browser pane at the url: its surface UUID, or null when cmux could not open one or did not say which. */
async function openPane(url) {
  const r = await runAsync('cmux', ['--id-format', 'uuids', 'browser', 'open', url]);
  if (!r.ok) {
    note(`cmux browser open failed: ${r.err}`);
    return null;
  }
  const m = /surface[=:\s]+(surface:\d+|[0-9a-fA-F-]{36})/.exec(r.out);
  if (!m && r.out) note(`dock: could not read the surface from: ${r.out.trim().split('\n')[0]}`);
  return m ? m[1] : null;
}
const navigate = async (pane, url) => (await runAsync('cmux', ['browser', '--surface', pane, 'navigate', url])).ok;
/** The pane is up: listed among the workspace's surfaces, or, when cmux could not list them, answering a read. */
async function paneUp(pane, alive) {
  if (!pane) return false;
  if (alive) return alive.has(pane);
  return (await runAsync('cmux', ['browser', '--surface', pane, 'get', 'url'])).ok;
}
const entry = (dock, sid) => (dock.sessions[sid] ??= { surface: terminal(), prompted: 0, bound: false });
/** The session that last had the person's prompt among those holding a change, other than `except`. */
function nextHolder(dock, except) {
  return (
    Object.entries(dock.sessions)
      .filter(([s, v]) => s !== except && v.bound)
      .toSorted((a, b) => b[1].prompted - a[1].prompted)[0]?.[0] ?? null
  );
}

/** At a session's start: the session joins its workspace's dock. A new session (a start or a clear) opens the pane on the
 *  product's bridge when the workspace has none up, the person's closed one included; a resumed or compacted one never
 *  reopens it. A pane left on a session that is gone is parked on the bridge; one on a live session is left as it is.
 *  A session with no project joins no dock: there is no product to show until it resolves and takes a change. */
async function parkView(sid, cwd, store, source) {
  if (!dockOn() || !store?.project) return;
  await withDock(async (dock) => {
    dock ??= { pane: null, sid: null, sessions: {} };
    const alive = await liveSurfaces();
    prune(dock, alive, sid);
    // a terminal runs one session at a time: one left on this terminal ended without its end reaching the hook
    for (const [s, v] of Object.entries(dock.sessions))
      if (s !== sid && v.surface === terminal()) delete dock.sessions[s];
    entry(dock, sid);
    const fresh = source === 'startup' || source === 'clear';
    if (await paneUp(dock.pane, alive)) {
      if (dock.sid && !dock.sessions[dock.sid]) {
        const server = await ensureServer(cwd);
        if (server && (await navigate(dock.pane, bridgeUrl(server, store)))) dock.sid = null;
      }
      return dock;
    }
    if (dock.pane && !fresh) return dock; // closed by the person: it stays closed while these sessions run
    const server = await ensureServer(cwd);
    if (!server) return dock; // no dashboard, no dock; `pjman open` brings it back once one runs
    dock.pane = await openPane(bridgeUrl(server, store));
    dock.sid = null;
    return dock;
  });
}
/** The pane shows the session: navigated there, or opened when the workspace has no pane recorded; a pane the person
 *  closed is left closed. */
async function showIn(dock, sid, cwd, alive) {
  if (dock.sid === sid && (await paneUp(dock.pane, alive))) return;
  const server = await ensureServer(cwd);
  if (!server) return;
  const url = sessionUrl(server, sid);
  if (dock.pane) {
    if ((await paneUp(dock.pane, alive)) && (await navigate(dock.pane, url))) dock.sid = sid;
    return;
  }
  dock.pane = await openPane(url);
  if (dock.pane) dock.sid = sid;
}
/** The person prompted this session: noted, and the pane brought to it when it holds a change. */
async function promptedView(sid, cwd, st) {
  if (!dockOn()) return;
  await withDock(async (dock) => {
    if (!dock && !st.bound) return undefined; // nothing docked and nothing to show
    dock ??= { pane: null, sid: null, sessions: {} };
    const e = entry(dock, sid);
    e.prompted = Date.now();
    e.bound = Boolean(st.bound);
    if (st.bound) await showIn(dock, sid, cwd, await liveSurfaces());
    return dock;
  });
}
/** The session took a change without a prompt (its branch at start, the agent's own bind): it holds one now, and takes
 *  the pane only when the pane is parked or this is the session the person last prompted, so a tab working in the
 *  background never pulls the pane away. */
async function boundView(sid, cwd) {
  if (!dockOn()) return;
  await withDock(async (dock) => {
    dock ??= { pane: null, sid: null, sessions: {} };
    const e = entry(dock, sid);
    e.bound = true;
    const alive = await liveSurfaces();
    const last = Object.entries(dock.sessions).toSorted((a, b) => b[1].prompted - a[1].prompted)[0];
    const lastPrompted = last && last[0] === sid && last[1].prompted > 0;
    if (dock.sid === null || !dock.sessions[dock.sid] || lastPrompted) await showIn(dock, sid, cwd, alive);
    return dock;
  });
}
/** At a session's end it leaves the dock. The pane on it goes to the most recently prompted session there that holds a
 *  change; with none, a clear parks it on the bridge (from whatever page the person browsed it to; one already on the
 *  bridge keeps its pins), and the workspace's last session closes it. */
async function undockView(sid, reason, store) {
  if (!inCmux() || !dockFile()) return;
  await withDock(async (dock) => {
    if (!dock) return undefined;
    delete dock.sessions[sid];
    const alive = await liveSurfaces();
    prune(dock, alive);
    const left = Object.keys(dock.sessions).length;
    if (!(await paneUp(dock.pane, alive))) return left || reason === 'clear' ? dock : null;
    if (dock.sid && dock.sid !== sid && dock.sessions[dock.sid]) return dock; // it shows another live session
    const next = nextHolder(dock, sid);
    const server = readServeAddress();
    if (next && server) {
      if (await navigate(dock.pane, sessionUrl(server, next))) dock.sid = next;
      return dock;
    }
    if (!left && reason !== 'clear') {
      cmux(['close-surface', '--surface', dock.pane]);
      return null;
    }
    if (!server) return dock;
    const url = bridgeUrl(server, store);
    const at = await runAsync('cmux', ['browser', '--surface', dock.pane, 'get', 'url']);
    if (!(at.ok && onPage(at.out.trim(), url)) && !(await navigate(dock.pane, url))) return left ? dock : null;
    dock.sid = null;
    return dock;
  });
}
/** Whether a pane's url is the page at `base`, with or without a query, a hash or a deeper path beneath it. */
const onPage = (at, base) => at === base || ['?', '#', '/'].some((c) => at.startsWith(base + c));
/** The session's block labelled with the change and where the work stands, by the tool through the host's adapter
 *  (change:rex-adapter): at a bind, at the end of a turn that wrote the store, and cleared at the session's end. Only
 *  inside a host the tool knows; elsewhere nothing is asked. */
const inHost = () => Boolean(process.env.REX_SESSION || process.env.CMUX_WORKSPACE_ID);
function hostLabel(sid, cwd, env, { clear = false } = {}) {
  if (!inHost()) return;
  tryPjman(['host', 'label', sid, ...(clear ? ['--clear'] : [])], { cwd, env });
}

// --- helpers ------------------------------------------------------------------------------------
function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

// the harness cuts a hook's injected context at 10,000 characters; the tool's brief has no ceiling, so what does not fit
// is pointed to, and the person is told the brief was cut
const CONTEXT_MAX = 9500;

function emitContext(event, text) {
  if (!text) return;
  const capped =
    text.length > CONTEXT_MAX
      ? text.slice(0, CONTEXT_MAX) + '\n…(cut by the harness; run pjman context for the rest)\n'
      : text;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: capped } }));
}

/** The first sentence-like line of the assistant's message: headings are skipped, list markers stripped. */
/** Where the bound change may rest, from the tool: `pjman rest` exits 1 when it does not, with the verdict on stdout all the same. */
function restVerdict(key, cwd) {
  try {
    return pjman(['rest', key, '--json'], { cwd, json: true });
  } catch (e) {
    try {
      if (e.stdout) return JSON.parse(e.stdout);
    } catch {}
    note(
      `pjman rest ${key} failed: ${
        String(e.stderr || e.message)
          .trim()
          .split('\n')[0]
      }`,
    );
    return null;
  }
}

// A key in a message is printed by the tool, never formed here (decision pjman-22/hook-printed-keys): the JSON the hook
// reads carries `printed` beside each key it relays (rest, refs, brief, ls), and the receipt's lines come printed.

/** The change as `pjman decision` takes it ahead of a decision's slug: the printed key without its `change:` prefix, the
 *  product segment kept for a change of another product (`<change>/<slug>`, or `<product>/<change>/<slug>`). */
function decisionHead(key) {
  return key.replace(/^change:/, '');
}

/** Why the stop is refused, for the agent: the change, the open steps, and the three ways the record lets it stop. */
function restRefusal(r) {
  const key = r.printed ?? r.key;
  const steps = r.open
    .map((s) => `- ${s.n}. ${s.step.text}${s.step.state === 'active' ? ' (in progress)' : ''}`)
    .join('\n');
  return [
    `pjman: ${key} is not at a resting point. This turn wrote code for it and its plan still has ${r.open.length === 1 ? 'a step' : `${r.open.length} steps`} open:`,
    steps,
    `Carry on until the plan runs to its end; mark each step as it lands (pjman step ${key} done <n>). Stop only where the record lets you: a choice that forecloses options opened as a decision, proposed (pjman decision ${decisionHead(key)}/<slug> …); an outside blocker recorded (pjman set ${key} blocked-on="…"); or every step done and the work committed on the worktree for review. If the person asked you to stop here, leave the plan where it stands (pjman step ${key} note <n> "…") and end the turn again.`,
  ].join('\n');
}

/** The questions a reply lays out for the person to choose on, outside code and quotes: a question with alternatives in it
 *  ("x or y?"), one followed by a list of options, one under an "open questions" line, or two or more questions put together.
 *  A lone question with no options (a fact only the person knows, "shall I go on?") is not a choice and is left alone. */
function choiceQuestions(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let inCode = false;
  let underHeading = false;
  const isItem = (l) => /^\s*(?:[-*+•]|\d+[.)]|[a-z][.)])\s+\S/i.test(l);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) continue; // the person's words, quoted
    if (line.startsWith('#')) {
      underHeading = /open questions?/i.test(line);
      continue;
    }
    if (/^(?:\*\*)?open questions?(?:\*\*)?:?$/i.test(line)) {
      underHeading = true;
      continue;
    }
    const plain = line
      .replace(/^[>*\-+•\d.)\s]+/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (!/\?\s*$/.test(plain)) continue;
    let options = 0;
    for (let j = i + 1; j < lines.length && j <= i + 6; j++) {
      const l = lines[j];
      if (/^\s*(```|~~~)/.test(l)) break;
      if (!l.trim()) {
        if (options) break;
        continue;
      }
      if (isItem(l)) options += 1;
      else break;
    }
    const alternatives = /\b(?:or|either|versus|vs\.?)\b/i.test(plain);
    out.push({ text: plain, choice: alternatives || options >= 2 || underHeading });
  }
  const questions = out.filter((q) => q.choice).map((q) => q.text);
  if (questions.length) return questions;
  return out.length >= 2 ? out.map((q) => q.text) : [];
}

/** Why the stop is refused when the reply asked the person to choose and nothing was recorded: the questions, and the way to record them. */
function questionsRefusal(key, questions, asked) {
  const short = (q) => (q.length > 160 ? q.slice(0, 159) + '…' : q);
  const parts = [];
  if (questions.length) {
    parts.push(`pjman: this reply asks the person to choose and no decision was opened or added to this turn:`);
    parts.push(questions.map((q) => `- ${short(q)}`).join('\n'));
  }
  if (asked)
    parts.push(
      `pjman: this turn put a question to the person through the prompt and no decision was opened or added to record it.`,
    );
  parts.push(
    `A question laid out with options is a decision: record each as proposed, with its options and one recommended (pjman decision ${decisionHead(key)}/<slug> --name "…" --gist "…" --question "…" --option <id>="…" --option <id>="…" --recommend <id>="why"), and where the person already chose, add their words (--accept <id>="…" --by person:<handle>). Then end the turn again, saying which decisions are open. A question that is not a choice (a fact only the person knows) is asked as it is; end the turn again.`,
  );
  return parts.join('\n');
}

/** Why the stop is refused when the session works on no change and has no name: the command that names it. */
function unnamedRefusal(sid) {
  return [
    `pjman: this session is bound to no change and has no name, so the record cannot say what it was for.`,
    `Name it for the work it did, one to four words, with its kind: pjman session name ${sid} "…" --kind review|backlog|chat|other. If the work belongs to a change, bind it instead (pjman session bind ${sid} <change>). Then end the turn again.`,
  ].join('\n');
}

function firstLine(text, max = 200) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const body = lines
    .filter((l) => !l.startsWith('#') && !l.startsWith('```'))
    .map((l) =>
      l
        .replace(/^[>*\-\d.)\s]+/, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .find((l) => l.length > 0);
  const line = body ?? (lines[0] ?? '').replace(/^#+\s*/, '');
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** The session's writer and session, exported to the agent's own shell for the rest of the session (decision
 *  agent-writes-carry-session/writer-is-the-agent): the harness reads the file it names at every later shell command,
 *  so a pjman write the agent runs carries the agent as writer and this session, as the hook's own writes do. A
 *  subagent's shell inherits its parent's (decision subagents-share-the-parent). No file, nothing to do. */
function exportToShell(env) {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!file) return;
  const lines = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}\n`);
  try {
    fs.appendFileSync(file, lines.join(''));
  } catch (e) {
    note(`could not export the session to the shell: ${e.message}`);
  }
}

/** The session's record, created unless it exists: one write, whose refusal says when the record is already there. */
function sessionArgs(store, sid, parent) {
  const args = ['new', 'session', sid, '--agent', AGENT, '--on-behalf-of', store.actor, '--writer', AGENT];
  if (parent) args.push('--parent', `session:${parent}`);
  return args;
}
const EXISTS = /already exists/;
function ensureSession(store, sid, env, { parent, cwd } = {}) {
  if (!store.actor) {
    note('no actor in ~/.pjman/config.yaml; session record not created');
    return false;
  }
  try {
    pjman(sessionArgs(store, sid, parent), { cwd, env });
    return true;
  } catch (e) {
    const err = String(e.stderr || e.message)
      .trim()
      .split('\n')[0];
    if (EXISTS.test(err)) return true;
    note(`pjman new session failed: ${err}`);
    return false;
  }
}

/** What a prompt is about: the last reference in it that leads to a change and is not weak. The tool scans the text (`pjman refs`); the
 *  hook knows no shapes, and a ticket leads only to the change that binds it, never to one that links it. A ticket of the
 *  project's tracker that no change binds is read from the tracker and applied through
 *  the sync, which creates the change with its real title; where the hook has no reader for the tracker, the agent is
 *  told to read and sync it. A pattern match alone never creates a record. */
function promptChange(prompt, { cwd, env }) {
  const refs = tryPjman(['refs', '-', '--json'], { cwd, json: true, input: prompt }) ?? [];
  // the sources the prompt names that lead to no change (a PR, a branch, a URL): what a session with no change reads
  const sources = [
    ...new Set(
      refs
        .filter((r) => !r.weak && !r.change && !r.creatable && typeof r.key === 'string' && !r.key.startsWith('file:'))
        .map((r) => r.key),
    ),
  ];
  // a prompt naming several changes is about none of them for certain: nothing binds, the agent is told the candidates
  const named = [...new Set(refs.filter((r) => !r.weak && r.change).map((r) => r.change))];
  if (named.length > 1)
    return {
      hint: `This prompt names several changes (${named.map((c) => refs.find((r) => r.change === c).printed ?? c).join(', ')}); none was bound. If one of them is the work, bind it: pjman session bind <this session> <change>.`,
      sources,
    };
  for (const r of refs.toReversed()) {
    if (r.weak) continue; // a bare #1: as often a list item as an issue
    // a source that led to the change goes with the bind, so the record says how the change relates to it
    if (r.change) return { key: r.change, sources, via: r.relation ? r.key : undefined };
    if (!r.creatable) continue;
    const created = createFromTracker(r, { cwd, env });
    if (created) return { key: created, sources, via: r.key };
    const sync = r.key.startsWith('github-issue:') ? 'github' : r.key.slice(0, r.key.indexOf(':'));
    return {
      hint: `${r.text} is ${r.key}; no change binds it. Read it with the tracker's tools and apply the answer: pjman sync ${sync} --from - (the change it creates is bound to this session).`,
      sources,
    };
  }
  return sources.length ? { sources } : null;
}

/** GitHub issues: gh is at hand, so the hook reads the issue and the sync creates the change. */
function createFromTracker(r, { cwd, env }) {
  const m = /^github-issue:([^#]+)#(\d+)$/.exec(r.key);
  if (!m) return null;
  const issue = sh(
    'gh',
    ['issue', 'view', m[2], '-R', m[1], '--json', 'number,title,url,state,stateReason,labels,milestone'],
    cwd,
  );
  if (!issue) return null;
  if (tryPjman(['sync', 'github', '--from', '-', '--json'], { cwd, env, input: issue }) === null) return null;
  const n = tryPjman(['get', r.key, '--json'], { cwd, json: true });
  return n?.changes?.[0]?.change?.key ?? null;
}

/** The brief for this session: what the store has for it since its last brief, composed and recorded by the tool. Its
 *  size is kept for the person, shown with the receipt when the turn ends. */
function briefFor(st, sid, cwd, env, full = false) {
  return briefText(
    st,
    tryPjman(['brief', '--session', sid, '--json', ...(full ? ['--full'] : [])], { cwd, env, json: true }),
  );
}
function briefText(st, b) {
  if (!b || b.mode === 'none' || !b.text) return '';
  st.briefs = [
    ...(st.briefs ?? []),
    {
      mode: b.mode,
      change: b.printed ?? b.change,
      lines: b.size.lines,
      tokens: b.size.tokens,
      cut: b.text.length > CONTEXT_MAX,
    },
  ];
  return b.text;
}

/** The session's start. The view docks first, the pane parked on the product's bridge (one already on this session or
 *  already parked is left), and follows the session only when the start binds a change from the branch; then the reads
 *  run side by side (the brief, the board, who the person is, the
 *  receipt's watermark, the branch's change, the done changes for the worktree scan, the open pull request); then the
 *  writes one after another (the session record, its log line, the binding from the branch, the session's brief). The
 *  stale worktrees, matched from the store's done changes, go ahead of the board so the harness's cap cannot cut them. */
/** The plugin refreshes itself after an upgrade of the install it was copied from (brew upgrade, a new npm copy): Claude
 *  Code runs a cached copy, so when the marketplace's folder carries another version than this copy, the refresh runs
 *  detached, once per version, and the session is told the new hooks load at the next session or /reload-plugins. */
function refreshPlugin() {
  try {
    const own = JSON.parse(fs.readFileSync(path.join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const known = path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      'plugins',
      'known_marketplaces.json',
    );
    const src = JSON.parse(fs.readFileSync(known, 'utf8')).pjman?.source?.path;
    if (!src || path.resolve(src) === path.resolve(here, '..', '..', '..')) return ''; // loaded in place: nothing cached
    const next = JSON.parse(
      fs.readFileSync(path.join(src, 'adapters', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'),
    ).version;
    if (!own || !next || own === next) return '';
    const marker = path.join(dataDir, 'refreshed-to');
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === next) return '';
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(marker, next + '\n');
    const child = spawn('sh', ['-c', 'claude plugin marketplace update pjman; claude plugin update pjman@pjman'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    note(`plugin ${own} → ${next}: refresh started`);
    return `The pjman plugin is refreshing from ${own} to ${next} (the install was upgraded); the new hooks load at the next session or /reload-plugins.\n\n`;
  } catch (e) {
    note(`plugin refresh skipped: ${e.message}`);
    return '';
  }
}
async function sessionStart(input, store, sid, env, st, cwd) {
  const isMain = !input.agent_id;
  const source = input.source || 'startup';
  const docking = isMain ? parkView(sid, cwd, store, source) : Promise.resolve();
  const branch = isMain ? currentBranch(cwd) : null;
  const read = await promiseObject({
    brief: pjmanAsync(['brief'], { cwd }),
    context: pjmanAsync(['context'], { cwd }),
    receipt: st.seq === undefined ? pjmanAsync(['events', '--receipt', '--json'], { cwd, json: true }) : null,
    who:
      isMain && (source === 'startup' || source === 'clear')
        ? pjmanAsync(['whoami', '--verify', '--json'], { cwd, json: true })
        : null,
    done: isMain ? pjmanAsync(['ls', 'change', '--status', 'done', '--json'], { cwd, json: true }) : null,
    pr:
      isMain && branch && store_sourceKinds().includes('github-pr')
        ? shAsync('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], cwd)
        : null,
  });
  if (!store.actor) {
    note('no actor in ~/.pjman/config.yaml; session record not created');
    await docking;
    return;
  }
  // the one write (decision session-start-fast/start-as-one-write): the record unless it exists, the start line, the
  // change the branch names bound and its edge observed (the ground the session stands on binds it before any prompt
  // does), and the brief: in full when the conversation lost what it had been told (resumed, compacted, cleared)
  const started = {
    startup: 'session started',
    clear: 'session started after /clear',
    resume: 'session resumed; context rehydrated',
    compact: 'context compacted and rehydrated',
    fork: 'session forked; context rehydrated',
  };
  const rehydrated = source === 'resume' || source === 'compact' || source === 'clear';
  const start = await pjmanAsync(
    [
      'session',
      'start',
      sid,
      '--agent',
      AGENT,
      '--on-behalf-of',
      store.actor,
      '--writer',
      AGENT,
      '--log',
      started[source] ?? `session started (${source})`,
      ...(isMain && !st.bound && branch ? ['--branch', branch] : []),
      ...(rehydrated && st.bound ? ['--full'] : []),
      '--json',
    ],
    { cwd, env, json: true },
  );
  if (!start) {
    await docking;
    return;
  }
  if (isMain) exportToShell(env);
  if (isMain) startFollowWindow(sid, cwd);
  if (st.seq === undefined) st.seq = read.receipt?.seq ?? 0; // receipts start from here
  if (start.bound) st.bound = start.bound;
  if (st.bound) taken(st, st.bound);
  if (start.observed && st.bound) st.observed.push(`${st.bound}|${start.observed}`);
  let text =
    (read.brief ?? '') +
    `\n---\npjman store: ${store.root} (${store.mode}); project ${store.project ?? '(none)'}. This run is session:${sid}; records it writes carry that session.\n\n`;
  if (isMain && (source === 'startup' || source === 'clear')) text += refreshPlugin();
  // the dock is said once, the first time it can open, with the line that turns it off (decision pjman-24/dock-off-switch)
  if (isMain && dockOn() && store.project && !fs.existsSync(path.join(dockDir(), '.told'))) {
    text += `pjman docks its dashboard in a pane beside this cmux workspace, one pane shared by the workspace's sessions. Tell the person once, in passing: \`dock: false\` in ~/.pjman/config.yaml turns it off, and \`pjman open\` brings a closed pane back.\n\n`;
    try {
      fs.mkdirSync(dockDir(), { recursive: true });
      fs.writeFileSync(path.join(dockDir(), '.told'), new Date().toISOString() + '\n');
    } catch {}
  }
  if (st.unscoped)
    text += `This session started outside any registered repository (${input.cwd || process.cwd()}). It is recorded with no project until a tool call lands in one: edit a file there or \`cd\` into it in a shell command, and the session is resolved to that project. Run pjman from inside the repository you work in, so its writes resolve to that project.\n\n`;
  const stale = isMain ? staleWorktreesText(staleWorktrees(cwd, read.done ?? [])) : '';
  if (stale) text += `${stale}\n---\n`;
  text += read.context ?? '';
  const b = briefText(st, start.brief);
  if (b) text += `\n---\n${start.bound ? 'Bound from the branch.\n' : ''}${b}`;
  // who the person is, checked against the apps once a day (the tool caches): only what is off is said, with the
  // command that resolves it; a rename is the person's act, offered and never run unasked
  if (read.who?.notices?.length)
    text += `\n---\nIdentity (pjman whoami --verify):\n${read.who.notices.map((n) => `- ${n}`).join('\n')}\nOffer the command to the person and never run a rename or a claim unasked.\n`;
  emitContext(EVENT, text);
  if (isMain) {
    observeKeys(st, sid, cwd, env, workKeys(branch, read.pr));
    await docking;
    if (st.bound) await boundView(sid, cwd); // the session has its subject (the branch's change, or one bound before): a parked pane follows it
    if (st.bound) hostLabel(sid, cwd, env);
    saveState(sid, st);
  }
}
/** Promise.all over an object's values: {a: promise} in, {a: value} out; a null value stays null. */
async function promiseObject(obj) {
  const entries = Object.entries(obj);
  const values = await Promise.all(entries.map(([, v]) => v));
  return Object.fromEntries(entries.map(([k], i) => [k, values[i]]));
}

// --- main ---------------------------------------------------------------------------------------
async function main() {
  // the detached half of a session start in Rex or the desktop app (startFollowWindow): no stdin, the session in the environment
  if (EVENT === 'FollowWindow') {
    const sid = process.env.PJMAN_FOLLOW_SESSION;
    if (sid) await followWindow(sid, process.cwd());
    return;
  }
  const input = readStdin();
  const mainSid = input.session_id;
  if (!mainSid) return;
  const sid = input.agent_id || mainSid; // inside a subagent, the child session is the writer
  const st = loadState(sid);
  // a subagent of a session that started outside any project stands where its parent stands
  if (input.agent_id && st.unscoped === undefined && !st.projectDir) {
    const parent = loadState(mainSid);
    if (parent.unscoped || parent.projectDir)
      Object.assign(st, { unscoped: parent.unscoped, projectDir: parent.projectDir });
  }
  // a session resolved to a project after starting outside one runs from that repository from then on
  const cwd = st.projectDir && fs.existsSync(st.projectDir) ? st.projectDir : input.cwd || process.cwd();
  let store;
  let root = null;
  try {
    store = pjman(['where', '--json'], { cwd, json: true });
    // outside any repository the tool finds the global store with no project (decision pjman-25/store-outside-a-project):
    // the session is the person's, recorded there with no project until a tool call lands in a registered repository
    const global = globalStore();
    if (!store.project && global && path.resolve(store.root) === path.resolve(global) && !gitTop(cwd)) {
      if (EVENT !== 'SessionStart' && !st.unscoped) return;
      root = global;
      st.unscoped = true;
    }
  } catch {
    // only a start, or a session already known to stand outside any project, has anything to do here
    if (EVENT !== 'SessionStart' && !st.unscoped) return;
    if (gitTop(cwd)) {
      // not a project yet: a git repository registers itself at session start, unless the user config says otherwise
      if (EVENT !== 'SessionStart' || autoRegisterOff()) return;
      if (tryPjman(['init', '--no-start', '--no-adapter'], { cwd }) === null) return;
      try {
        store = pjman(['where', '--json'], { cwd, json: true });
      } catch {
        return;
      }
    } else {
      // outside any repository: the session is the person's, recorded in the global store with no project until a tool
      // call lands in a registered repository (resolveProject). The store is named to this process only, never to the
      // agent's shell, so the agent's own writes still resolve by the directory they run in.
      root = globalStore();
      if (!root) return;
      process.env.PJMAN_STORE = root;
      try {
        store = pjman(['where', '--json'], { cwd, json: true });
      } catch {
        return;
      }
      st.unscoped = true;
    }
  }
  _sourceKinds = store.source_kinds ?? [];

  const env = { PJMAN_WRITER: AGENT, PJMAN_SESSION: `session:${sid}` };

  switch (EVENT) {
    case 'SessionStart':
      return sessionStart(input, store, sid, env, st, cwd);
    case 'UserPromptSubmit': {
      const prompt = String(input.prompt ?? '');
      st.edited = 0; // a new turn: what the last one wrote has been judged
      st.decided = 0;
      st.asked = 0;
      st.tools = 0;
      const found = promptChange(prompt, { cwd, env });
      const parts = [];
      if (found?.hint) parts.push(found.hint);
      else if (found?.key && st.bound !== found.key) {
        const via = found.via ? ['--via', found.via] : [];
        if (tryPjman(['session', 'bind', sid, found.key, '--reason', 'prompt', ...via], { cwd, env }) !== null) {
          st.bound = taken(st, found.key);
          hostLabel(sid, cwd, env);
          observeWork(st, sid, cwd, env);
        }
      }
      // a prompt that binds nothing but names a source (a PR to review, a branch): the session reads it, recorded on the
      // session itself, and is named from what it read (change:unbound-sessions)
      if (!st.bound && found?.sources?.length && observeKeys(st, sid, cwd, env, found.sources) > 0)
        nameUnbound(st, sid, cwd, env);
      // the brief: in full when the binding moved, else what changed since the last one; nothing when nothing did
      const b = briefFor(st, sid, cwd, env);
      if (b) parts.push(b);
      emitContext(EVENT, parts.join('\n---\n'));
      saveState(sid, st);
      if (!input.agent_id) await promptedView(sid, cwd, st); // the person is on this session: the workspace's pane goes there
      if (!input.agent_id) await followPrompted(sid); // and the follow window
      return;
    }
    case 'PostToolUse': {
      if (st.unscoped && root) resolveProject(st, sid, input, env, cwd, root);
      // a shell call counts only when it writes the store; reads, builds and tests leave no log line
      const storeWrite =
        /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:init|new|set|note|session|mv|rm|fmt|sync|order|apply|undo|migrate)\b/;
      if (input.tool_name !== 'Bash' || storeWrite.test(String(input.tool_input?.command ?? ''))) st.acted += 1;
      st.tools = (st.tools ?? 0) + 1; // the turn ran a tool: a session bound to nothing is named before it stops (Stop)
      // a decision written this turn answers the questions the reply may end on (Stop); the harness's own question prompt is a
      // question put to the person, to be recorded the same way
      const decisionWrite = /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:decision|apply)\b/;
      if (input.tool_name === 'Bash' && decisionWrite.test(String(input.tool_input?.command ?? '')))
        st.decided = (st.decided ?? 0) + 1;
      if (input.tool_name === 'AskUserQuestion') st.asked = (st.asked ?? 0) + 1;
      // the agent's own bind (filing or syncing a change binds the run to it, or `pjman session bind`) gives the session its subject as a
      // prompt's does: the sidebar names it and a parked pane follows (change:bind-moves-the-dock)
      const bindingWrite = /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:new|session|apply|sync)\b/;
      if (input.tool_name === 'Bash' && bindingWrite.test(String(input.tool_input?.command ?? ''))) {
        const rec = tryPjman(['show', `session:${sid}`, '--json'], { cwd, json: true })?.data;
        const changes = rec ? (Array.isArray(rec.changes) ? rec.changes : []) : null; // null: the record could not be read
        // the newest binding, unless the hook has taken it up before (a prompt can bind an earlier change again, which
        // leaves the record's order as it was)
        const last = changes?.at(-1) ?? null;
        // the hook's change no longer on the record (a session unbind backed it out): the record's newest change is
        // followed even when taken before, and none when the record has none left (change:pjman-23)
        const unbound = Boolean(st.bound && changes && !changes.includes(st.bound));
        if (unbound && !last) {
          st.bound = null;
          hostLabel(sid, cwd, env, { clear: true });
        } else if (last && last !== st.bound && (unbound || !st.taken?.includes(last))) {
          st.bound = taken(st, last);
          hostLabel(sid, cwd, env);
          observeWork(st, sid, cwd, env);
          if (!input.agent_id) await boundView(sid, cwd);
        }
      }
      if (
        input.tool_name === 'Bash' &&
        /\bgit\s+(checkout|switch)\b|\bgh\s+pr\s+create\b/.test(String(input.tool_input?.command ?? ''))
      )
        observeWork(st, sid, cwd, env);
      const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
      if (file && st.bound) {
        // real path of p, or of its nearest existing ancestor (a file may not exist yet)
        const real = (p) => {
          p = path.resolve(p);
          try {
            return fs.realpathSync(p);
          } catch {
            return p === path.dirname(p) ? p : path.join(real(path.dirname(p)), path.basename(p));
          }
        };
        const abs = real(path.resolve(cwd, file));
        // the file's path is read against the checkout it sits in when that is a worktree of the project's repository:
        // the desktop app's hooks run from the main checkout (CLAUDE_PROJECT_DIR) while its session edits a worktree under
        // it, whose files link as file:src/…, never by the worktree's path inside the main checkout (change:desktop-app)
        const projectDir = real(st.projectDir || process.env.CLAUDE_PROJECT_DIR || cwd);
        let dir = path.dirname(abs);
        while (!fs.existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir);
        const own = checkoutOf(dir);
        const ofProject = own && checkoutOf(projectDir);
        const project = own && ofProject && own.common === ofProject.common ? own.top : projectDir;
        const rel = path.relative(project, abs);
        const inProject = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        const inStore = !path.relative(real(store.root), abs).startsWith('..');
        if (inProject && !inStore) st.edited = (st.edited ?? 0) + 1; // the turn wrote code for the change: its stop is judged (Stop)
        if (inProject && !inStore && store.source_kinds.includes('file')) {
          const edge = `${st.bound}|file:${rel}`;
          if (!st.observed.includes(edge)) {
            if (tryPjman(['session', 'observe', sid, 'links', st.bound, `file:${rel}`], { cwd, env }) !== null)
              st.observed.push(edge);
          }
        }
      }
      saveState(sid, st);
      return;
    }
    case 'Stop':
    case 'SubagentStop': {
      // Run to the end (change:run-to-the-end): a turn that wrote code for the bound change ends only where the change rests.
      // The verdict is the tool's (pjman rest); the hook refuses the stop once per turn (the harness marks the retry with
      // stop_hook_active, which passes), so a refusal is a push back into the plan, never a wall. A turn that only talked,
      // or wrote nothing for the change, passes untouched; so does a subagent.
      // Questions become decisions (change:questions-become-decisions): a reply that asks the person to choose, or a turn that put a
      // question through the harness's prompt, while no decision was opened or added this turn, is sent back once to record them.
      if (EVENT === 'Stop' && !input.agent_id && st.bound && !input.stop_hook_active) {
        const reasons = [];
        let r = null;
        if ((st.edited ?? 0) > 0) {
          r = restVerdict(st.bound, cwd);
          if (r && !r.rests) reasons.push(restRefusal(r));
        }
        if (!(st.decided ?? 0)) {
          const questions = choiceQuestions(input.last_assistant_message);
          // the change as the tool prints it, from its verdict (read here when the turn wrote no code)
          if (questions.length || st.asked)
            reasons.push(
              questionsRefusal((r ?? restVerdict(st.bound, cwd))?.printed ?? st.bound, questions, (st.asked ?? 0) > 0),
            );
        }
        if (reasons.length) {
          process.stdout.write(JSON.stringify({ decision: 'block', reason: reasons.join('\n\n') }));
          saveState(sid, st); // edited, decided and asked stay: the retry passes on stop_hook_active and resets them
          return;
        }
      }
      // A session bound to no change is named (change:pjman-20): a turn that ran a tool while the session has no change and
      // no name is sent back once with the command that names it. Named is read from the session's own record (name and
      // kind are written together), so a name the agent gave through the shell counts; once named, the record is not read again.
      if (
        EVENT === 'Stop' &&
        !input.agent_id &&
        !st.bound &&
        !st.named &&
        (st.tools ?? 0) > 0 &&
        !input.stop_hook_active
      ) {
        const rec = tryPjman(['show', `session:${sid}`, '--json'], { cwd, json: true })?.data;
        if (rec && (rec.name || rec.kind)) st.named = rec.kind ?? true;
        else if (rec) {
          process.stdout.write(JSON.stringify({ decision: 'block', reason: unnamedRefusal(sid) }));
          saveState(sid, st); // tools stays: the retry passes on stop_hook_active and resets it
          return;
        }
      }
      st.edited = 0;
      st.asked = 0;
      st.decided = 0;
      st.tools = 0;
      if (st.acted > 0) {
        const line = firstLine(input.last_assistant_message);
        if (line) tryPjman(['session', 'log', sid, line], { cwd, env });
        st.acted = 0;
        // the turn wrote the store: the plan or a decision may have moved, so the block's label is written again
        if (EVENT === 'Stop' && st.bound) hostLabel(sid, cwd, env);
      }
      // the receipt: what this session and the sessions it spawned wrote since the last turn, composed by the tool, shown to the person
      if (EVENT === 'Stop') {
        const r = tryPjman(
          ['events', '--receipt', '--since', String(st.seq ?? 0), '--session', `session:${sid}`, '--json'],
          { cwd, json: true },
        );
        if (r) {
          // the receipt is read by the person inside the project: its lines and the briefs' changes come printed by the tool
          const lines = r.lines;
          // what the agent was handed this turn, by size (the brief has no ceiling; the person sees what it cost)
          const briefed = (st.briefs ?? []).map(
            (b) =>
              `${b.mode === 'full' ? 'full context' : 'what changed'} on ${b.change}: ${b.lines} line${b.lines === 1 ? '' : 's'}, ~${b.tokens} tokens${b.cut ? ' (cut by the harness at 10,000 characters)' : ''}`,
          );
          const blocks = [];
          if (briefed.length) blocks.push(`pjman briefed:\n${briefed.map((l) => `- ${l}`).join('\n')}`);
          if (lines.length && st.seq !== undefined)
            blocks.push(`pjman recorded:\n${lines.map((l) => `- ${l}`).join('\n')}`);
          if (blocks.length) process.stdout.write(JSON.stringify({ systemMessage: blocks.join('\n') }));
          st.seq = r.seq;
          st.briefs = [];
        }
      }
      saveState(sid, st);
      return;
    }
    case 'SubagentStart': {
      if (!input.agent_id) return;
      ensureSession(store, input.agent_id, env, { parent: mainSid, cwd });
      const kind = input.agent_type ? ` (${input.agent_type})` : '';
      tryPjman(['session', 'log', input.agent_id, `spawned by session:${mainSid}${kind}`], { cwd, env });
      return;
    }
    case 'SessionEnd': {
      tryPjman(['session', 'log', sid, `session ended (${input.reason || 'other'})`], { cwd, env });
      stopLegacyWatcher(st);
      await undockView(sid, input.reason, store);
      hostLabel(sid, cwd, env, { clear: true });
      saveState(sid, st);
      return;
    }
    default:
      note(`unknown event`);
  }
}

const failed = (e) => note(`error: ${e && e.stack ? e.stack.split('\n')[0] : String(e)}`);
try {
  await main().catch(failed);
} catch (e) {
  failed(e);
}
process.exitCode = 0;
