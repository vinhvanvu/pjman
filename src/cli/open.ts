// pjman open: the dashboard brought back, at a session's page when one is named (decision session-open/open-not-markdown).
// Where the terminal can dock a browser pane (cmux), the page opens beside it; elsewhere in the default browser.
import { execFileSync, spawn } from 'node:child_process';
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

/** Open a URL: docked beside the terminal in cmux, else in the default browser. Says where it went. */
export function openPage(url: string, env: NodeJS.ProcessEnv = process.env): 'docked' | 'browser' {
  if (inCmux(env)) {
    try {
      execFileSync('cmux', ['browser', 'open', url], { stdio: 'ignore', timeout: 5000, env });
      return 'docked';
    } catch {
      // no cmux CLI on the PATH, or its socket refused: the browser still works
    }
  }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  return 'browser';
}
