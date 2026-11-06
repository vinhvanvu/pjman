#!/usr/bin/env node
// The Claude Code adapter for pjman: one script, one event per invocation, every write through `pjman`.
// Never blocks, never fails the session: on any error it logs to the plugin data directory and exits 0.
//
//   SessionStart      register the repository if it is not a project yet (auto_register); dock the view first; run the reads side by
//                     side (the brief, `pjman context`, who the person is at startup and /clear (`pjman whoami --verify`, cached a day
//                     by the tool; injected only when something is off, the rename or claim offered and never run), the receipt's
//                     watermark, the done changes for the stale-worktree scan, the open PR off main); then the one write, `pjman
//                     session start`: the session record unless it exists, the start line, the change the branch names bound and
//                     observed, the brief (the bound change's context in full on resume/compact/clear); the stale worktrees named
//                     ahead of the board
//   UserPromptSubmit  a prompt naming one change, a ticket or a URL binds the change it leads to (pjman refs); one naming several binds none and
//                     the agent is told the candidates; a ticket of the project's tracker with no record is read from the tracker and created
//                     through the sync (gh for GitHub), or the agent is told to; then the brief (pjman brief --session): the bound change's
//                     context in full when the binding moved, else what changed on it since the last brief
//   PostToolUse       an edit, or a shell call that writes the store, marks the turn as having acted; a file write records an observed `links` edge from the bound change
//   Stop              a turn that acted appends one log line, from the harness's last message; the size of each brief given this turn and the
//                     receipt of what the store received since the last turn are shown to the person
//   SubagentStart     a child session with `parent`
//   SubagentStop      the child's log line
//   SessionEnd        a closing log line; the view's pane is closed
//
//   The view beside the session. In cmux: the dashboard's session page (pjman serve, started if none is running) is docked in a
//   browser pane at session start and closed at session end. Elsewhere, and whenever the pane was closed, `pjman open --session`
//   brings the page back; the session's id is exported to the agent's shell as PJMAN_SESSION.

import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = 'agent:claude-code';
const EVENT = process.argv[2] ?? '';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'pjman-claude-code');
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
      cwd, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], input,
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
    note(`pjman ${args.join(' ')} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
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
    const child = execFile(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } }, (err, stdout, stderr) => {
      if (TIMING) note(`${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${(cmd === PJMAN[0] && args[0] === PJMAN[1] ? ['pjman', ...args.slice(PJMAN.length - 1)] : [cmd, ...args]).join(' ').slice(0, 80)}`);
      resolve({ ok: !err, out: stdout ?? '', err: String(stderr || (err && err.message) || '').trim().split('\n')[0] });
    });
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
    return { acted: 0, bound: null, observed: [], pane: null, seq: undefined, briefs: [] };
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
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } }).trim();
  } catch {
    return null;
  } finally {
    if (TIMING) note(`${(performance.now() - t0).toFixed(0).padStart(5)} ms  ${[cmd, ...args].join(' ').slice(0, 80)}`);
  }
}
const gitTop = (cwd) => sh('git', ['rev-parse', '--show-toplevel'], cwd);

/** The user config says auto_register: false. Read as text: the hook has no YAML parser. */
function autoRegisterOff() {
  try {
    const file = path.join(process.env.PJMAN_HOME || path.join(os.homedir(), '.pjman'), 'config.yaml');
    return /^auto_register:\s*false\s*$/m.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

/** Observed edges from the bound change to the branch and the open pull request, once each per session. */
function observeWork(st, sid, cwd, env) {
  if (!st.bound) return;
  const branch = currentBranch(cwd);
  // a pull request is asked of the forge only off the default branch: the call reaches the network
  const prUrl = branch && store_sourceKinds().includes('github-pr') ? sh('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], cwd) : null;
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
function observeKeys(st, sid, cwd, env, keys) {
  if (!st.bound) return;
  for (const key of keys) {
    const edge = `${st.bound}|${key}`;
    if (st.observed.includes(edge)) continue;
    if (tryPjman(['session', 'observe', sid, 'links', st.bound, key], { cwd, env }) !== null) st.observed.push(edge);
  }
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
  const main = sh('git', ['rev-parse', '--verify', '--quiet', 'main'], cwd) ? 'main' : sh('git', ['rev-parse', '--verify', '--quiet', 'master'], cwd) ? 'master' : null;
  if (!main) return [];
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
    if (!w || w.branch === main || out.some((o) => o.dir === w.dir)) continue;
    merged ??= new Set((sh('git', ['branch', '--merged', main, '--format=%(refname:short)'], cwd) ?? '').split('\n').filter(Boolean));
    if (!merged.has(w.branch)) continue;
    out.push({ dir: w.dir, branch: w.branch, change: c.key });
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

/** cmux, when the session runs inside it: its socket CLI docks the view and names the change in the sidebar. */
const inCmux = () => Boolean(process.env.CMUX_PANEL_ID || process.env.CMUX_BUNDLE_ID);
function cmux(args) {
  if (!inCmux()) return null;
  try {
    return execFileSync('cmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  } catch (e) {
    note(`cmux ${args.join(' ')} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    return null;
  }
}
/** The view docked: first thing at start, since it needs only the session id and the server, never the store. */
async function dockView(st, sid, cwd) {
  if (st.pane || !inCmux()) return;
  const server = await ensureServer(cwd);
  if (!server) return; // no dashboard, no dock; `pjman open --session` brings it back once one runs
  const r = await runAsync('cmux', ['browser', 'open', `${server.url}/session/${encodeURIComponent(sid)}`]);
  if (!r.ok) {
    note(`cmux browser open failed: ${r.err}`);
    return;
  }
  const m = /surface[=:\s]+(surface:\d+|[0-9a-fA-F-]{36})/.exec(r.out);
  if (m) st.pane = m[1];
  else if (r.out) note(`dock: could not read the surface from: ${r.out.trim().split('\n')[0]}`);
}
function undockView(st) {
  if (!st.pane) return;
  cmux(['close-surface', '--surface', st.pane]);
  st.pane = null;
}
function sidebarStatus(key) {
  if (key) cmux(['set-status', 'pjman', key, '--icon', 'point.3.connected.trianglepath.dotted']);
  else cmux(['clear-status', 'pjman']);
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
  const capped = text.length > CONTEXT_MAX ? text.slice(0, CONTEXT_MAX) + '\n…(cut by the harness; run pjman context for the rest)\n' : text;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: capped } }));
}

