// pjman open: the dashboard brought back, at a session's page when one is named (decision session-open/open-not-markdown).
// Where the terminal can dock a browser pane (cmux), the page opens beside it; elsewhere in the default browser.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { userDir } from '../store/config.js';
import type { ServeAddress } from '../server/server.js';

/** The dashboard's URL for a session, or its front page. The page takes the bare id, as the dock opens it. */
export function openUrl(address: ServeAddress, session?: string): string {
  if (!session) return address.url;
  const id = session.startsWith('session:') ? session.slice('session:'.length) : session;
  return `${address.url}/session/${encodeURIComponent(id)}`;
}

/** True when this process runs inside cmux, whose socket CLI docks a browser pane in the current workspace. */
export function inCmux(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CMUX_PANEL_ID || env.CMUX_BUNDLE_ID);
}

/** The workspace's dock file, shared with the Claude Code hook (adapters/claude-code/hooks/hook.mjs, the dock section):
 *  one pane per cmux workspace, kept by UUID (decision pjman-24/shared-pane). */
function dockFile(env: NodeJS.ProcessEnv): string | null {
  const w = env.CMUX_WORKSPACE_ID || env.CMUX_SURFACE_ID || env.CMUX_PANEL_ID;
  return w ? path.join(userDir(), 'dock', `${w.replace(/[^\w.-]/g, '_')}.json`) : null;
}
type Dock = { pane: string | null; sid: string | null; sessions: Record<string, unknown> };
const cmuxRun = (args: string[], env: NodeJS.ProcessEnv): string | null => {
  try {
    return execFileSync('cmux', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, env });
  } catch {
    return null;
  }
};
/** Docked in cmux: the workspace's pane brought to the url, or a pane opened and recorded as the workspace's, so the
 *  hook moves and closes it as its own and a pane the person closed comes back. Under the hook's lock. */
function dockPage(url: string, env: NodeJS.ProcessEnv, session?: string): boolean {
  const file = dockFile(env);
  if (!file) return cmuxRun(['browser', 'open', url], env) !== null;
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const until = Date.now() + 10000;
  let held = false;
  while (!held) {
    try {
      fs.closeSync(fs.openSync(lock, 'wx'));
      held = true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 20000) fs.rmSync(lock, { force: true });
      } catch {}
      if (Date.now() > until) break; // a lock held this long: open the pane anyway, unrecorded
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    let dock: Dock = { pane: null, sid: null, sessions: {} };
    try {
      dock = { ...dock, ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Dock>) };
    } catch {}
    const sid = session ? session.replace(/^session:/, '') : null;
    const w = env.CMUX_WORKSPACE_ID;
    const tree = cmuxRun(['--id-format', 'uuids', 'tree', ...(w ? ['--workspace', w] : [])], env);
    const alive = tree === null ? null : new Set([...tree.matchAll(/\bsurface\s+(\S+)/g)].map((m) => m[1]));
    const up = dock.pane
      ? alive
        ? alive.has(dock.pane)
        : cmuxRun(['browser', '--surface', dock.pane, 'get', 'url'], env) !== null
      : false;
    if (up && cmuxRun(['browser', '--surface', dock.pane!, 'navigate', url], env) !== null) dock.sid = sid;
    else {
      const out = cmuxRun(['--id-format', 'uuids', 'browser', 'open', url], env);
      if (out === null) return false;
      dock.pane = /surface[=:\s]+(surface:\d+|[0-9a-fA-F-]{36})/.exec(out)?.[1] ?? null;
      dock.sid = sid;
    }
    if (held) fs.writeFileSync(file, JSON.stringify(dock));
    return true;
  } finally {
    if (held) fs.rmSync(lock, { force: true });
  }
}

/** Open a URL: docked beside the terminal in cmux (the workspace's pane, decision pjman-24/shared-pane), else in the
 *  default browser. Says where it went. */
export function openPage(url: string, env: NodeJS.ProcessEnv = process.env, session?: string): 'docked' | 'browser' {
  // no cmux CLI on the PATH, or its socket refused: the browser still works
  if (inCmux(env) && dockPage(url, env, session)) return 'docked';
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  return 'browser';
}
