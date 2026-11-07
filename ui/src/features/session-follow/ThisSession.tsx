// The session this tab follows, as a destination at the rail's foot (change:session-detail): its pulse while it is
// live, marked when the page is its own. Nothing when the tab follows none.
import { Link, useMatch } from '@tanstack/react-router';
import { cn } from 'cn';
import { railItem, railItemOn } from '@/components/shell/Rail';
import { Pulse } from '@/components/presence/Presence';
import { useSessionView } from '@/data/queries';
import { SESSION } from '@/lib/tones';
import { useFollow } from '@/state/follow';

export function ThisSession() {
  const home = useFollow((s) => s.home);
  const match = useMatch({ from: '/session/$id', shouldThrow: false });
  const { data } = useSessionView(home);
  if (!home) return null;
  const state = data?.session?.state;
  const on = match?.params.id === home;
  return (
    <Link
      to="/session/$id"
      params={{ id: home }}
      search={{}}
      className={cn(railItem, on && railItemOn)}
      aria-current={on ? 'page' : undefined}
      title={`session ${home}`}
    >
      {state === 'live' ? (
        <Pulse className="mx-[3.5px]" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'mx-[3.5px] inline-block size-2 shrink-0 rounded-full',
            state === 'ended' ? SESSION.ended.bg : SESSION.stopped.bg,
          )}
        />
      )}
      This session
    </Link>
  );
}
