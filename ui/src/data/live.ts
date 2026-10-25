// The event stream keeps the cache honest: every event invalidates everything under the pjman key, debounced so a
// burst of writes (one command, several records) refetches once. The hook also reports whether the stream is open.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BASE } from './client';
import type { StoreEvent } from './contract';
import { queryKeys } from './queries';

const OPS = ['created', 'set', 'log', 'bind', 'observe', 'moved', 'removed', 'formatted', 'init', 'write'] as const;

export interface LiveState {
  connected: boolean;
  /** The last event seen, for anything that wants to react to one. */
  last?: StoreEvent;
}

export function useLiveInvalidation(): LiveState {
  const client = useQueryClient();
  const [state, setState] = useState<LiveState>({ connected: false });

  useEffect(() => {
    const es = new EventSource(`${BASE}/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void client.invalidateQueries({ queryKey: queryKeys.all }), 150);
    };
    const onEvent = (ev: MessageEvent) => {
      const e = JSON.parse(ev.data as string) as StoreEvent;
      setState({ connected: true, last: e });
      invalidate();
    };
    for (const op of OPS) es.addEventListener(op, onEvent as EventListener);
    es.addEventListener('open', () => setState((s) => ({ ...s, connected: true })));
    es.addEventListener('error', () => setState((s) => ({ ...s, connected: false })));
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [client]);

  return state;
}
