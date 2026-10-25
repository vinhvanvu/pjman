// The frame: rail on the left, top bar, content. At narrow width the rail becomes a drawer the top bar opens.
import { cn } from 'cn';
import type { ReactNode } from 'react';

export interface AppShellProps {
  wide: boolean;
  rail: ReactNode;
  bar: ReactNode;
  children: ReactNode;
  railOpen?: boolean;
  onCloseRail?: () => void;
  className?: string;
}

export function AppShell({ wide, rail, bar, children, railOpen, onCloseRail, className }: AppShellProps) {
  return (
    <div className={cn('flex h-full min-h-0 bg-ground text-ink', className)}>
      {wide ? (
        rail
      ) : railOpen ? (
        <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="h-full shadow-xl">{rail}</div>
          <button type="button" aria-label="Close the rail" onClick={onCloseRail} className="flex-1 bg-black/40" />
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {bar}
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
