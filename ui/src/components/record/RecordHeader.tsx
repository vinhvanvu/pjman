// The record pane's header: what is shown, its kind, the path from the scope to it, and the acts on it (focus, close),
// then the tabs. The orientation anchor: the breadcrumb says where you stand, this says what you are looking at.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { Crosshair, X } from 'lucide-react';
import type { Tab } from '@/data/contract';
import { Label } from '@/components/chips/Chip';
import { Button } from '@/components/ui/button';

export interface RecordHeaderProps {
  /** The kind, as a word: product, feature, capability, project, milestone, change. */
  kind: string;
  /** True when the pane shows the scope itself because nothing is selected. */
  isScope: boolean;
  /** The chain from the scope down to the selection, the selection excluded. */
  path: { key: string; label: string }[];
  tab: Tab;
  tabs: readonly Tab[];
  /** Counts shown beside a tab, when there is something to count. */
  tabCounts?: Partial<Record<Tab, number>>;
  onFocus?: () => void;
  onClose?: () => void;
  className?: string;
}

const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', activity: 'Activity', decisions: 'Decisions' };

export function RecordHeader({
  kind,
  isScope,
  path,
  tab,
  tabs,
  tabCounts,
  onFocus,
  onClose,
  className,
}: RecordHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex flex-col gap-2 border-b border-line bg-ground/95 px-5 pt-3 backdrop-blur md:px-6',
        tabs.length <= 1 && 'pb-2',
        className,
      )}
    >
      <div className="flex min-h-7 items-center gap-2">
        <Label className={isScope ? 'text-ink-faint' : 'text-primary'}>
          {isScope ? `this ${kind}` : `selected ${kind}`}
        </Label>
        {path.length > 0 && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
            <span>·</span>
            {path.map((p) => (
              <span key={p.key} className="flex min-w-0 items-center gap-1.5">
                <span className="max-w-[160px] truncate">{p.label}</span>
                <span>›</span>
              </span>
            ))}
          </span>
        )}
        <div className="flex-1" />
        {onFocus && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onFocus}
            title="Make this the scope (double-click does too)"
          >
            <Crosshair className="size-3.5" />
            Focus
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Clear the selection">
            <X className="size-4" />
          </Button>
        )}
      </div>
      {/* one tab is no tab (decision feature-detail/one-node-record): a node's record is read whole, the tabs stay
          for a milestone */}
      {tabs.length > 1 && (
      <nav aria-label="Record tabs" className="-mb-px flex gap-4">
        {tabs.map((t) => (
          <Link
            key={t}
            to="."
            search={(prev: Record<string, unknown>) => ({ ...prev, tab: t === 'overview' ? undefined : t })}
            replace
            aria-current={t === tab ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 border-b-2 text-xs font-medium',
              t === tab ? 'border-primary text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {TAB_LABEL[t]}
            {tabCounts?.[t] ? (
              <span className="rounded-chip bg-raised px-1.5 text-[11px] text-ink-faint">{tabCounts[t]}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      )}
    </div>
  );
}
