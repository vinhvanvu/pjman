// The change bar (decision change-detail/mirror-the-session-page): the session bar read from the change's axis, the
// first line of the change wherever the change is the subject. Who is on it now, with the live pulse; how many
// sessions over how long; when it was last touched; what waits, in the waits colour when something does. A separator
// travels with the word after it, so a wrapped line never ends in a dot.
import { cn } from 'cn';
import type { Scope } from '@/data/contract';
import { Pulse } from '@/components/presence/Presence';
import { TONE } from '@/lib/tones';
import { changeBar } from './model';

export function ChangeBar({
  sessions,
  live,
  last,
  waits,
  launch,
}: {
  /** The sessions that touched the change, each with its first event on it. */
  sessions: readonly { key: string; first?: string }[];
  /** The sessions on the change now, from its scope. */
  live: Scope['sessions'];
  /** The change's last event, from its rail. */
  last?: string;
  waits: number;
  /** A session launched for the change on the host the server's machine runs (change:rex-adapter), when one is. */
  launch?: { host: string; run: () => void; busy: boolean };
}) {
  const bar = changeBar({ sessions, live, last, waits });
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted">
      {bar.live && <Pulse />}
      {bar.parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-ink-faint">· </span>}
          {p}
        </span>
      ))}
      <span className={cn(bar.alarm && cn('font-semibold', TONE.waits.text))}>
        <span className="font-normal text-ink-faint">· </span>
        {bar.waits}
      </span>
      {launch && (
        <button
          type="button"
          onClick={launch.run}
          disabled={launch.busy}
          className="ml-auto h-[22px] shrink-0 rounded-row border border-line px-2 text-xs font-semibold text-ink hover:bg-raised disabled:opacity-60"
          aria-label={`Start a session for this change in ${launch.host}`}
        >
          New session in {launch.host}
        </button>
      )}
    </div>
  );
}
