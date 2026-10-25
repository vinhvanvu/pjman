// The selection badge: a floating bar at the bottom of the structure pane saying what is selected, with the one way
// to clear it that is the same in every lens. The pane's close does the same; so does clicking the selected row again.
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function SelectionBadge({
  label,
  kind,
  onClear,
  children,
}: {
  label: string;
  kind: string;
  onClear: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="pointer-events-auto flex h-9 items-center gap-2 rounded-full border border-line-strong bg-popover pr-1.5 pl-3.5 text-xs shadow-lg">
        <span className="label text-primary">selected {kind}</span>
        <span className="max-w-[260px] truncate font-medium text-ink">{label}</span>
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection"
          className="grid size-6 place-items-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
