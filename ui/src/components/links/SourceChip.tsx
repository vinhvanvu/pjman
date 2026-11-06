// A source as a chip (change:source-chips-open-source): a person clicking a ticket or a PR wants the ticket or the PR,
// so the chip opens the source itself, in a new tab, when it has a place outside the store; the URL is the tool's
// (the record's own, or one the reference grammar builds from the key), never built here. What the store knows about
// the source, the getter, stays one click away beside it. A source with no URL (a file, a branch) goes to the getter.
import { ArrowUpRight, Waypoints } from 'lucide-react';
import type { Lens } from '@/data/contract';
import { Chip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { short } from '@/lib/keys';

export function SourceChip({
  source,
  lens,
  title,
}: {
  source: { key: string; url?: string };
  lens: Lens;
  title?: string;
}) {
  const label = short(source.key);
  if (!source.url) {
    return (
      <NodeLink to={source.key} lens={lens}>
        <Chip tone="quiet" mono title={title}>
          {label}
        </Chip>
      </NodeLink>
    );
  }
  return (
    <Chip tone="quiet" mono className="gap-1 pr-1">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 hover:text-ink"
        title={title ? `${title} · opens ${source.url}` : `Opens ${source.url}`}
      >
        {label}
        <ArrowUpRight className="size-3" aria-hidden="true" />
      </a>
      <NodeLink
        to={source.key}
        lens={lens}
        className="inline-flex items-center text-ink-faint hover:text-ink"
        title={`What the store knows about ${source.key}`}
        aria-label={`What the store knows about ${source.key}`}
      >
        <Waypoints className="size-3" aria-hidden="true" />
      </NodeLink>
    </Chip>
  );
}
