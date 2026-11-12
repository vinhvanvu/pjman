// pjman's now module (decision dock-redesign/agent-signal): what the agent is doing, for the dock's now line. Every tool
// call, before it runs, is told to the running dashboard in a few words ("Reading src/a.ts", "Running the tests") and
// the call goes on at once: the post is never awaited, so a call costs nothing it would feel, and a dashboard that is
// down costs a failed fetch. The server holds the latest action in memory only (POST /now); nothing reaches the store.
// The session's end clears it (clearNow). The dashboard's address is ~/.pjman/serve.json, read again at most every 30 seconds.
// A plugin has one hooks module: wake.ts registers these beside its own (registerNow).
import type { EngineInterface, Register, ToolCallInput } from 'claude-code';

const ADDRESS_MS = 30_000;
let address: { url?: string; until: number } | undefined;

async function serverUrl($: EngineInterface): Promise<string | undefined> {
  if (address && address.until > Date.now()) return address.url;
  let url: string | undefined;
  try {
    const home = (await $.env.get('PJMAN_HOME')) ?? `${await $.env.get('HOME')}/.pjman`;
    const a = JSON.parse(await $.fs.read(`${home}/serve.json`)) as { url?: unknown };
    url = typeof a.url === 'string' ? a.url : undefined;
  } catch {
    url = undefined; // no dashboard running: nothing to tell
  }
  address = { url, until: Date.now() + ADDRESS_MS };
  return url;
}

/** A path as the line shows it: its last three parts. */
const tail = (p: unknown): string => (typeof p === 'string' ? p.split('/').filter(Boolean).slice(-3).join('/') : '');
const clip = (s: unknown, n = 60): string => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The action in a few words, as Claude's own rows say it. */
export function actionWords(e: { tool: string } & Record<string, unknown>): string {
  switch (e.tool) {
    case 'Read':
      return `Reading ${tail(e.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${tail(e.file_path)}`;
    case 'Write':
      return `Writing ${tail(e.file_path)}`;
    case 'NotebookEdit':
      return `Editing ${tail(e.notebook_path)}`;
    case 'Bash':
      return e.description ? clip(e.description) : `Running ${clip(e.command, 48)}`;
    case 'Grep':
      return `Searching for ${clip(e.pattern, 40)}`;
    case 'Glob':
      return `Finding ${clip(e.pattern, 40)}`;
    case 'WebFetch':
      try {
        return `Fetching ${new URL(String(e.url)).hostname}`;
      } catch {
        return 'Fetching a page';
      }
    case 'WebSearch':
      return `Searching the web for ${clip(e.query, 40)}`;
    case 'Agent':
    case 'Task':
      return e.description ? `Delegating: ${clip(e.description, 48)}` : 'Delegating to an agent';
    case 'TodoWrite':
      return 'Updating the to-do list';
    case 'Skill':
      return e.skill ? `Loading the ${clip(e.skill, 30)} skill` : 'Loading a skill';
    case 'AskUserQuestion':
      return 'Asking you a question';
    default:
      if (e.tool.startsWith('mcp__')) {
        const [, server, name] = e.tool.split('__');
        return `Using ${name ?? 'a tool'} on ${server ?? 'a server'}`;
      }
      return `Using ${e.tool}`;
  }
}

async function tell($: EngineInterface, text: string | undefined, tool?: string): Promise<void> {
  try {
    const url = await serverUrl($);
    if (!url) return;
    const session = await $.session.id();
    await $.http.fetch(`${url}/api/v1/now`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, text, tool }),
    });
  } catch {
    address = undefined; // the dashboard moved or stopped: read its address again next time
  }
}

export const registerNow: Register = (on) => {
  on('tool.call', ($, e, next) => {
    void tell($, actionWords(e as ToolCallInput & Record<string, unknown>), e.tool);
    return next(e);
  });
};

/** The session ended: nothing is being done in it now (wake.ts's session.end calls it). */
export function clearNow($: EngineInterface): Promise<void> {
  return tell($, undefined);
}
