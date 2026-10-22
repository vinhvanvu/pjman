#!/usr/bin/env node
// The Claude Code adapter for pjman: one script, one event per invocation, every write through `pjman`.
// Never blocks, never fails the session: on any error it logs to the plugin data directory and exits 0.
//
//   SessionStart      create the session record if needed; inject `pjman context` (and the bound change's context on resume/compact)
//   UserPromptSubmit  a prompt naming a change, a ticket id or a URL binds the change it resolves to (the getter); a ticket of the project's tracker with no change gets one; the change's context is injected the first time
//   PostToolUse       an edit, or a shell call that writes the store, marks the turn as having acted; a file write records an observed `links` edge from the bound change
//   Stop              a turn that acted appends one log line, from the harness's last message
//   SubagentStart     a child session with `parent`
//   SubagentStop      the child's log line
//   SessionEnd        a closing log line

import { execFileSync } from 'node:child_process';
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

function pjman(args, { cwd, env = {}, json = false } = {}) {
  const [cmd, ...pre] = PJMAN;
  const out = execFileSync(cmd, [...pre, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
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
    return { acted: 0, bound: null, hydrated: [], observed: [] };
  }
}
function saveState(sid, st) {
  fs.mkdirSync(path.dirname(stateFile(sid)), { recursive: true });
  fs.writeFileSync(stateFile(sid), JSON.stringify(st));
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

function changeKeys(cwd) {
  const rows = tryPjman(['ls', 'change', '--json'], { cwd, json: true });
  return rows ? rows.map((r) => r.key) : [];
}

/** change:<slug> anywhere in the prompt; or a bare existing slug containing a hyphen, as a whole word. Last mention wins. */
function namedChange(prompt, keys) {
  const found = [];
  for (const m of prompt.matchAll(/\bchange:([a-z0-9][a-z0-9-]*)/g)) if (keys.includes(`change:${m[1]}`)) found.push({ i: m.index, key: `change:${m[1]}` });
  for (const key of keys) {
    const slug = key.slice('change:'.length);
    if (!slug.includes('-')) continue;
    for (const m of prompt.matchAll(new RegExp(`(^|[^a-z0-9:/-])${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9-])`, 'gi'))) found.push({ i: m.index, key });
  }
  found.sort((a, b) => a.i - b.i);
  return found.length ? found[found.length - 1].key : null;
}

/** Ticket ids (ABC-1234) and URLs in the prompt, in order of appearance. */
function references(prompt) {
  const found = [];
  // ticket-shaped words that are not tickets
  const notTicket = /^(UTF|SHA|ISO|RFC|CVE|MD|AES|RSA|HTTP|TLS|ES|HTML|CSS|PEP|ECMA|IPV|X)-/;
  for (const m of prompt.matchAll(/\b[A-Z][A-Z0-9]*-\d+\b/g)) if (!notTicket.test(m[0])) found.push({ i: m.index, ref: m[0] });
  for (const m of prompt.matchAll(/https?:\/\/[^\s<>()"']+/g)) found.push({ i: m.index, ref: m[0].replace(/[.,;:!?]+$/, '') });
  return found.sort((a, b) => a.i - b.i).map((f) => f.ref);
}

/** The change a ticket id or URL in the prompt resolves to, through `pjman get`; last mention wins. A ticket of the
 *  project's tracker that no change binds gets a change (slug: the id lower-cased, title: the id, binds: the ticket). */
function referencedChange(prompt, store, { cwd, env }) {
  for (const ref of references(prompt).reverse()) {
    const n = tryPjman(['get', ref, '--json'], { cwd, json: true });
    if (!n || n.resolution.status === 'none') continue;
    if (n.changes.length) return n.changes[0].change.key;
    const key = n.resolution.key || '';
    const kind = key.slice(0, key.indexOf(':'));
    if (!store.tracker || kind !== store.tracker || n.resolution.status !== 'key') continue;
    const id = key.slice(kind.length + 1);
    const slug = id.toLowerCase();
    if (tryPjman(['new', 'change', slug, '--title', id, '--binds', key], { cwd, env }) !== null) return `change:${slug}`;
  }
  return null;
}

// --- main ---------------------------------------------------------------------------------------
function main() {
  const input = readStdin();
  const cwd = input.cwd || process.cwd();
  let store;
  try {
    store = pjman(['where', '--json'], { cwd, json: true });
  } catch {
    return; // not a pjman project: the adapter is silent
  }

  const mainSid = input.session_id;
  if (!mainSid) return;
  const sid = input.agent_id || mainSid; // inside a subagent, the child session is the writer
  const env = { PJMAN_WRITER: AGENT, PJMAN_SESSION: `session:${sid}` };
  const st = loadState(sid);

  switch (EVENT) {
    case 'SessionStart': {
      if (!ensureSession(store, sid, env, { cwd })) return;
      const source = input.source || 'startup';
      const started = { startup: 'session started', clear: 'session started after /clear', resume: 'session resumed; context rehydrated', compact: 'context compacted and rehydrated', fork: 'session forked; context rehydrated' };
      tryPjman(['session', 'log', sid, started[source] ?? `session started (${source})`], { cwd, env });
      let text = `pjman store: ${store.root} (${store.mode}). This run is session:${sid}; records it writes carry that session.\n\n`;
      text += tryPjman(['context'], { cwd }) ?? '';
      if ((source === 'resume' || source === 'compact') && st.bound) {
        const ctx = tryPjman(['context', st.bound], { cwd });
        if (ctx) text += `\n---\nBound change:\n\n${ctx}`;
      }
      emitContext(EVENT, text);
      return;
    }
    case 'UserPromptSubmit': {
      const prompt = String(input.prompt ?? '');
      const key = namedChange(prompt, changeKeys(cwd)) ?? referencedChange(prompt, store, { cwd, env });
      if (!key) return;
      if (st.bound !== key) {
        if (tryPjman(['session', 'bind', sid, key], { cwd, env }) !== null) st.bound = key;
      }
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
      const storeWrite = /\bpjman\s+(?:--\S+(?:\s+\S+)?\s+)*(?:init|new|set|session|mv|fmt)\b/;
      if (input.tool_name !== 'Bash' || storeWrite.test(String(input.tool_input?.command ?? ''))) st.acted += 1;
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
        saveState(sid, st);
      }
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
