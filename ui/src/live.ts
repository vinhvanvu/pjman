import { useEffect, useState } from 'react';
import { api, type StoreEvent } from './api';

/** Load `fetcher` and reload it whenever the store emits an event that `concerns` (default: any event). */
export function useLive<T>(fetcher: () => Promise<{ seq: number; data: T }>, deps: unknown[], concerns?: (e: StoreEvent) => boolean) {
  const [state, setState] = useState<{ data?: T; seq?: number; error?: Error; loading: boolean }>({ loading: true });
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () =>
      fetcher()
        .then((r) => alive && setState({ data: r.data, seq: r.seq, loading: false }))
        .catch((e: Error) => alive && setState({ error: e, loading: false }));
    void load();
    const stop = api.subscribe((e) => {
      if (concerns && !concerns(e)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 120);
    });
    return () => {
      alive = false;
      stop();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
