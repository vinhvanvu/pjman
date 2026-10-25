// Preferences: client state that is the person's, persisted in the browser under one key. Nothing here identifies what
// is being looked at (that is the URL) and nothing here comes from the API (that is the query cache).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/themes';

export const PREFERENCES_KEY = 'pjman.preferences';

export interface Preferences {
  theme: ThemeId;
  railCollapsed: boolean;
  /** Expanded tree nodes, remembered per container (`lens:container`). */
  expanded: Record<string, string[]>;
  /** Where the split between panes sits, per split id. */
  splits: Record<string, Record<string, number>>;
  setTheme: (theme: ThemeId) => void;
  setRailCollapsed: (collapsed: boolean) => void;
  setExpanded: (scope: string, ids: string[]) => void;
  setSplit: (id: string, layout: Record<string, number>) => void;
}

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      railCollapsed: false,
      expanded: {},
      splits: {},
      setTheme: (theme) => set({ theme: isThemeId(theme) ? theme : DEFAULT_THEME }),
      setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
      setExpanded: (scope, ids) => set((s) => ({ expanded: { ...s.expanded, [scope]: ids } })),
      setSplit: (id, layout) => set((s) => ({ splits: { ...s.splits, [id]: layout } })),
    }),
    {
      name: PREFERENCES_KEY,
      partialize: (s) => ({ theme: s.theme, railCollapsed: s.railCollapsed, expanded: s.expanded, splits: s.splits }),
    },
  ),
);
