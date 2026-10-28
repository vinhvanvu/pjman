// The top bar: the node's breadcrumb in this lens, presence beneath it, and the jump palette. At narrow width it also
// carries the button that opens the rail. Nothing else is chrome.
import { cn } from 'cn';
import { Menu, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lens } from '@/data/contract';
import { NodeLink } from '@/components/links/NodeLink';
import { Presence } from '@/components/presence/Presence';

export interface Crumb {
  key: string;
  title?: string;
  name?: string;
}

export interface TopBarProps {
  lens: Lens;
  crumbs: Crumb[];
  current?: { key: string; title?: string };
  /** A word for the current node's kind, shown faint after it (project, capability). */
  kind?: string;
  liveSessions?: number;
  onOpenPalette?: () => void;
  onOpenRail?: () => void;
  /** Something that sits before the palette: the following pill. */
  trailing?: ReactNode;
  className?: string;
}

export function TopBar({
  lens,
  crumbs,
  current,
  kind,
  liveSessions = 0,
  onOpenPalette,
  onOpenRail,
  trailing,
  className,
}: TopBarProps) {
  return (
    <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:px-5', className)}>
      {onOpenRail && (
        <button
          type="button"
          onClick={onOpenRail}
          aria-label="Open the rail"
          className="grid size-8 place-items-center rounded-row text-ink-muted hover:bg-raised"
        >
          <Menu className="size-4" />
        </button>
      )}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 overflow-hidden">
        {crumbs.map((c) => (
          <span key={c.key} className="flex min-w-0 items-center gap-2">
            <NodeLink
              to={c.key}
              lens={lens}
              title={c.title}
              className="max-w-[220px] truncate text-ink-muted hover:text-ink"
            >
              {c.name ?? c.title ?? c.key}
            </NodeLink>
            <span className="text-ink-faint">›</span>
          </span>
        ))}
        {current && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="max-w-[420px] truncate font-medium" title={current.title}>
              {current.title ?? current.key}
            </span>
            {kind && <span className="shrink-0 text-xs text-ink-faint">{kind}</span>}
          </span>
        )}
      </nav>
      {(crumbs.length > 0 || current) && <div className="flex-1" />}
      {trailing}
      {liveSessions > 0 && (
        <Presence className="hidden sm:inline-flex">
          {liveSessions} live {liveSessions === 1 ? 'session' : 'sessions'}
        </Presence>
      )}
      {onOpenPalette && (
        <button
          type="button"
          onClick={onOpenPalette}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-row border border-line-strong px-2.5 text-xs whitespace-nowrap text-ink-muted hover:bg-raised hover:text-ink"
        >
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Jump to</span>
          <kbd className="font-mono text-[11px] text-ink-faint">⌘K</kbd>
        </button>
      )}
    </header>
  );
}
