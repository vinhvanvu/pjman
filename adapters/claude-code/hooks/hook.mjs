#!/usr/bin/env node
// The Claude Code adapter for pjman: one script, one event per invocation, every write through `pjman`.
// Never blocks, never fails the session: on any error it logs to the plugin data directory and exits 0.
//
//   SessionStart      register the repository if it is not a project yet (auto_register); create the session record; inject the brief,
//                     `pjman context` (and the bound change's context on resume/compact); observe the branch and the open PR
//   UserPromptSubmit  a prompt naming a change, a ticket or a URL binds the change it leads to (pjman refs); a ticket of the project's tracker with no record is read from the tracker and created through the sync (gh for GitHub), or the agent is told to; the change's context is injected the first time
//   PostToolUse       an edit, or a shell call that writes the store, marks the turn as having acted; a file write records an observed `links` edge from the bound change
//   Stop              a turn that acted appends one log line, from the harness's last message; the receipt of what the store received since the last turn is shown to the person
//   SubagentStart     a child session with `parent`
//   SubagentStop      the child's log line
//   SessionEnd        a closing log line; the view's pane is closed
//
//   The view beside the session. In cmux: the dashboard's session page (pjman serve, started if none is running) is docked in a
//   browser pane at session start and closed at session end. Elsewhere: `pjman view --session <id> --out <file> --watch` runs
//   beside the session, subscribed to the store's event stream, and keeps view/<id>.md current for any viewer; the hooks only
//   render it themselves when they bind.

import { execFileSync, spawn } from 'node:child_process';
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
  const out = execFileSync(cmd, [...pre, ...args], {
    cwd, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], input,
    env: { ...process.env, ...env },
  });
  return json ? JSON.parse(out) : out;
}

