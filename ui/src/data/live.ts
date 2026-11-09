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
import { productOfKey, reaches } from './reach';
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
    // the products the events since the last refetch were in; null once one was in none (a session, a project), which
    // reaches every page
    let reached: Set<string> | null = new Set();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const flush = () => {
      timer = undefined;
      last = Date.now();
      const products = reached;
      reached = new Set();
      void client.invalidateQueries({
        queryKey: queryKeys.all,
        predicate: (q) => products === null || reaches(q.queryKey, products),
      });
    };
    const invalidate = (e: StoreEvent) => {
      const p = productOfKey(e.key);
      if (p === null) reached = null;
      else reached?.add(p);
      // the first event of a burst refetches after a beat, the rest at most once a second (change:dashboard-reads-slow)
      timer ??= setTimeout(flush, Math.max(150, last + 1000 - Date.now()));
    };
    const unsubscribe = subscribe(`${BASE}/events`, (f) => {
      if (f.kind === 'open') setState((s) => ({ ...s, connected: true }));
      else if (f.kind === 'error') setState((s) => ({ ...s, connected: false }));
      else {
        const e = JSON.parse(f.data) as StoreEvent;
        setState({ connected: true, last: e });
        useArrivals.getState().arrive(e);
        invalidate(e);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [client]);

  return state;
}
