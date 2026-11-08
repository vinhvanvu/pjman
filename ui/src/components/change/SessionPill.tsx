// A session as a pill: its state's dot, who and what it is doing; it opens the session's page. The same pill on the
// bridge's cards, the map's rows and the panel's cards, so a session is recognised everywhere by one shape.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { restOf } from '@/lib/keys';
import { sessionDot, TONE } from '@/lib/tones';
import { pillWords, type PillSession } from './model';

export function SessionPill({ session: s, now, className }: { session: PillSession; now: number; className?: string }) {
  return (
    <Link
      to="/session/$id"
      params={{ id: restOf(s.key) }}
      search={{}}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex h-5 max-w-full items-center gap-1.5 rounded-chip border px-1.5 text-meta whitespace-nowrap hover:bg-raised',
        s.state === 'working' ? cn(TONE.live.line, 'text-ink') : 'border-line text-ink-muted',
        className,
      )}
      aria-label={`Open the session: ${pillWords(s, now)}`}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', sessionDot(s.state))} />
      <span className="truncate">{pillWords(s, now)}</span>
    </Link>
  );
}
