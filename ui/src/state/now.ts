// What each session's agent is doing now (decision dock-redesign/agent-signal): the latest action the plugin told the
// server, as `now` frames on the event stream deliver it. Held here and nowhere else; no frame refetches a page. A frame
// with no text clears the session's action. The dock's now line reads it while the session works.
import { create } from 'zustand';

export interface NowAction {
  text: string;
  tool?: string;
  at: string;
}

interface NowState {
  bySession: Readonly<Record<string, NowAction>>;
  /** A `now` frame as the stream carries it. */
  take: (frame: string) => void;
}

/** How long an action stands without a newer one: past it the line says Working again (the server's NOW_MS). */
export const NOW_MS = 10 * 60_000;

export const useNowStore = create<NowState>()((set) => ({
  bySession: {},
  take: (frame) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const field = (name: string): string | undefined => {
      const v: unknown = Reflect.get(parsed, name);
      return typeof v === 'string' && v ? v : undefined;
    };
    const key = field('key');
    if (!key) return;
    const text = field('text');
    set((s) => {
      const bySession = { ...s.bySession };
      if (text) bySession[key] = { text, tool: field('tool'), at: field('at') ?? new Date().toISOString() };
      else delete bySession[key];
      return { bySession };
    });
  },
}));

/** Whether an action is younger than `ms`. */
export function stands(a: Pick<NowAction, 'at'>, ms = NOW_MS, now = Date.now()): boolean {
  return now - Date.parse(a.at) < ms;
}

/** The session's latest action, while it still stands. */
export function useNowAction(session: string): NowAction | undefined {
  const a = useNowStore((s) => s.bySession[session]);
  return a && stands(a) ? a : undefined;
}
