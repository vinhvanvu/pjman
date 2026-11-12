// Copying a reference for pasting into a session (change:copy-decision-keys): one control wherever the dashboard
// names a decision, the key shown short and copied whole. It sits inside rows and cards that are links themselves,
// so a click copies and goes nowhere.
import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { short } from '@/lib/keys';

function useCopy(text: string) {
  const [done, setDone] = useState(false);
  const copy = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    });
  };
  return { done, copy };
}

/** A key, short, with a copy of the whole key in one click; `bare` shows the icon alone, for rows with no room. */
export function CopyKey({ refKey, bare, className }: { refKey: string; bare?: boolean; className?: string }) {
  const { done, copy } = useCopy(refKey);
  const Icon = done ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-meta text-ink-faint hover:text-ink', className)}
      title={done ? 'copied' : `Copy ${refKey}`}
      aria-label={`Copy ${refKey}`}
    >
      {!bare && <span className="truncate font-mono">{done ? 'copied' : short(refKey)}</span>}
      <Icon className="size-3 shrink-0" aria-hidden="true" />
    </button>
  );
}
