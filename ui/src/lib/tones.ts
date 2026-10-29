// The colours of meaning, in one place: every state the app shows (a change's status, a session's state, a decision
// waiting or decided) maps here to the theme's tokens, and every surface that colours one of them reads it from here,
// so a working session is the same green on the strip, the lanes, the transport and the pill, and a thing waiting on
// the person is the same amber everywhere. A tone is a set of whole class names (Tailwind reads them as written):
// `text` for words and chips, `bg` for a dot or a bar, `soft` for a tinted ground, `line` for a border, `wash` for the
// tint a live arrival leaves on what it changed (lib/motion).
import type { SessionState, StoreEvent, TimelineEvent } from '@/data/contract';

export interface Tone {
  text: string;
  bg: string;
  soft: string;
  line: string;
  wash: string;
}

/** What a meaning looks like. Each is one of the theme's status tokens or its ink. */
export const TONE = {
  live: { text: 'text-live', bg: 'bg-live', soft: 'bg-live/10', line: 'border-live/60', wash: 'bg-live/20' },
  /** Waits on the person: a proposed decision, a session stopped on one, a page held at a moment. */
  waits: {
    text: 'text-status-review',
    bg: 'bg-status-review',
    soft: 'bg-status-review/10',
    line: 'border-status-review/60',
    wash: 'bg-status-review/20',
  },
  alarm: {
    text: 'text-status-blocked',
    bg: 'bg-status-blocked',
    soft: 'bg-status-blocked/10',
    line: 'border-status-blocked/60',
    wash: 'bg-status-blocked/20',
  },
  done: {
    text: 'text-status-done',
    bg: 'bg-status-done',
    soft: 'bg-status-done/10',
    line: 'border-status-done/60',
    wash: 'bg-status-done/20',
  },
  active: {
    text: 'text-status-active',
    bg: 'bg-status-active',
    soft: 'bg-status-active/10',
    line: 'border-status-active/60',
    wash: 'bg-status-active/20',
  },
  planning: {
    text: 'text-status-planning',
    bg: 'bg-status-planning',
    soft: 'bg-status-planning/10',
    line: 'border-status-planning/60',
    wash: 'bg-status-planning/20',
  },
  open: {
    text: 'text-status-open',
    bg: 'bg-status-open',
    soft: 'bg-status-open/10',
    line: 'border-status-open/60',
    wash: 'bg-status-open/20',
  },
  dropped: {
    text: 'text-status-dropped',
    bg: 'bg-status-dropped',
    soft: 'bg-status-dropped/10',
    line: 'border-status-dropped/60',
    wash: 'bg-status-dropped/20',
  },
  quiet: {
    text: 'text-ink-muted',
    bg: 'bg-ink-muted',
    soft: 'bg-raised',
    line: 'border-line-strong',
    wash: 'bg-ink-faint/15',
  },
  faint: {
    text: 'text-ink-faint',
    bg: 'bg-ink-faint',
    soft: 'bg-raised',
    line: 'border-line',
    wash: 'bg-ink-faint/15',
  },
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

/** A decision: proposed waits on the person, decided is done, superseded has stepped aside. A status not known reads
 *  as proposed, since a decision that may still wait is the one to show. */
export const decisionTone = (status: string | undefined): Tone =>
  status === 'decided' ? TONE.done : status === 'superseded' ? TONE.faint : TONE.waits;

/** What an event's arrival flashes in (decision motion-design/when-motion-plays): a decision its status as the write
 *  left it, amber opened, green decided; a session's line the live green; a write to a change its active colour;
 *  anything else quiet. */
export function eventTone(e: Pick<TimelineEvent, 'type' | 'status' | 'statusNow'>): Tone {
  if (e.type === 'decision') return decisionTone(e.status ?? e.statusNow);
  if (e.type === 'session') return TONE.live;
  if (e.type === 'change') return TONE.active;
  return TONE.quiet;
}

/** The same for an event as the stream delivers it, which carries no status: a decision opened is proposed, a write
 *  to a decision's status most often decides it. */
export const streamTone = (e: Pick<StoreEvent, 'type' | 'op' | 'fields'>): Tone =>
  eventTone({
    type: e.type,
    status:
      e.type !== 'decision'
        ? undefined
        : e.op === 'created'
          ? 'proposed'
          : e.fields?.includes('status')
            ? 'decided'
            : undefined,
  });

/** The glow a live dot carries. */
export const GLOW = 'shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)]';

/** A session's dot: its state's colour, glowing while it works. */
export const sessionDot = (state: SessionState): string =>
  state === 'working' ? `${SESSION.working.bg} ${GLOW}` : SESSION[state].bg;