function tryPjman(args, opts) {
  try {
    return pjman(args, opts);
  } catch (e) {
    note(`pjman ${args.join(' ')} failed: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    return null;
  }
}

// --- state per session: what this adapter remembers between hook invocations --------------------
function stateFile(sid) {
  return path.join(dataDir, 'state', `${sid}.json`);
}
function loadState(sid) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sid), 'utf8'));
  } catch {
    return { acted: 0, bound: null, hydrated: [], observed: [], pane: null, watcher: null, seq: undefined };
  }
}
function saveState(sid, st) {
  fs.mkdirSync(path.dirname(stateFile(sid)), { recursive: true });
  fs.writeFileSync(stateFile(sid), JSON.stringify(st));
}

// --- the repository, the branch, the pull request ---------------------------------------------------
function sh(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } }).trim();
  } catch {
    return null;
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
  const keys = [];
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (branch && !['HEAD', 'main', 'master'].includes(branch) && store_sourceKinds().includes('branch')) keys.push(`branch:${branch}`);
  const prUrl = store_sourceKinds().includes('github-pr') ? sh('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], cwd) : null;
  const m = prUrl && /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (m) keys.push(`github-pr:${m[1]}#${m[2]}`);
  for (const key of keys) {
    const edge = `${st.bound}|${key}`;
    if (st.observed.includes(edge)) continue;
    if (tryPjman(['session', 'observe', sid, 'links', st.bound, key], { cwd, env }) !== null) st.observed.push(edge);
  }
}
let _sourceKinds = null;
const store_sourceKinds = () => _sourceKinds ?? [];

// --- the view beside the session --------------------------------------------------------------
function viewFile(sid) {
  return path.join(dataDir, 'view', `${sid}.md`);
}

/** Re-render what the session is on. Cheap enough to run on every event; the event stream will make it exact. */
function refreshView(sid, cwd) {
  const file = viewFile(sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  tryPjman(['view', '--session', sid, '--out', file], { cwd });
  return file;
}

/** The subscriber: one detached `pjman view --watch` per session, following the stream until the session ends. */
function startWatcher(st, sid, cwd) {
  if (st.watcher) {
    try {
      process.kill(st.watcher, 0);
      return; // still running
    } catch {}
  }
  const [cmd, ...pre] = PJMAN;
  try {
    const child = spawn(cmd, [...pre, 'view', '--session', sid, '--out', viewFile(sid), '--watch'], { cwd, detached: true, stdio: 'ignore', env: process.env });
    child.unref();
    st.watcher = child.pid ?? null;
  } catch (e) {
    note(`watcher failed to start: ${e.message}`);
  }
}
function stopWatcher(st) {
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
function ensureServer(cwd) {
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
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
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
function dockView(st, sid, cwd, file) {
  if (st.pane || !inCmux()) return;
  const server = ensureServer(cwd);
  const out = server
    ? cmux(['browser', 'open', `${server.url}/session/${encodeURIComponent(sid)}`])
    : cmux(['markdown', 'open', file]);
  const m = out && /surface[=:\s]+(surface:\d+|[0-9a-fA-F-]{36})/.exec(out);
  if (m) st.pane = m[1];
  else if (out) note(`dock: could not read the surface from: ${out.trim().split('\n')[0]}`);
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

function emitContext(event, text) {
  if (!text) return;
  const capped = text.length > 9500 ? text.slice(0, 9500) + '\n…(truncated; run pjman context for the rest)\n' : text;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: capped } }));
}

/** The first sentence-like line of the assistant's message: headings are skipped, list markers stripped. */
function firstLine(text, max = 200) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const body = lines.filter((l) => !l.startsWith('#') && !/^```/.test(l)).map((l) => l.replace(/^[>*\-\d.)\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 0);
  const line = body ?? (lines[0] ?? '').replace(/^#+\s*/, '');
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function ensureSession(store, sid, env, { parent, cwd } = {}) {
  const rows = tryPjman(['ls', 'session', '--json'], { cwd, json: true }) ?? [];
  if (rows.some((r) => r.key === `session:${sid}`)) return true;
  if (!store.actor) {
    note('no actor in ~/.pjman/config.yaml; session record not created');
    return false;
  }
  const args = ['new', 'session', sid, '--agent', AGENT, '--on-behalf-of', store.actor, '--writer', AGENT];
  if (parent) args.push('--parent', `session:${parent}`);
  return tryPjman(args, { cwd, env }) !== null;
}

/** What a prompt is about: the last reference in it that leads to a change. The tool scans the text (`pjman refs`); the
 *  hook knows no shapes. A ticket of the project's tracker with no record is read from the tracker and applied through
 *  the sync, which creates the change with its real title; where the hook has no reader for the tracker, the agent is
 *  told to read and sync it. A pattern match alone never creates a record. */
function promptChange(prompt, { cwd, env }) {
  const refs = tryPjman(['refs', '-', '--json'], { cwd, json: true, input: prompt }) ?? [];
  for (const r of refs.reverse()) {
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

// --- main ---------------------------------------------------------------------------------------
function main() {
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
    case 'SessionStart': {
      if (!ensureSession(store, sid, env, { cwd })) return;
      if (st.seq === undefined) st.seq = tryPjman(['events', '--receipt', '--json'], { cwd, json: true })?.seq ?? 0; // receipts start from here
      const source = input.source || 'startup';
      const started = { startup: 'session started', clear: 'session started after /clear', resume: 'session resumed; context rehydrated', compact: 'context compacted and rehydrated', fork: 'session forked; context rehydrated' };
      tryPjman(['session', 'log', sid, started[source] ?? `session started (${source})`], { cwd, env });
      let text = (tryPjman(['brief'], { cwd }) ?? '') + `\n---\npjman store: ${store.root} (${store.mode}); project ${store.project ?? '(none)'}. This run is session:${sid}; records it writes carry that session.\n\n`;
      text += tryPjman(['context'], { cwd }) ?? '';
      if ((source === 'resume' || source === 'compact') && st.bound) {
        const ctx = tryPjman(['context', st.bound], { cwd });
        if (ctx) text += `\n---\nBound change:\n\n${ctx}`;
      }
      emitContext(EVENT, text);
      if (!input.agent_id) {
        observeWork(st, sid, cwd, env);
        const file = refreshView(sid, cwd);
        dockView(st, sid, cwd, file);
        if (!st.pane) startWatcher(st, sid, cwd); // no browser pane: keep the document current for any viewer
        sidebarStatus(st.bound);
        saveState(sid, st);
      }
      return;
    }
    case 'UserPromptSubmit': {
      const prompt = String(input.prompt ?? '');
      const found = promptChange(prompt, { cwd, env });
      if (!found) return;
      if (found.hint) {
        emitContext(EVENT, found.hint);
        return;
      }
      const key = found.key;
      if (st.bound !== key) {
        if (tryPjman(['session', 'bind', sid, key], { cwd, env }) !== null) {
          st.bound = key;
          sidebarStatus(key);
          observeWork(st, sid, cwd, env);
        }
      }
      refreshView(sid, cwd);
      if (!st.hydrated.includes(key)) {
        const ctx = tryPjman(['context', key], { cwd });
        if (ctx) {
          st.hydrated.push(key);
          emitContext(EVENT, ctx);
        }
      }
      saveState(sid, st);
      return;
    }
    case 'PostToolUse': {
      // a shell call counts only when it writes the store; reads, builds and tests leave no log line
      const storeWrite = /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:init|new|set|session|mv|rm|fmt|sync)\b/;
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
      // the receipt: what the store received since the last turn, composed by the tool, shown to the person
      if (EVENT === 'Stop') {
        const r = tryPjman(['events', '--receipt', '--since', String(st.seq ?? 0), '--json'], { cwd, json: true });
        if (r) {
          const lines = r.lines.filter((l) => !l.startsWith(`session:${sid}:`));
          if (lines.length && st.seq !== undefined) process.stdout.write(JSON.stringify({ systemMessage: `pjman recorded:\n${lines.map((l) => `- ${l}`).join('\n')}` }));
          st.seq = r.seq;
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
      stopWatcher(st);
      refreshView(sid, cwd);
      undockView(st);
      sidebarStatus(null);
      saveState(sid, st);
      return;
    }
    default:
      note(`unknown event`);
  }
}

try {
  main();
} catch (e) {
  note(`error: ${e && e.stack ? e.stack.split('\n')[0] : String(e)}`);
}
process.exitCode = 0;
