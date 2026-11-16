// The follow window's own stream (change:follow-window): while this tab is the follow window it holds GET
// /api/v1/follow as server-sent events, which the server counts as an open window, and each `follow` frame names the
// session the person prompted. Following, the window goes there; looking around, it holds and the pill offers it
// (decision follow-window/steered-window). The store's stream is the browser's shared one and stays as it is.
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { BASE } from '@/data/client';
import { useFollow } from '@/state/follow';
import { onPrompted, sessionId } from './model';

export function useFollowWindow(): void {
  const isWindow = useFollow((s) => s.window);
  const router = useRouter();
  useEffect(() => {
    if (!isWindow || typeof EventSource === 'undefined') return undefined;
    const es = new EventSource(`${BASE}/follow?stream=1`);
    es.addEventListener('follow', (ev) => {
      if (!(ev instanceof MessageEvent) || typeof ev.data !== 'string') return;
      let key: string | undefined;
      try {
        const frame: { key?: string } = JSON.parse(ev.data);
        key = frame.key;
      } catch {
        return;
      }
      if (!key) return;
      const id = sessionId(key);
      const { home, offer } = useFollow.getState();
      const loc = router.state.location;
      const search = loc.search as { sel?: string; tab?: string };
      const standing = {
        onSessionRoute: home !== undefined && loc.pathname === `/session/${encodeURIComponent(home)}`,
        looking: !!search.sel || (!!search.tab && search.tab !== 'overview'),
      };
      const act = onPrompted(home, id, standing);
      if (act === 'go') void router.navigate({ to: '/session/$id', params: { id }, search: {} });
      else if (act === 'hold') offer(id);
    });
    return () => es.close();
  }, [isWindow, router]);
}
