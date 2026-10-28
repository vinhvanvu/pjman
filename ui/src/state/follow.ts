// Following a session: the session this tab was opened on, or adopted by hand from a session's page. It is kept per
// tab, so a reload keeps it and another tab never inherits it; a session is a uuid, and this is the only way back to
// it by name. Paused is never stored: it is read from where the person stands (features/session-follow/model.ts).
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface Follow {
  /** The session this tab follows. */
  home?: string;
  adopt: (session: string) => void;
  forget: () => void;
}

/** Per-tab storage; a private window or blocked site data can refuse it, and following then lives in memory. */
function tabStorage(): Storage {
  try {
    const s = window.sessionStorage;
    s.getItem('pjman.follow');
    return s;
  } catch {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v),
    };
  }
}

export const useFollow = create<Follow>()(
  persist(
    (set) => ({
      home: undefined,
      adopt: (home) => set({ home }),
      forget: () => set({ home: undefined }),
    }),
    { name: 'pjman.follow', storage: createJSONStorage(tabStorage), partialize: (s) => ({ home: s.home }) },
  ),
);
