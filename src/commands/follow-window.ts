// pjman open --follow: the follow window opened as a window of its own (change:follow-window, decision
// follow-window/window-not-tab), never a tab lost among the others: an app window on a Chromium browser (no tabs, no
// address bar), a new window in Safari and Firefox, Arc's own small window for links from other apps. The browser is
// the person's default, or the one `follow_browser` names in ~/.pjman/config.yaml.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface WindowPlan {
  /** The browser, as the person would name it. */
  browser: string;
  how: 'app' | 'window' | 'little' | 'default';
  cmd: string;
  args: string[];
}

/** The browsers a window is opened in by name, by their macOS bundle id. */
const BROWSERS: Record<string, { name: string; kind: 'chromium' | 'safari' | 'firefox' | 'arc' }> = {
  'com.google.chrome': { name: 'Google Chrome', kind: 'chromium' },
  'com.google.chrome.beta': { name: 'Google Chrome Beta', kind: 'chromium' },
  'com.google.chrome.canary': { name: 'Google Chrome Canary', kind: 'chromium' },
  'com.microsoft.edgemac': { name: 'Microsoft Edge', kind: 'chromium' },
  'com.brave.browser': { name: 'Brave Browser', kind: 'chromium' },
  'com.vivaldi.vivaldi': { name: 'Vivaldi', kind: 'chromium' },
  'org.chromium.chromium': { name: 'Chromium', kind: 'chromium' },
  'company.thebrowser.browser': { name: 'Arc', kind: 'arc' },
  'com.apple.safari': { name: 'Safari', kind: 'safari' },
  'org.mozilla.firefox': { name: 'Firefox', kind: 'firefox' },
};

/** The browser named in the config (`Safari`, `Google Chrome`) or by bundle id, as an entry above when it is one. */
function known(browser: string): { name: string; kind: 'chromium' | 'safari' | 'firefox' | 'arc' } | undefined {
  const b = browser.trim().toLowerCase();
  return BROWSERS[b] ?? Object.values(BROWSERS).find((x) => x.name.toLowerCase() === b);
}

/** How a window is opened at `url` in `browser` (a name or a bundle id; none: the system's own opener) on `platform`. */
export function windowPlan(url: string, browser: string | undefined, platform: NodeJS.Platform = process.platform): WindowPlan {
  if (platform !== 'darwin') {
    const cmd = platform === 'win32' ? 'start' : 'xdg-open';
    return { browser: 'default', how: 'default', cmd, args: [url] };
  }
  const b = browser ? known(browser) : undefined;
  if (!b) return browser ? { browser, how: 'default', cmd: 'open', args: ['-a', browser, url] } : { browser: 'default', how: 'default', cmd: 'open', args: [url] };
  switch (b.kind) {
    case 'chromium':
      return { browser: b.name, how: 'app', cmd: 'open', args: ['-na', b.name, '--args', `--app=${url}`] };
    case 'safari':
      return { browser: b.name, how: 'window', cmd: 'osascript', args: ['-e', `tell application "Safari" to make new document with properties {URL:${JSON.stringify(url)}}`, '-e', 'tell application "Safari" to activate'] };
    case 'firefox':
      // `open -n` refuses a Firefox already running; its own binary hands the window to the one running
      return { browser: b.name, how: 'window', cmd: `/Applications/${b.name}.app/Contents/MacOS/firefox`, args: ['--new-window', url] };
    case 'arc':
      return { browser: b.name, how: 'little', cmd: 'open', args: ['-a', b.name, url] };
  }
}

/** The bundle id of the person's default browser on macOS (the handler of https), or undefined when it cannot be read. */
export function defaultBrowser(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const plist = path.join(os.homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
    const out = execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return handlerOf(JSON.parse(out) as { LSHandlers?: unknown });
  } catch {
    return undefined;
  }
}

/** The https handler in LaunchServices' handlers, lower-cased. */
export function handlerOf(prefs: { LSHandlers?: unknown }): string | undefined {
  const list = Array.isArray(prefs.LSHandlers) ? (prefs.LSHandlers as Record<string, unknown>[]) : [];
  const h = list.find((x) => x.LSHandlerURLScheme === 'https') ?? list.find((x) => x.LSHandlerURLScheme === 'http');
  const id = h?.LSHandlerRoleAll;
  return typeof id === 'string' ? id.toLowerCase() : undefined;
}

/** Open the follow window at `url`: in the browser the config names, else the default one. Says how. */
export function openWindow(url: string, browser: string | undefined): WindowPlan {
  const plan = windowPlan(url, browser ?? defaultBrowser());
  // a test names a file instead: the window it would open is written there, and no browser is opened
  if (process.env.PJMAN_OPEN_LOG) {
    fs.appendFileSync(process.env.PJMAN_OPEN_LOG, `${JSON.stringify({ url, ...plan })}\n`);
    return plan;
  }
  spawn(plan.cmd, plan.args, { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  return plan;
}
