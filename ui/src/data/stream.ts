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
  | { kind: 'host'; data: string };

/** The frames beside the store's own: what a session's host says its program is doing (change:rex-adapter). */
export const LIVE_EVENTS = ['host'] as const;
/** What a page sends the worker: the stream it wants, or that it is leaving. */
export type Request = { kind: 'start'; url: string } | { kind: 'leave' };

/** An EventSource on `url`, each of its happenings as a frame; returns its close. */
export function openStream(url: string, emit: (f: Frame) => void): () => void {
  const es = new EventSource(url);
  const onEvent = (ev: MessageEvent) => emit({ kind: 'event', data: ev.data as string });
  for (const op of OPS) es.addEventListener(op, onEvent as EventListener);
  for (const name of LIVE_EVENTS)
    es.addEventListener(name, ((ev: MessageEvent) => emit({ kind: 'host', data: ev.data as string })) as EventListener);
  es.addEventListener('open', () => emit({ kind: 'open' }));
  es.addEventListener('error', () => emit({ kind: 'error' }));
  return () => es.close();
}

export interface Port {
  postMessage(f: Frame): void;
  onmessage: ((ev: MessageEvent<Request>) => void) | null;
  start?(): void;
}

/**
 * The worker's state: the pages attached and the one stream they share. The stream opens with the first page's start
 * and closes when the last page leaves; a page attaching to an open stream is told so at once.
 */
export function createHub(open: (url: string, emit: (f: Frame) => void) => () => void) {
  const ports = new Set<Port>();
  let close: (() => void) | undefined;
  let connected = false;

  const broadcast = (f: Frame) => {
    if (f.kind === 'open') connected = true;
    else if (f.kind === 'error') connected = false;
    for (const p of ports) p.postMessage(f);
  };

  return {
    attach(port: Port) {
      port.onmessage = (ev) => {
        const req = ev.data;
        if (req.kind === 'start') {
          ports.add(port);
          if (!close) close = open(req.url, broadcast);
          else if (connected) port.postMessage({ kind: 'open' });
        } else if (req.kind === 'leave') {
          ports.delete(port);
          if (!ports.size && close) {
            close();
            close = undefined;
            connected = false;
          }
        }
      };
      port.start?.();
    },
    get size() {
      return ports.size;
    },
  };
}
