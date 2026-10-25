// Presence: the pulsing dot that means a session is live here, with or without words.
import { cn } from 'cn';
import type { ComponentProps } from 'react';

export function Pulse({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full bg-live shadow-[0_0_0_3px_color-mix(in_srgb,var(--live)_25%,transparent)]',
        className,
      )}
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
