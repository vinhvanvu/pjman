// Nothing here: said once, quietly, with what would fill it.
import { cn } from 'cn';
import type { ComponentProps, ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  className,
  ...props
}: { title: ReactNode; hint?: ReactNode } & ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-1 rounded-card border border-dashed border-line-strong px-4 py-5',
        className,
      )}
      {...props}
    >
      <div className="text-ink-muted">{title}</div>
      {hint && <div className="text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
