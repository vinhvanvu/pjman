// The colours of meaning, in one place: every state the app shows (a change's status, a session's state, a decision
// waiting or decided) maps here to the theme's tokens, and every surface that colours one of them reads it from here,
// so a working session is the same green on the strip, the lanes, the transport and the pill, and a thing waiting on
// the person is the same amber everywhere. A tone is a set of whole class names (Tailwind reads them as written):
// `text` for words and chips, `bg` for a dot or a bar, `soft` for a tinted ground, `line` for a border.
import type { SessionState } from '@/data/contract';

export interface Tone {
  text: string;
  bg: string;
  soft: string;
  line: string;
}

/** What a meaning looks like. Each is one of the theme's status tokens or its ink. */
export const TONE = {
  live: { text: 'text-live', bg: 'bg-live', soft: 'bg-live/10', line: 'border-live/60' },
  /** Waits on the person: a proposed decision, a session stopped on one, a page held at a moment. */
  waits: {
    text: 'text-status-review',
    bg: 'bg-status-review',
    soft: 'bg-status-review/10',
    line: 'border-status-review/60',
  },
  alarm: {
    text: 'text-status-blocked',
    bg: 'bg-status-blocked',
    soft: 'bg-status-blocked/10',
    line: 'border-status-blocked/60',
  },
  done: { text: 'text-status-done', bg: 'bg-status-done', soft: 'bg-status-done/10', line: 'border-status-done/60' },
  active: {
    text: 'text-status-active',
    bg: 'bg-status-active',
    soft: 'bg-status-active/10',
    line: 'border-status-active/60',
  },
  planning: {
    text: 'text-status-planning',
    bg: 'bg-status-planning',
    soft: 'bg-status-planning/10',
    line: 'border-status-planning/60',
  },
  open: { text: 'text-status-open', bg: 'bg-status-open', soft: 'bg-status-open/10', line: 'border-status-open/60' },
  dropped: {
    text: 'text-status-dropped',
    bg: 'bg-status-dropped',
    soft: 'bg-status-dropped/10',
    line: 'border-status-dropped/60',
  },
  quiet: { text: 'text-ink-muted', bg: 'bg-ink-muted', soft: 'bg-raised', line: 'border-line-strong' },
  faint: { text: 'text-ink-faint', bg: 'bg-ink-faint', soft: 'bg-raised', line: 'border-line' },
} as const satisfies Record<string, Tone>;

/** A change's status. Unknown statuses read as open. */
const STATUS: Record<string, Tone> = {
  active: TONE.active,
  review: TONE.waits,
  blocked: TONE.alarm,
  planning: TONE.planning,
  open: TONE.open,
  done: TONE.done,
  dropped: TONE.dropped,
};
export const statusTone = (status: string | undefined): Tone => STATUS[status ?? 'open'] ?? TONE.open;

/** A session's state, by what it needs from the person: working is live, waiting is the person's, stopped is quiet,
 *  ended is faint. */
export const SESSION: Record<SessionState, Tone> = {
  working: TONE.live,
  waiting: TONE.waits,
  stopped: TONE.quiet,
  ended: TONE.faint,
};

/** A decision: proposed waits on the person; decided is done. */
export const decisionTone = (status: string | undefined): Tone => (status === 'proposed' ? TONE.waits : TONE.done);

/** The glow a live dot carries. */
export const GLOW = 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)]';

/** A session's dot: its state's colour, glowing while it works. */
export const sessionDot = (state: SessionState): string =>
  state === 'working' ? `${SESSION.working.bg} ${GLOW}` : SESSION[state].bg;
