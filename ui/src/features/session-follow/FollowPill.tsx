// The following pill: the way back to the session this tab follows, on every page. On the session's route with
// nothing else open it reads following; anywhere else, or with something selected, paused on the change, and one tap
// returns; once the session ends it says so. The close forgets the session. It names the change, never the uuid.
import { useMatch, useNavigate, useSearch } from '@tanstack/react-router';
import { cn } from 'cn';
import { Play, X } from 'lucide-react';
import { useSessionView } from '@/data/queries';
import { Pulse } from '@/components/presence/Presence';
import type { PageSearch } from '@/routes/-search';
import { useFollow } from '@/state/follow';
import { away, followName, followState } from './model';
import { SESSION, TONE } from '@/lib/tones';

const WORDS = { following: 'following', paused: 'paused on', ended: 'ended' } as const;

export function FollowPill({ className }: { className?: string }) {
  const home = useFollow((s) => s.home);
  const forget = useFollow((s) => s.forget);
  const match = useMatch({ from: '/session/$id', shouldThrow: false });
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const { data } = useSessionView(home);
  if (!home) return null;
  const session = data?.session;
  const standing = {
    onSessionRoute: match?.params.id === home,
    looking: !!search.sel || (!!search.tab && search.tab !== 'overview'),
  };
  const state = followState(session, standing);
  const name = followName(session, home);
  const back = () => void navigate({ to: '/session/$id', params: { id: home }, search: {} });
  return (
    <div
      className={cn(
        'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface pr-0.5 pl-2.5 text-xs',
        className,
      )}
      title={`session ${home}`}
    >
      {state === 'following' && session?.state === 'live' ? (
        <Pulse />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-2 shrink-0 rounded-full',
            state === 'ended' ? SESSION.ended.bg : state === 'paused' ? TONE.waits.bg : SESSION.working.bg,
          )}
        />
      )}
      <span className="shrink-0 text-ink-muted">{WORDS[state]}</span>
      <span className="min-w-0 truncate font-medium text-ink">{name}</span>
      {away(standing) && (
        <button
          type="button"
          onClick={back}
          aria-label="Back to what the session is on"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
        >
          <Play className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={forget}
        aria-label="Stop following this session"
        className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
