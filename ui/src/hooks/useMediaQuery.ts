import { useSyncExternalStore } from 'react';

/** Subscribe to a media query; renders true on the server-less first paint only when it matches. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The width at which the app shows two panes and a rail. Below it, one column and a menu. */
export const WIDE = '(min-width: 860px)';
export const useWide = () => useMediaQuery(WIDE);
