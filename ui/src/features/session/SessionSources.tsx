// The sources a session with no change read on its own (decision unbound-sessions/sources): the PR under review, the
// branch, the tickets, as the same chips a change's sources are drawn with (components/links/SourceChip), so each opens
// the thing itself. Drawn in the dock and on the wide session page while the session is on no change.
import type { Lens, SessionFacts } from '@/data/contract';
import { Label } from '@/components/chips/Chip';
import { SourceChip } from '@/components/links/SourceChip';

export function SessionSources({ sources, lens }: { sources: SessionFacts['sources']; lens: Lens }) {
  if (sources.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <Label>Sources</Label>
      <ul className="flex flex-wrap items-center gap-1.5">
        {sources.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-1.5">
            <SourceChip source={s} lens={lens} title={s.title} />
            {s.title && <span className="truncate text-meta text-ink-muted">{s.title}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
