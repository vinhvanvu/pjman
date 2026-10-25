// Following a session: which one the board is locked to (pinned), and whether following is paused because the person
// navigated by hand. The pin survives a reload; the pause does not.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Follow {
  pinned?: string;
  paused: boolean;
  pin: (session: string) => void;
  unpin: () => void;
  pause: () => void;
  resume: () => void;
}

export const useFollow = create<Follow>()(
  persist(
    (set) => ({
      pinned: undefined,
      paused: false,
      pin: (pinned) => set({ pinned, paused: false }),
      unpin: () => set({ pinned: undefined, paused: false }),
      pause: () => set({ paused: true }),
      resume: () => set({ paused: false }),
    }),
    { name: 'pjman.follow', partialize: (s) => ({ pinned: s.pinned }) },
  ),
);
