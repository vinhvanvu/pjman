// Two panes side by side when there is room, one column when there is not. The split's layout is the caller's to
// remember; the component reports it.
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

export type SplitLayout = Record<string, number>;

export interface SplitPaneProps {
  wide: boolean;
  primary: ReactNode;
  secondary?: ReactNode;
  /** Default share of the primary pane, in percent. */
  primarySize?: number;
  id: string;
  layout?: SplitLayout;
  onLayoutChange?: (layout: SplitLayout) => void;
  className?: string;
}

export function SplitPane({
  wide,
  primary,
  secondary,
  primarySize = 55,
  id,
  layout,
  onLayoutChange,
  className,
}: SplitPaneProps) {
  if (!wide || !secondary) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-auto', className)}>
        <div className="min-h-0">{primary}</div>
        {secondary && <div className="min-h-0 border-t border-line">{secondary}</div>}
      </div>
    );
  }
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={id}
      defaultLayout={layout}
      onLayoutChange={onLayoutChange}
      className={cn('min-h-0 flex-1', className)}
    >
      <ResizablePanel
        id="primary"
        defaultSize={`${primarySize}`}
        minSize="30"
        className="flex min-h-0 flex-col overflow-auto"
      >
        {primary}
      </ResizablePanel>
      <ResizableHandle className="w-px bg-line hover:bg-line-strong data-[resize-handle-state=drag]:bg-primary" />
      <ResizablePanel
        id="secondary"
        defaultSize={`${100 - primarySize}`}
        minSize="25"
        className="flex min-h-0 flex-col overflow-auto"
      >
        {secondary}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
