// Aspects where a record is shown (aspect:aspects; change:aspects-dashboard). An aspect shows as a chip with its name, a
// forked place marked; opening one reads it in place, beside the record, and closing it is the way back. The text is
// always the store's: the base, then each fork above the place, then its own, each labelled with where it comes from.
// Text is drawn as written for now; the text aspect gives it one renderer (change:text-aspect).
import { cn } from 'cn';
import { Diamond } from 'lucide-react';
import { useState } from 'react';
import type { AspectAt, AspectWhole, ChangeAspects, Lens, ScopeAspect } from '@/data/contract';
import { short } from '@/lib/keys';
import { Chip, Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';

/** What an aspect is called: its name, else its slug. */
const nameOfKey = (key: string): string => key.split('/').pop()!;

/** One piece of the store's text, as written. */
export function AspectText({ text, className }: { text: string; className?: string }) {
  return <div className={cn('text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted', className)}>{text}</div>;
}

/** The aspect read at one place: each layer under a line naming where it comes from. */
export function AspectReading({ at, lens }: { at: AspectAt; lens: Lens }) {
  return (
    <div className="flex flex-col gap-3">
      {at.layers.length === 0 && <p className="text-xs text-ink-faint">The aspect has no base written yet.</p>}
      {at.layers.map((l) => (
        <div key={l.from} className="flex flex-col gap-1.5">
          <span className="text-meta text-ink-faint">
            {l.at ? (
              <>
                the fork at{' '}
                <NodeLink to={l.at} lens={lens} className="hover:text-primary">
                  {short(l.at)}
                </NodeLink>
              </>
            ) : (
              'the base'
            )}
          </span>
          <AspectText text={l.text} />
        </div>
      ))}
    </div>
  );
}

/** A chip per aspect; the one opened reads below the row. `forked` marks a chip whose place forks. */
export function AspectChips({
  items,
  lens,
  initial,
}: {
  items: { key: string; label: string; forked: boolean; body: React.ReactNode }[];
  lens: Lens;
  /** The aspect open at first: the one the map is narrowed to, when it is among them. */
  initial?: string;
}) {
  const [open, setOpen] = useState<string | undefined>(initial);
  const shown = items.find((i) => i.key === open);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            aria-expanded={open === i.key}
            onClick={() => setOpen(open === i.key ? undefined : i.key)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-row border px-2 text-xs',
              open === i.key
                ? 'border-primary/50 bg-selection text-ink'
                : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
            )}
          >
            <Diamond className="size-3" aria-hidden="true" />
            {i.label}
            {i.forked && <span className="text-ink-faint">· forked</span>}
          </button>
        ))}
      </div>
      {shown && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
          {shown.body}
          <div className="flex items-center gap-3 text-meta text-ink-faint">
            <NodeLink to={shown.key} lens={lens} className="hover:text-primary">
              Where it applies
            </NodeLink>
            <button type="button" onClick={() => setOpen(undefined)} className="ml-auto hover:text-ink">
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The aspects that apply at a feature, each read there. */
export function FeatureAspects({ here, lens, selected }: { here: AspectAt[]; lens: Lens; selected?: string }) {
  if (!here.length) return null;
  return (
    <AspectChips
      lens={lens}
      initial={here.some((x) => x.aspect === selected) ? selected : undefined}
      items={here.map((x) => ({
        key: x.aspect,
        label: nameOfKey(x.aspect),
        forked: x.layers.some((l) => l.from === x.place),
        body: <AspectReading at={x} lens={lens} />,
      }))}
    />
  );
}

/** Every place of an aspect, each marked as forked or as the base as it is, the fork beneath it. A place opens its
 *  feature, where the aspect reads there. */
export function PlaceList({ whole, lens }: { whole: AspectWhole; lens: Lens }) {
  if (!whole.places.length) return <p className="text-xs text-ink-faint">It applies nowhere yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
      {whole.places.map((p) => (
        <li key={p.place} className="flex flex-col gap-1.5 px-4 py-3">
          <div className="flex items-center gap-2">
            <NodeLink to={p.feature} lens={lens} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
              {short(p.feature)}
            </NodeLink>
            <Chip tone="quiet">{p.fork ? 'forked' : 'base'}</Chip>
          </div>
          {p.fork && <AspectText text={p.fork} />}
        </li>
      ))}
    </ol>
  );
}

/** What a change works under: the aspects it names first, each read whole (the base and every place), then the
 *  aspects over the features it names, each read there; the places beneath a broad feature one line each. */
export function ChangeAspectsView({ aspects, lens }: { aspects: ChangeAspects; lens: Lens }) {
  return (
    <div className="flex flex-col gap-3">
      <AspectChips
        lens={lens}
        items={[
          ...aspects.named.map((n) => ({
            key: n.aspect,
            label: nameOfKey(n.aspect),
            forked: false,
            body: <AspectWholeBody whole={n} lens={lens} />,
          })),
          ...aspects.at.map((x) => ({
            key: x.aspect,
            label: nameOfKey(x.aspect),
            forked: x.layers.some((l) => l.from === x.place),
            body: <AspectReading at={x} lens={lens} />,
          })),
        ]}
      />
      {aspects.beneath.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-ink-muted">
          {aspects.beneath.map((b) => (
            <li key={b.place} className="flex items-center gap-2">
              <NodeLink to={b.place} lens={lens} className="hover:text-primary">
                {nameOfKey(aspectKeyOf(b.place))}
              </NodeLink>
              <span className="text-ink-faint">at {short(b.feature)}</span>
              {b.forked && <span className="text-ink-faint">· forked</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The aspect a place sits under, from the place's key. */
const aspectKeyOf = (place: string): string => place.slice(0, place.lastIndexOf('/'));

/** An aspect read whole: the base, then every place it is linked to. */
export function AspectWholeBody({ whole, lens }: { whole: AspectWhole; lens: Lens }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-meta text-ink-faint">the base</span>
      {whole.base ? <AspectText text={whole.base} /> : <p className="text-xs text-ink-faint">No base written yet.</p>}
      <span className="text-meta text-ink-faint">
        {whole.places.length} {whole.places.length === 1 ? 'place' : 'places'}
      </span>
      <PlaceList whole={whole} lens={lens} />
    </div>
  );
}

/** The aspect read whole: what the record pane shows while the map is narrowed to it and nothing is selected. */
export function AspectPane({ aspect, lens }: { aspect: ScopeAspect; lens: Lens }) {
  const count = aspect.places.length;
  return (
    <section aria-label={aspect.title} className="flex flex-col gap-6 p-5 md:px-6">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Label>aspect</Label>
          <span className="font-mono text-meta text-ink-faint">{short(aspect.aspect)}</span>
        </div>
        <h1 className="text-heading font-semibold tracking-tight">{aspect.name ?? nameOfKey(aspect.aspect)}</h1>
        {aspect.title && <p className="text-[13.5px] text-ink-muted">{aspect.title}</p>}
      </header>
      <div className="flex flex-col gap-2.5">
        <Label>Base</Label>
        {aspect.base ? (
          <AspectText text={aspect.base} />
        ) : (
          <p className="text-xs text-ink-faint">No base written yet.</p>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <Label>Places</Label>
          <span className="text-meta text-ink-faint">
            {count} {count === 1 ? 'place' : 'places'} · each covers what is beneath it
          </span>
        </div>
        <PlaceList whole={aspect} lens={lens} />
      </div>
    </section>
  );
}
