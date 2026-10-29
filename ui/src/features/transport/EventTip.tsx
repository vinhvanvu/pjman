// The tip over an event on the transport's bar and the lanes: shown the moment the pointer is on a tick, beat or
// flag, and gone when it leaves. The browser's own title waits a beat and gives up when the targets are a few
// pixels wide and close together, which is every target here. One tip per surface, placed against the surface's
// own frame so the bar's clipping never cuts it.
import { cn } from 'cn';
import { useCallback, useState, type RefObject } from 'react';
import type { TimelineEvent } from '@/data/contract';
import { clock } from '@/features/moment';
import { decisionTone } from '@/lib/tones';
import { eventWords, whoWrote } from './model';

/** The height a tip needs above its point; nearer the top than this, it hangs below. */
const ROOM = 80;

interface Tip {
  e: TimelineEvent;
  left: number;
  top: number;
  /** Where the label sits against its point: centred, or held to the edge it would cross. */
  edge: 'start' | 'centre' | 'end';
  below: boolean;
}

/** The tip's state for a surface: `show` with the event and the element under the pointer, `hide` when it leaves.
 *  `below` hangs it under its point, for a surface at the top of the page; elsewhere it hangs above, unless the point
 *  is too near the top of the surface for it to fit. */
export function useEventTip(frame: RefObject<HTMLElement | null>, below = false) {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback(
    (e: TimelineEvent, el: Element) => {
      const f = frame.current?.getBoundingClientRect();
      if (!f) return;
      const r = el.getBoundingClientRect();
      const left = r.left + r.width / 2 - f.left;
      const edge = left < 160 ? 'start' : left > f.width - 160 ? 'end' : 'centre';
      const under = below || r.top - f.top < ROOM;
      setTip({ e, left, top: under ? r.bottom - f.top : r.top - f.top, edge, below: under });
    },
    [frame, below],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

const STATUS_WORDS: Record<string, string> = { proposed: 'waits on you', decided: 'decided', superseded: 'superseded' };

export function EventTip({ tip, now }: { tip: Tip | null; now: number }) {
  if (!tip) return null;
  const { e } = tip;
  const who = whoWrote(e);
  const standing = e.type === 'decision' ? (e.statusNow ?? e.status) : undefined;
  return (
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-20 flex max-w-[360px] flex-col gap-0.5 rounded-row border border-line bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md',
        tip.edge === 'centre' ? '-translate-x-1/2' : tip.edge === 'end' ? '-translate-x-full' : '',
        !tip.below && '-translate-y-full',
      )}
      style={{ left: tip.left, top: tip.below ? tip.top + 6 : tip.top - 6 }}
    >
      <span className="flex items-center gap-2 text-meta text-ink-faint tabular-nums">
        <span className="font-mono">#{e.seq}</span>
        <span>{clock(e.at, now)}</span>
        {who && <span className="truncate">{who}</span>}
      </span>
      <span className="text-ink">{eventWords(e)}</span>
      {standing && (
        <span className={cn('text-meta font-medium', decisionTone(standing).text)}>
          {e.status && e.status !== standing
            ? `${e.status} then · ${STATUS_WORDS[standing] ?? standing} now`
            : (STATUS_WORDS[standing] ?? standing)}
        </span>
      )}
    </div>
  );
}
