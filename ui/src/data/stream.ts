// One event stream per browser (decision dock-fresh-slow-load/one-stream-per-browser). Each open page holding its own
// EventSource filled the browser's six HTTP/1.1 connections to the server, shared by every tab and every cmux pane, so
// a new page and any request queued forever. A SharedWorker holds the one stream and relays its frames to every page;
// a browser without SharedWorker opens a stream per page as before. Nothing here imports the app: the worker loads it.
import type { StoreEvent } from './contract';

export const OPS = [
  'created',
  'set',
  'log',
  'bind',
  'observe',
  'moved',
  'removed',
  'formatted',
  'init',
  'write',
  'applied',
  'reverted',
  'migrated',
] as const satisfies readonly StoreEvent['op'][];

/** What a page receives: the stream opened, failed (the EventSource retries on its own), or carried an event. */
export type Frame =
  | { kind: 'open' }
  | { kind: 'error' }
  | { kind: 'event'; data: string }
  | { kind: 'host'; data: string }
  | { kind: 'now'; data: string };

/** The frames beside the store's own: what a session's host says its program is doing (change:rex-adapter), and what
 *  its agent is doing now (decision dock-redesign/agent-signal). */
export const LIVE_EVENTS = ['host', 'now'] as const;
/** What a page sends the worker: the stream it wants, or that it is leaving. */
export type Request = { kind: 'start'; url: string } | { kind: 'leave' };

/** An EventSource on `url`, each of its happenings as a frame; returns its close. */
export function openStream(url: string, emit: (f: Frame) => void): () => void {
  const es = new EventSource(url);
  const relay = (kind: 'event' | 'host' | 'now') => (ev: Event) => {
    if (ev instanceof MessageEvent && typeof ev.data === 'string') emit({ kind, data: ev.data });
  };
  for (const op of OPS) es.addEventListener(op, relay('event'));
  for (const name of LIVE_EVENTS) es.addEventListener(name, relay(name));
  es.addEventListener('open', () => emit({ kind: 'open' }));
  es.addEventListener('error', () => emit({ kind: 'error' }));
  return () => es.close();
}

export interface Port {
  postMessage(f: Frame): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<Request>) => void): void;
  start?(): void;
}

/** The session a `now` frame is about, and whether it still names an action (no text clears it). */
function nowOf(data: string): { key: string; standing: boolean } | undefined {
  try {
    const n: unknown = JSON.parse(data);
    if (typeof n !== 'object' || n === null) return undefined;
    const key: unknown = Reflect.get(n, 'key');
    const text: unknown = Reflect.get(n, 'text');
    return typeof key === 'string' ? { key, standing: typeof text === 'string' && text !== '' } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The worker's state: the pages attached and the one stream they share. The stream opens with the first page's start
 * and closes when the last page leaves; a page attaching to an open stream is told so at once, with each session's
 * standing action: the server sends those only when a stream opens, so a page joining the shared one later would
 * otherwise read none until the agent's next call (change:dock-now-lines).
 */
export function createHub(open: (url: string, emit: (f: Frame) => void) => () => void) {
  const ports = new Set<Port>();
  let close: (() => void) | undefined;
  let connected = false;
  /** The latest `now` frame of each session whose action stands, as the stream carried it. */
  const standing = new Map<string, Frame>();

  const broadcast = (f: Frame) => {
    if (f.kind === 'open') connected = true;
    else if (f.kind === 'error') connected = false;
    else if (f.kind === 'now') {
      const n = nowOf(f.data);
      if (n?.standing) standing.set(n.key, f);
      else if (n) standing.delete(n.key);
    }
    // a MessagePort: it takes no target origin
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    for (const p of ports) p.postMessage(f);
  };

  return {
    attach(port: Port) {
      port.addEventListener('message', (ev) => {
        const req = ev.data;
        if (req.kind === 'start') {
          ports.add(port);
          if (!close) close = open(req.url, broadcast);
          else if (connected) {
            port.postMessage({ kind: 'open' });
            for (const f of standing.values()) port.postMessage(f);
          }
        } else if (req.kind === 'leave') {
          ports.delete(port);
          if (!ports.size && close) {
            close();
            close = undefined;
            connected = false;
            standing.clear();
          }
        }
      });
      port.start?.();
    },
    get size() {
      return ports.size;
    },
  };
}
