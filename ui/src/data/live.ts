// The event stream keeps the cache honest: every event invalidates everything under the pjman key, debounced so a
// burst of writes (one command, several records) refetches once. Each event is recorded as a live arrival, the one
// thing the page animates (state/arrivals). The hook also reports whether the stream is open. The stream is shared by
// every page of the browser through a SharedWorker (data/stream); without one, the page opens its own.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useArrivals } from '@/state/arrivals';
import { BASE } from './client';
import type { StoreEvent } from './contract';
import { queryKeys } from './queries';
import { type Frame, openStream, type Request } from './stream';

export interface LiveState {
  connected: boolean;
  /** The last event seen, for anything that wants to react to one. */
  last?: StoreEvent;
}

/** Frames from the browser's shared stream, or from a stream of this page's own; returns the unsubscribe. */
function subscribe(url: string, onFrame: (f: Frame) => void): () => void {
  if (typeof SharedWorker === 'undefined') return openStream(url, onFrame);
  let worker: SharedWorker;
  try {
    worker = new SharedWorker(new URL('./stream.worker.ts', import.meta.url), { type: 'module', name: 'pjman-events' });
  } catch {
    return openStream(url, onFrame);
  }
  const port = worker.port;
  // a worker that fails to load leaves the page to a stream of its own
  let own: (() => void) | undefined;
  worker.onerror = () => {
    own ??= openStream(url, onFrame);
  };
  port.onmessage = (ev: MessageEvent<Frame>) => onFrame(ev.data);
  port.start();
  const send = (r: Request) => port.postMessage(r);
  const join = () => send({ kind: 'start', url: new URL(url, location.href).href });
  // a page closed without unmounting still leaves, so the stream closes with the last page; one kept in the
  // back-forward cache leaves too, and joins again when it is shown
  const leave = () => send({ kind: 'leave' });
  const shown = (ev: PageTransitionEvent) => {
    if (ev.persisted) join();
  };
  join();
  addEventListener('pagehide', leave);
  addEventListener('pageshow', shown);
  return () => {
    removeEventListener('pagehide', leave);
    removeEventListener('pageshow', shown);
    leave();
    port.close();
    own?.();
  };
}

export function useLiveInvalidation(): LiveState {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>({ connected: false });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void client.invalidateQueries({ queryKey: queryKeys.all }), 150);
    };
    const unsubscribe = subscribe(`${BASE}/events`, (f) => {
      if (f.kind === 'open') setState((s) => ({ ...s, connected: true }));
      else if (f.kind === 'error') setState((s) => ({ ...s, connected: false }));
      else {
        const e = JSON.parse(f.data) as StoreEvent;
        setState({ connected: true, last: e });
        useArrivals.getState().arrive(e);
        invalidate();
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [client]);

  return state;
}
