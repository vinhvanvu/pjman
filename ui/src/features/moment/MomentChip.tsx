// The chip in the top bar while the page reads as of a moment: what the cursor resolved to, and the way back to now.
// It is the only control over time until the bridge's transport exists.
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useAt, useMoment } from '@/state/moment';
import { momentWords } from './model';

export function MomentChip() {
  const at = useAt();
  const resolved = useMoment((s) => s.resolved);
  const navigate = useNavigate();
  if (!at) return null;
  return (
    <span
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-row border border-primary/50 bg-primary/10 pl-2.5 pr-1 text-xs whitespace-nowrap text-primary"
      title={resolved ? `event #${resolved.seq} · commit ${resolved.commit}` : undefined}
    >
      <span className="font-medium">{momentWords(at, resolved)}</span>
      <button
        type="button"
        aria-label="Back to now"
        onClick={() =>
          void navigate({
            to: '.',
            search: (prev: Record<string, unknown>) => ({ ...prev, at: undefined }),
          })
        }
        className="grid size-5 place-items-center rounded-full text-primary/80 hover:bg-primary/20 hover:text-primary"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
