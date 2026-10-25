// Figures: the roll-up as a row of numbers with a word under each. The same shape at every node of the tree.
import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';

export interface Figure {
  value: ReactNode;
  label: string;
  /** Draw the value in the colour of a meaning, e.g. `text-status-blocked` when it is not zero. */
  tone?: string;
}

export function Figures({
  figures,
  dense,
  className,
  ...props
}: { figures: Figure[]; dense?: boolean } & ComponentProps<'dl'>) {
  return (
    <dl
      className={cn(
        'grid gap-3',
        dense ? 'grid-cols-4 gap-2' : 'grid-cols-4 rounded-card border border-line bg-surface px-4 py-3.5',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}
      {...props}
    >
      {figures.map((f) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
          <dd className={cn('m-0 font-semibold tracking-tight', dense ? 'text-base' : 'text-lg', f.tone)}>{f.value}</dd>
          <dt className={cn('truncate text-ink-muted', dense ? 'text-[11px]' : 'text-meta')}>{f.label}</dt>
        </div>
      ))}
    </dl>
  );
}
