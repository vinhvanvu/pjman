// The dashboard's motion vocabulary (change:motion-design), one place every live surface draws from. Only what is
// alive moves (decision when-motion-plays): an arrival from the live stream; nothing the person does animates, so a
// list keyed on the moment it reads remounts at once instead. Space follows the element (decision
// space-follows-the-element): a departure fades in its slot and the gap closes after; an arrival's space opens, then
// it fades in. A wash of the event's colour marks what an arrival changed, and it is kept under reduced motion, where
// nothing slides, grows or collapses (MotionConfig reducedMotion="user" drops transforms and layout, keeps opacity).
import { cn } from 'cn';
import { domMax, LazyMotion, m, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** A move: a slide to the new place, the space opening or closing around an arrival or a departure. */
export const MOVE = { duration: 0.32, ease: EASE };
/** An arrival fades in once its space has opened. */
export const ENTER = { duration: 0.28, ease: EASE, delay: MOVE.duration };
/** A departure fades where it stands; its space closes after. */
export const EXIT = { duration: 0.2, ease: 'easeIn' } as const;
/** How long the wash of an arrival's colour takes to fade. */
export const WASH = { duration: 1.6, ease: 'easeOut' } as const;

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user" transition={MOVE}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}

/** An item of a live list, inside AnimatePresence initial={false}: it slides when its place changes, enters after
 *  its space has opened, and holds its slot while it leaves. */
export const liveItem = {
  layout: 'position',
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: ENTER },
  exit: { opacity: 0, scale: 0.97, transition: EXIT },
  transition: MOVE,
} as const;

/** A whole view moving to another subject with what it follows (the dock to the session's new change), inside
 *  AnimatePresence mode="wait": the old view fades where it stands, then the new one comes in from the top. */
export const swapView = {
  initial: { opacity: 0, y: -8, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { ...ENTER, delay: 0 } },
  exit: { opacity: 0, transition: EXIT },
  style: { transformOrigin: 'top' },
} as const;

/** The wash an arrival leaves on what it changed: a tint of its colour over the element, fading. Keyed by the
 *  arrival, so each plays once, when it mounts. The parent is `relative`. */
export function Wash({ arrival, className }: { arrival?: number; className?: string }) {
  if (arrival === undefined) return null;
  return (
    <m.span
      key={arrival}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 rounded-[inherit]', className)}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={WASH}
    />
  );
}

/** The flash of a mark an arrival lit (the now marker, a beat, a flag): a glow of the event's colour around it,
 *  fading. `className` carries the colour as `text-*`. */
export function Flash({ arrival, className }: { arrival?: number; className?: string }) {
  if (arrival === undefined) return null;
  return (
    <m.span
      key={arrival}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] bg-current shadow-[0_0_10px_3px_currentColor]',
        className,
      )}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={WASH}
    />
  );
}
