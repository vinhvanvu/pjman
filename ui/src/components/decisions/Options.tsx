// A decision's options as a person reads them (change:decision-card): one line each, the recommended one marked once
// and its case drawn as points, like notes; the other options' cases stay folded; then the why. The gist above it says
// what is being decided and never restates the recommendation. Data in, nothing fetched; the same list wherever a
// decision is drawn (the strip, the dock, the record pane's Decisions tab).
import { cn } from 'cn';
import type { DecisionState, OptionState } from '@/data/contract';
import { Chip } from '@/components/chips/Chip';
import { TONE } from '@/lib/tones';

/** An option's case as its points: one per line, a leading bullet mark dropped (the tool's `pointsOf`). */
export function pointsOf(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, ''))
    .filter(Boolean);
}

function markOf(o: OptionState): { label: string; cls: string } | undefined {
  if (o.accepted) return { label: 'accepted', cls: TONE.done.text };
  if (o.rejected !== undefined) return { label: 'set aside', cls: 'text-ink-faint' };
  if (o.recommended) return { label: 'recommended', cls: TONE.waits.text };
  return undefined;
}

export function Options({ state: s, className }: { state: DecisionState; className?: string }) {
  if (!s.options.length) return null;
  const lead = s.options.find((o) => o.accepted) ?? s.options.find((o) => o.recommended);
  const why = s.accepted?.text ?? s.recommendation?.text;
  return (
    <div className={cn('flex flex-col gap-1.5 text-xs', className)}>
      <ol className="flex flex-col gap-1">
        {s.options.map((o) => {
          const mark = markOf(o);
          const open = o === lead;
          const points = open ? pointsOf(o.case) : [];
          return (
            <li key={o.id} className={cn('flex flex-col gap-1', !open && 'text-ink-faint')}>
              <span className="flex items-start gap-2">
                <span className={cn('min-w-0 flex-1 leading-relaxed', open && 'font-medium text-ink')}>{o.text}</span>
                {mark && <Chip className={cn('mt-px', mark.cls)}>{mark.label}</Chip>}
              </span>
              {points.length > 0 && (
                <ul className="flex list-disc flex-col gap-0.5 pl-4 leading-relaxed text-ink-muted marker:text-ink-faint">
                  {points.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {o.rejected && <span className="pl-4 text-ink-faint">{o.rejected}</span>}
            </li>
          );
        })}
      </ol>
      {why && (
        <p className="leading-relaxed text-ink-muted">
          <span className="label mr-1.5">{s.accepted ? 'Decided' : 'Why'}</span>
          {why}
        </p>
      )}
    </div>
  );
}