/** The first sentence-like line of the assistant's message: headings are skipped, list markers stripped. */
function firstLine(text, max = 200) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const body = lines.filter((l) => !l.startsWith('#') && !/^```/.test(l)).map((l) => l.replace(/^[>*\-\d.)\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 0);
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
    const err = String(e.stderr || e.message).trim().split('\n')[0];
    if (EXISTS.test(err)) return true;
    note(`pjman new session failed: ${err}`);
    return false;
  }
}

/** What a prompt is about: the last reference in it that leads to a change and is not weak. The tool scans the text (`pjman refs`); the
 *  hook knows no shapes. A ticket of the project's tracker with no record is read from the tracker and applied through
 *  the sync, which creates the change with its real title; where the hook has no reader for the tracker, the agent is
 *  told to read and sync it. A pattern match alone never creates a record. */
function promptChange(prompt, { cwd, env }) {
  const refs = tryPjman(['refs', '-', '--json'], { cwd, json: true, input: prompt }) ?? [];
  // a prompt naming several changes is about none of them for certain: nothing binds, the agent is told the candidates
  const named = [...new Set(refs.filter((r) => !r.weak && r.change).map((r) => r.change))];
  if (named.length > 1) return { hint: `This prompt names several changes (${named.join(', ')}); none was bound. If one of them is the work, bind it: pjman session bind <this session> <change>.` };
  for (const r of refs.reverse()) {
    if (r.weak) continue; // a bare #1: as often a list item as an issue
    if (r.change) return { key: r.change };
    if (!r.creatable) continue;
    const created = createFromTracker(r, { cwd, env });
    if (created) return { key: created };
    const sync = r.key.startsWith('github-issue:') ? 'github' : r.key.slice(0, r.key.indexOf(':'));
    return { hint: `${r.text} is ${r.key}; the store has no record of it. Read it with the tracker's tools and apply the answer: pjman sync ${sync} --from - (the change it creates is bound when you name it).` };
  }
  return null;
}

