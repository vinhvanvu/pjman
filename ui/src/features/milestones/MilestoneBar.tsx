// The milestone bar (decision milestone-detail/milestone-body): the change bar read over everything beneath a
// milestone, its first line wherever the milestone is the subject. The ring of children done leads; then who is on it
// beneath now with the live pulse, what is blocked beneath, when it was last touched, the target; what waits last, in
// the waits colour when something does. A separator travels with the word after it.
import { cn } from 'cn';
import { Pulse } from '@/components/presence/Presence';
import { Ring } from '@/components/stats/Ring';
import { TONE } from '@/lib/tones';
import { milestoneBar, type MilestoneFigures } from './model';

export function MilestoneBar({ figures, className }: { figures: MilestoneFigures; className?: string }) {
  const bar = milestoneBar(figures);
  const p = figures.progress;
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted', className)}>
      <span className="inline-flex items-center gap-2">
        <Ring done={p.done} total={p.total} size={20} stroke={3} />
        <span>
          <b className="font-semibold text-ink">
            {p.done} of {p.total}
          </b>{' '}
          children done
        </span>
      </span>
      {bar.parts.map((part, i) => (
        <span key={i} className={cn(part.endsWith('blocked beneath') && TONE.alarm.text)}>
          <span className="text-ink-faint">· </span>
          {bar.live && i === 0 && <Pulse className="mr-1.5 inline-block size-2 align-[-1px]" />}
          {part}
        </span>
      ))}
      <span className={cn(bar.alarm && cn('font-semibold', TONE.waits.text))}>
        <span className="font-normal text-ink-faint">· </span>
        {bar.waits}
      </span>
    </div>
  );
}
