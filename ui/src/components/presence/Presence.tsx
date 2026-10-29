// Presence: the pulsing dot that means a session is live here, with or without words.
import { cn } from 'cn';
import type { ComponentProps } from 'react';
import { sessionDot } from '@/lib/tones';

export function Pulse({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', sessionDot('working'), className)}
      {...props}
    />
  );
}

export function Presence({ children, className, ...props }: ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex items-center gap-[7px] text-xs text-ink-muted', className)} {...props}>
      <Pulse />
      {children}
    </span>
  );
}