/** GitHub issues: gh is at hand, so the hook reads the issue and the sync creates the change. */
function createFromTracker(r, { cwd, env }) {
  const m = /^github-issue:([^#]+)#(\d+)$/.exec(r.key);
  if (!m) return null;
  const issue = sh('gh', ['issue', 'view', m[2], '-R', m[1], '--json', 'number,title,url,state,stateReason,labels,milestone'], cwd);
  if (!issue) return null;
  if (tryPjman(['sync', 'github', '--from', '-', '--json'], { cwd, env, input: issue }) === null) return null;
  const n = tryPjman(['get', r.key, '--json'], { cwd, json: true });
  return n?.changes?.[0]?.change?.key ?? null;
}

/** The brief for this session: what the store has for it since its last brief, composed and recorded by the tool. Its
 *  size is kept for the person, shown with the receipt when the turn ends. */
function briefFor(st, sid, cwd, env, full = false) {
  return briefText(st, tryPjman(['brief', '--session', sid, '--json', ...(full ? ['--full'] : [])], { cwd, env, json: true }));
}
function briefText(st, b) {
  if (!b || b.mode === 'none' || !b.text) return '';
  st.briefs = [...(st.briefs ?? []), { mode: b.mode, change: b.change, lines: b.size.lines, tokens: b.size.tokens, cut: b.text.length > CONTEXT_MAX }];
  return b.text;
}

/** The session's start. The view docks first; then the reads run side by side (the brief, the board, who the person is,
 *  the receipt's watermark, the branch's change, the done changes for the worktree scan, the open pull request); then the
 *  writes one after another (the session record, its log line, the binding from the branch, the session's brief). The
 *  stale worktrees, matched from the store's done changes, go ahead of the board so the harness's cap cannot cut them. */
async function sessionStart(input, store, sid, env, st, cwd) {
  const main = !input.agent_id;
  const source = input.source || 'startup';
  const docking = main ? dockView(st, sid, cwd) : Promise.resolve();
  const branch = main ? currentBranch(cwd) : null;
  const read = await promiseObject({
    brief: pjmanAsync(['brief'], { cwd }),
    context: pjmanAsync(['context'], { cwd }),
    receipt: st.seq === undefined ? pjmanAsync(['events', '--receipt', '--json'], { cwd, json: true }) : null,
    who: main && (source === 'startup' || source === 'clear') ? pjmanAsync(['whoami', '--verify', '--json'], { cwd, json: true }) : null,
    done: main ? pjmanAsync(['ls', 'change', '--status', 'done', '--json'], { cwd, json: true }) : null,
    pr: main && branch && store_sourceKinds().includes('github-pr') ? shAsync('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], cwd) : null,
  });
  if (!store.actor) {
    note('no actor in ~/.pjman/config.yaml; session record not created');
    await docking;
    return;
  }
  // the one write (decision session-start-fast/start-as-one-write): the record unless it exists, the start line, the
  // change the branch names bound and its edge observed (the ground the session stands on binds it before any prompt
  // does), and the brief: in full when the conversation lost what it had been told (resumed, compacted, cleared)
  const started = { startup: 'session started', clear: 'session started after /clear', resume: 'session resumed; context rehydrated', compact: 'context compacted and rehydrated', fork: 'session forked; context rehydrated' };
  const rehydrated = source === 'resume' || source === 'compact' || source === 'clear';
  const start = await pjmanAsync(
    ['session', 'start', sid, '--agent', AGENT, '--on-behalf-of', store.actor, '--writer', AGENT, '--log', started[source] ?? `session started (${source})`, ...(main && !st.bound && branch ? ['--branch', branch] : []), ...(rehydrated && st.bound ? ['--full'] : []), '--json'],
    { cwd, env, json: true },
  );
  if (!start) {
    await docking;
    return;
  }
  if (main) exportToShell(env);
  if (st.seq === undefined) st.seq = read.receipt?.seq ?? 0; // receipts start from here
  if (start.bound) st.bound = start.bound;
  if (start.observed && st.bound) st.observed.push(`${st.bound}|${start.observed}`);
  let text = (read.brief ?? '') + `\n---\npjman store: ${store.root} (${store.mode}); project ${store.project ?? '(none)'}. This run is session:${sid}; records it writes carry that session.\n\n`;
  const stale = main ? staleWorktreesText(staleWorktrees(cwd, read.done ?? [])) : '';
  if (stale) text += `${stale}\n---\n`;
  text += read.context ?? '';
  const b = briefText(st, start.brief);
  if (b) text += `\n---\n${start.bound ? 'Bound from the branch.\n' : ''}${b}`;
  // who the person is, checked against the apps once a day (the tool caches): only what is off is said, with the
  // command that resolves it; a rename is the person's act, offered and never run unasked
  if (read.who?.notices?.length) text += `\n---\nIdentity (pjman whoami --verify):\n${read.who.notices.map((n) => `- ${n}`).join('\n')}\nOffer the command to the person and never run a rename or a claim unasked.\n`;
  emitContext(EVENT, text);
  if (main) {
    observeKeys(st, sid, cwd, env, workKeys(branch, read.pr));
    await docking;
    sidebarStatus(st.bound);
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
  const input = readStdin();
  const cwd = input.cwd || process.cwd();
  let store;
  try {
    store = pjman(['where', '--json'], { cwd, json: true });
  } catch {
    // not a project yet: a git repository registers itself at session start, unless the user config says otherwise
    if (EVENT !== 'SessionStart' || autoRegisterOff() || !gitTop(cwd)) return;
    if (tryPjman(['init', '--no-start', '--no-adapter'], { cwd }) === null) return;
    try {
      store = pjman(['where', '--json'], { cwd, json: true });
    } catch {
      return;
    }
  }
  _sourceKinds = store.source_kinds ?? [];

  const mainSid = input.session_id;
  if (!mainSid) return;
  const sid = input.agent_id || mainSid; // inside a subagent, the child session is the writer
  const env = { PJMAN_WRITER: AGENT, PJMAN_SESSION: `session:${sid}` };
  const st = loadState(sid);

  switch (EVENT) {
    case 'SessionStart':
      return sessionStart(input, store, sid, env, st, cwd);
    case 'UserPromptSubmit': {
      const prompt = String(input.prompt ?? '');
      const found = promptChange(prompt, { cwd, env });
      const parts = [];
      if (found?.hint) parts.push(found.hint);
      else if (found?.key && st.bound !== found.key) {
        if (tryPjman(['session', 'bind', sid, found.key, '--reason', 'prompt'], { cwd, env }) !== null) {
          st.bound = found.key;
          sidebarStatus(found.key);
          observeWork(st, sid, cwd, env);
        }
      }
      // the brief: in full when the binding moved, else what changed since the last one; nothing when nothing did
      const b = briefFor(st, sid, cwd, env);
      if (b) parts.push(b);
      emitContext(EVENT, parts.join('\n---\n'));
      saveState(sid, st);
      return;
    }
    case 'PostToolUse': {
      // a shell call counts only when it writes the store; reads, builds and tests leave no log line
      const storeWrite = /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:init|new|set|note|session|mv|rm|fmt|sync|order|apply|undo|migrate)\b/;
      if (input.tool_name !== 'Bash' || storeWrite.test(String(input.tool_input?.command ?? ''))) st.acted += 1;
      if (input.tool_name === 'Bash' && /\bgit\s+(checkout|switch)\b|\bgh\s+pr\s+create\b/.test(String(input.tool_input?.command ?? ''))) observeWork(st, sid, cwd, env);
      const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
      if (file && st.bound) {
        // real path of p, or of its nearest existing ancestor (a file may not exist yet)
        const real = (p) => {
          p = path.resolve(p);
          try { return fs.realpathSync(p); } catch { return p === path.dirname(p) ? p : path.join(real(path.dirname(p)), path.basename(p)); }
        };
        const abs = real(path.resolve(cwd, file));
        const project = real(process.env.CLAUDE_PROJECT_DIR || cwd);
        const rel = path.relative(project, abs);
        const inProject = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        const inStore = !path.relative(real(store.root), abs).startsWith('..');
        if (inProject && !inStore && store.source_kinds.includes('file')) {
          const edge = `${st.bound}|file:${rel}`;
          if (!st.observed.includes(edge)) {
            if (tryPjman(['session', 'observe', sid, 'links', st.bound, `file:${rel}`], { cwd, env }) !== null) st.observed.push(edge);
          }
        }
      }
      saveState(sid, st);
      return;
    }
    case 'Stop':
    case 'SubagentStop': {
      if (st.acted > 0) {
        const line = firstLine(input.last_assistant_message);
        if (line) tryPjman(['session', 'log', sid, line], { cwd, env });
        st.acted = 0;
      }
      // the receipt: what this session and the sessions it spawned wrote since the last turn, composed by the tool, shown to the person
      if (EVENT === 'Stop') {
        const r = tryPjman(['events', '--receipt', '--since', String(st.seq ?? 0), '--session', `session:${sid}`, '--json'], { cwd, json: true });
        if (r) {
          // the receipt is read by the person inside the project: the product segment of the project's product is dropped
          const product = store.product ? String(store.product).replace(/^product:/, '') : null;
          const trim = (l) => (product ? l.replace(new RegExp(`\\b(feature|change|decision):${product}/`, 'g'), '$1:') : l);
          const lines = r.lines.map(trim);
          // what the agent was handed this turn, by size (the brief has no ceiling; the person sees what it cost)
          const briefed = (st.briefs ?? []).map((b) => trim(`${b.mode === 'full' ? 'full context' : 'what changed'} on ${b.change}: ${b.lines} line${b.lines === 1 ? '' : 's'}, ~${b.tokens} tokens${b.cut ? ' (cut by the harness at 10,000 characters)' : ''}`));
          const blocks = [];
          if (briefed.length) blocks.push(`pjman briefed:\n${briefed.map((l) => `- ${l}`).join('\n')}`);
          if (lines.length && st.seq !== undefined) blocks.push(`pjman recorded:\n${lines.map((l) => `- ${l}`).join('\n')}`);
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
      undockView(st);
      sidebarStatus(null);
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
