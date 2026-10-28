// The chip in the top bar while the page reads as of a moment (decision read-at-a-moment/time-with-event-selection):
// what the cursor resolved to, the way back to now, and, while an event is selected, a release that keeps its time.
// It is the only control over time until the bridge's transport exists.
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useCursor, useResolved } from '@/state/moment';
import { momentWords } from './model';

export function MomentChip() {
  const cursor = useCursor();
  const resolved = useResolved();
  const navigate = useNavigate();
  if (!cursor.at && !cursor.event) return null;
  const set = (next: { at?: string; event?: number }) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, ...next }) });
  const words = momentWords(cursor, resolved);
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-row border border-primary/50 bg-primary/10 pl-2.5 pr-1 text-xs whitespace-nowrap text-primary"
      title={resolved ? `event #${resolved.seq} · ${resolved.at} · commit ${resolved.commit}` : undefined}
    >
      {cursor.event && resolved ? (
        <button
          type="button"
          title="Release the event, keep its time"
          onClick={() => set({ event: undefined, at: resolved.at })}
          className="font-medium hover:underline"
        >
          {words}
        </button>
      ) : (
        <span className="font-medium">{words}</span>
      )}
      <button
        type="button"
        aria-label="Back to now"
        onClick={() => set({ at: undefined, event: undefined })}
        className="grid size-5 place-items-center rounded-full text-primary/80 hover:bg-primary/20 hover:text-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
