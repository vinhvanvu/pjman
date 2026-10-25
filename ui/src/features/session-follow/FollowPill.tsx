// The following pill: the board is showing what a session is on. Any manual navigation pauses it; one click resumes.
import { cn } from 'cn';
import { Pause, Pin, PinOff, Play } from 'lucide-react';
import { Presence } from '@/components/presence/Presence';
import { useFollow } from '@/state/follow';

export function FollowPill({ session, on, className }: { session: string; on?: string; className?: string }) {
  const { pinned, paused, pin, unpin, pause, resume } = useFollow();
  const isPinned = pinned === session;
  return (
    <div
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full border border-line-strong bg-surface pr-1 pl-2.5 text-xs',
        className,
      )}
    >
      <Presence>
        <span className="hidden sm:inline">{paused ? 'paused on' : 'following'}</span>
        <span className="font-mono text-ink">{session.slice(0, 8)}</span>
      </Presence>
      {on && <span className="hidden text-ink-faint md:inline">· {on}</span>}
      <button
        type="button"
        onClick={paused ? resume : pause}
        aria-label={paused ? 'Resume following' : 'Pause following'}
        className="grid size-5 place-items-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
      >
        {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
      </button>
      <button
        type="button"
        onClick={() => (isPinned ? unpin() : pin(session))}
        aria-label={isPinned ? 'Unpin this session' : 'Pin this session'}
        aria-pressed={isPinned}
        className={cn(
          'grid size-5 place-items-center rounded-full hover:bg-raised',
          isPinned ? 'text-primary' : 'text-ink-muted hover:text-ink',
        )}
      >
        {isPinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
      </button>
    </div>
  );
}
