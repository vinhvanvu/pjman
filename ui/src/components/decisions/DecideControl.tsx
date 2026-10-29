// Deciding in place (change:decide-in-place, decision accept-holds-then-writes): one control wherever a proposed
// decision shows its text. A first click turns Accept into Confirm where it stands, with a way to back out; only the
// second click calls `onConfirm` (the caller's POST /decide), and that write is what wakes the sessions bound to the
// change. Unconfirmed, it falls back after a few seconds, or when a mouse leaves it. With `reopen` the same control sets
// a decided decision back to proposed, which wakes nobody. It sits inside rows and cards that are buttons or links
// themselves, so its clicks go nowhere else. The caller leaves it out on a page held at a past moment.
import { cn } from 'cn';
import { Check, X } from 'lucide-react';
import { m } from 'motion/react';
import { type KeyboardEvent, type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { TONE } from '@/lib/tones';

/** How long Confirm stands unconfirmed before it falls back to Accept. */
const ARMED_MS = 4000;
/** A mouse that leaves the control has this long to come back before Confirm falls back. */
const LEAVE_MS = 700;

/** The words change where they stand: the new line rises in, and the old one leaves at once, so nothing it was can
 *  linger on screen or under the pointer. */
const SWAP = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.16 },
};

const stop = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

export function DecideControl({
  decision,
  onConfirm,
  reopen = false,
  className,
}: {
  decision: string;
  /** The write; its rejection's message is shown on the row. */
  onConfirm: () => Promise<unknown>;
  /** Reopen a decided decision instead of accepting a proposed one. */
  reopen?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'armed' | 'pending'>('idle');
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // the Confirm that replaced the button the person pressed takes the focus it had
  useEffect(() => {
    if (state === 'armed') confirmRef.current?.focus();
  }, [state]);

  const arm = (ms: number) => {
    clearTimeout(timer.current);
    setState('armed');
    timer.current = setTimeout(() => setState('idle'), ms);
  };
  const disarm = () => {
    clearTimeout(timer.current);
    setState('idle');
  };
  const first = (e: MouseEvent) => {
    stop(e);
    setError(undefined);
    arm(ARMED_MS);
  };
  const confirm = (e: MouseEvent) => {
    stop(e);
    clearTimeout(timer.current);
    setState('pending');
    onConfirm().then(
      () => setState('idle'),
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState('idle');
      },
    );
  };
  const back = (e: MouseEvent) => {
    stop(e);
    disarm();
  };
  const leave = (e: PointerEvent) => {
    if (state === 'armed' && e.pointerType === 'mouse') arm(LEAVE_MS);
  };
  const enter = (e: PointerEvent) => {
    if (state === 'armed' && e.pointerType === 'mouse') arm(ARMED_MS);
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && state === 'armed') disarm();
  };

  const tone = reopen ? 'text-ink-muted hover:text-ink' : cn(TONE.done.text, 'hover:brightness-110');
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-meta whitespace-nowrap', className)}>
      {state === 'armed' ? (
        <m.span key="armed" {...SWAP} className="inline-flex items-center gap-1">
          <button
            ref={confirmRef}
            type="button"
            onClick={confirm}
            onPointerLeave={leave}
            onPointerEnter={enter}
            onKeyDown={escape}
            className={cn('inline-flex items-center gap-1 rounded-row px-2 py-0.5 font-medium ring-1 ring-current', tone)}
            title={reopen ? `Set ${decision} back to proposed` : `Decide ${decision}; the sessions on its change are woken`}
          >
            <Check className="size-3" aria-hidden="true" />
            {reopen ? 'Confirm reopen' : 'Confirm accept'}
          </button>
          <button
            type="button"
            onClick={back}
            onPointerLeave={leave}
            onPointerEnter={enter}
            onKeyDown={escape}
            className="rounded-row p-0.5 text-ink-faint hover:text-ink"
            aria-label="Back out"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </m.span>
      ) : state === 'pending' ? (
        <m.span key="pending" {...SWAP} className="px-2 py-0.5 text-ink-faint">
          {reopen ? 'Reopening…' : 'Accepting…'}
        </m.span>
      ) : (
        <m.span key="idle" {...SWAP} className="inline-flex items-center gap-1.5">
          {error && (
            <span className={cn('max-w-[28ch] truncate', TONE.alarm.text)} title={error}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={first}
            className={cn('inline-flex items-center gap-1 rounded-row px-2 py-0.5 font-medium', tone)}
          >
            {reopen ? 'Reopen' : 'Accept'}
          </button>
        </m.span>
      )}
    </span>
  );
}
