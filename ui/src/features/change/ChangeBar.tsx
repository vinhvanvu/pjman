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
}: {
  /** The sessions that touched the change, each with its first event on it. */
  sessions: readonly { key: string; first?: string }[];
  /** The sessions on the change now, from its scope. */
  live: Scope['sessions'];
  /** The change's last event, from its rail. */
  last?: string;
  waits: number;
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
    </div>
  );
}
