// Chips: one dot, one word. A status chip takes a status and never a colour; the meaning is the theme's to colour.
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';
import { statusTone } from '@/lib/tones';

const chip = cva(
  'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-[7px] text-meta font-medium leading-none',
  {
    variants: {
      tone: {
        outline: 'border border-line-strong text-ink-muted',
        quiet: 'bg-raised text-ink-muted',
        accent: 'bg-accent text-accent-foreground',
      },
      mono: { true: 'font-mono', false: '' },
    },
    defaultVariants: { tone: 'outline', mono: false },
  },
);

export interface ChipProps extends ComponentProps<'span'>, VariantProps<typeof chip> {}

export function Chip({ className, tone, mono, ...props }: ChipProps) {
  return <span data-slot="chip" className={cn(chip({ tone, mono }), className)} {...props} />;
}

export function StatusChip({
  status,
  className,
  ...props
}: { status: string | undefined } & Omit<ChipProps, 'children'>) {
  const s = status ?? 'open';
  return (
    <Chip className={cn(statusTone(s).text, className)} {...props}>
      <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
      {s}
    </Chip>
  );
}

/** A feature's derived state → the token that colours its dot. */
export const STATE_COLOR: Record<string, string> = {
  live: 'bg-state-live',
  building: 'bg-state-building',
  planned: 'bg-state-planned',
  retired: 'bg-state-retired',
};

export function StateDot({
  state,
  className,
  title,
}: {
  state: string | undefined;
  className?: string;
  title?: string;
}) {
  const s = state ?? 'planned';
  return (
    <span
      role="img"
      aria-label={title ?? s}
      title={title ?? s}
      className={cn('inline-block size-2 shrink-0 rounded-full', STATE_COLOR[s] ?? STATE_COLOR.planned, className)}
    />
  );
}

/** The tracked uppercase label: a level, a section title. */
export function Label({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('label', className)} {...props} />;
}

/** A key as people write it, in the mono face. */
export function KeyText({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('font-mono text-meta text-ink-muted', className)} {...props} />;
}
