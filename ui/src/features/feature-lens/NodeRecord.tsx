// One node record at every level of the product tree (decision feature-detail/one-node-record): the panel reads a
// product, a feature and a capability with one template, only the labels and what is beneath changing. In order: the
// header with the shared figures; what is held, lifted here with Release (decision hold-lights-the-map); the aspects
// that apply; what is beneath as a compact list; the work at or beneath the node as cards grouped by motion exactly
// as the bridge groups it, every group whole with no cap; the timeline over everything beneath the node, narrowed to
// the held changes while any are held; signals. Nothing here repeats the bridge: what is moving across the product
// is the bridge's, the record is the where.
import { cn } from 'cn';
import { useMemo, type ReactNode } from 'react';
import type { ChangeRow, Lens, Scope, ScopeNode } from '@/data/contract';
import { plural, sinceDays } from '@/lib/format';
import { short } from '@/lib/keys';
import { byMotion, decisionsByChange, strayDecisions } from '@/lib/work';
import { Label, StateDot } from '@/components/chips/Chip';
import { factsOfRow } from '@/components/change/model';
import { MotionCard } from '@/components/change/MotionCard';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { fromWaiting } from '@/components/decisions/model';
import { useDecideAction } from '@/data/queries';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { NodeHeader } from '@/components/record/NodeHeader';
import { FeatureAspects } from '@/features/aspects';
import { ActivityRail } from '@/features/rail/ActivityRail';
import { allWork, bodyOf, featuresBelow, healthWord, liveBeneath, namesIn } from './model';
import { TONE } from '@/lib/tones';

/** A level label in the plural: capability, capabilities. */
const many = (label: string) => (label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`);

export interface NodeRecordProps {
  scope: Scope;
  lens: Lens;
  /** The aspect the map is narrowed to, when one is. */
  aspect?: string;
  /** The changes held, in the order held: lifted under the figures, the timeline narrowed to them. */
  held: readonly string[];
  onHold: (change: string) => void;
  onRelease: () => void;
  /** The change under the pointer, on a card here or a row on the map. */
  hover?: string;
  onHover: (change: string | undefined) => void;
  now: number;
}

export function NodeRecord({ scope, lens, aspect, held, onHold, onRelease, hover, onHover, now }: NodeRecordProps) {
  const node = scope.node;
  const body = bodyOf(scope);
  const title = node ? (node.name ?? node.title ?? short(node.key)) : 'Everything';
  const sentence = node?.name && node.title && node.title !== node.name ? node.title : node?.summary;
  const open = scope.changes.filter((r) => r.status !== 'done' && r.status !== 'dropped');
  const inFlight = open.filter((r) => r.status === 'active' || r.status === 'review' || r.status === 'blocked');
  const names = useMemo(
    () => namesIn(scope.tree, scope.changes, scope.node ? [...scope.crumbs, scope.node] : scope.crumbs),
    [scope.tree, scope.changes, scope.crumbs, scope.node],
  );
  const alive = useMemo(() => liveBeneath(scope.tree), [scope.tree]);
  const work = useMemo(() => allWork(scope), [scope]);
  const below = featuresBelow(scope.tree);
  const beneathLabel = body === 'product' ? 'Features' : many(below[0]?.level ?? 'capability');
  // the timeline is drawn at the node; at the store root, at the first product
  const at = node?.key ?? scope.products[0]?.key;

  return (
    <section aria-label={title} className="flex flex-col gap-6 p-5 md:px-6">
      <NodeHeader
        level={node ? (node.level ?? node.type) : 'store'}
        state={node?.type === 'feature' ? (node.derived ?? node.status) : undefined}
        title={title}
        sentence={sentence}
        owners={scope.owners.owners.map((k) => short(k))}
        ownersFrom={scope.owners.from && scope.owners.from !== node?.key ? short(scope.owners.from) : undefined}
        word={healthWord(scope.health)}
        health={scope.health}
        open={open.length}
        inFlight={inFlight.length}
        waiting={scope.waitingOn.length}
        live={scope.sessions.length}
        bugs={{ count: scope.bugs.length, worst: scope.bugs[0]?.severity, node: node?.key }}
      />

      {held.length > 0 && (
        <Held scope={scope} held={held} work={work} names={names} onHold={onHold} onRelease={onRelease} hover={hover} onHover={onHover} now={now} />
      )}

      {scope.aspectsHere.length > 0 && (
        <Section label="Aspects" aside="what applies here, from here or above">
          <FeatureAspects here={scope.aspectsHere} lens={lens} selected={aspect} />
        </Section>
      )}

      {(below.length > 0 || body !== 'capability') && (
        <Section label={beneathLabel} aside={below.length ? String(below.length) : undefined}>
          {below.length === 0 ? (
            <EmptyState
              title={`No ${beneathLabel.toLowerCase()} yet.`}
              hint={
                body === 'product'
                  ? 'A feature is created when someone names a capability.'
                  : 'A capability is created beneath it when someone names one.'
              }
            />
          ) : (
            <FeatureList features={below} lens={lens} alive={alive} />
          )}
        </Section>
      )}

      <Work scope={scope} lens={lens} rows={work} names={names} held={held} onHold={onHold} hover={hover} onHover={onHover} now={now} />

      {at && (
        <ActivityRail
          scope={at}
          lens={lens}
          limit={20}
          only={held.length ? held : undefined}
          note={
            <span className="text-meta text-ink-faint">
              {held.length
                ? `only ${held.length === 1 ? names.get(held[0]!) ?? short(held[0]!) : plural(held.length, 'held change')}`
                : node
                  ? `everything beneath ${title}`
                  : 'everything'}
            </span>
          }
        />
      )}

      <p className="text-meta text-ink-faint">
        <span className="label mr-1.5">Signals</span>none observed yet
      </p>
    </section>
  );
}

// --- the pieces -----------------------------------------------------------------------------------------------

function Section({ label, aside, children }: { label: string; aside?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Label>{label}</Label>
        {aside && <span className="text-meta text-ink-faint">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** What is held, lifted under the figures: the cards, and the words that name them with Release. */
function Held({
  scope,
  held,
  work,
  names,
  onHold,
  onRelease,
  hover,
  onHover,
  now,
}: {
  scope: Scope;
  held: readonly string[];
  work: ChangeRow[];
  names: ReadonlyMap<string, string>;
  onHold: (change: string) => void;
  onRelease: () => void;
  hover?: string;
  onHover: (change: string | undefined) => void;
  now: number;
}) {
  const rows = held.map((k) => work.find((r) => r.key === k) ?? scope.changes.find((r) => r.key === k));
  return (
    <section aria-label="Held changes" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <Label className="text-primary">Held</Label>
        <span className="text-ink-muted">
          lit on the map; the timeline shows only{' '}
          {held.map((k, i) => (
            <span key={k}>
              {i > 0 && (i === held.length - 1 ? ' and ' : ', ')}
              <span className="font-medium text-ink">{names.get(k) ?? short(k)}</span>
            </span>
          ))}
        </span>
        <button
          type="button"
          onClick={onRelease}
          className="rounded-chip border border-line px-2 py-0.5 text-meta text-ink-muted hover:bg-raised hover:text-ink"
        >
          {held.length > 1 ? 'Release all' : 'Release'}
        </button>
      </div>
      <ol aria-label="Held cards" className="flex flex-col gap-2.5">
        {held.map((k, i) => {
          const r = rows[i];
          return (
            <li key={k} className="min-w-0">
              {r ? (
                <MotionCard
                  change={factsOfRow(r, scope.sessions, names)}
                  held
                  hot={hover === k}
                  onHover={onHover}
                  onHold={() => onHold(k)}
                  now={now}
                />
              ) : (
                <div className="flex items-center gap-2 rounded-card border border-line px-3.5 py-2.5 text-xs text-ink-muted">
                  <span className="min-w-0 flex-1 truncate">{short(k)} is not beneath this node</span>
                  <button type="button" onClick={() => onHold(k)} className="text-meta hover:text-ink">
                    release
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Features as compact rows: state, name, a breathing dot when a session works beneath, what waits, what is open,
 *  when it last moved. */
function FeatureList({ features, lens, alive }: { features: ScopeNode[]; lens: Lens; alive: ReadonlySet<string> }) {
  return (
    <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
      {features.map((f) => {
        const h = f.health;
        const word = h ? healthWord(h) : 'not started';
        const waiting = h?.waiting ?? 0;
        return (
          <li key={f.key}>
            <NodeLink to={f.key} lens={lens} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-raised">
              <StateDot state={f.derived ?? f.status} />
              <span className="min-w-0 flex-1 truncate font-medium">{f.name ?? f.title ?? short(f.key)}</span>
              {alive.has(f.key) && <Pulse className="size-[6px]" />}
              {waiting > 0 && <span className={cn('text-meta', TONE.waits.text)}>{waiting} wait</span>}
              <span className="text-meta text-ink-faint">{f.open ? `${f.open} open` : '—'}</span>
              <span
                className={
                  word === 'stale'
                    ? cn('w-24 text-right text-meta', TONE.waits.text)
                    : 'w-24 text-right text-meta text-ink-faint'
                }
              >
                {word === 'not started'
                  ? 'not started'
                  : word === 'stale'
                    ? `stale · ${sinceDays(h?.staleDays)}`
                    : sinceDays(h?.staleDays)}
              </span>
            </NodeLink>
          </li>
        );
      })}
    </ol>
  );
}

/** The work at or beneath the node, grouped by motion as the bridge groups it, every group whole; each change the
 *  card, the decisions waiting on it inside the card. A decision whose change is not in the list is shown on its own,
 *  so nothing waiting is hidden. The held cards stand above and are not repeated here. */
function Work({
  scope,
  lens,
  rows,
  names,
  held,
  onHold,
  hover,
  onHover,
  now,
}: {
  scope: Scope;
  lens: Lens;
  rows: ChangeRow[];
  names: ReadonlyMap<string, string>;
  held: readonly string[];
  onHold: (change: string) => void;
  hover?: string;
  onHover: (change: string | undefined) => void;
  now: number;
}) {
  const heldSet = new Set(held);
  const groups = byMotion(rows.filter((r) => !heldSet.has(r.key)));
  const decisions = decisionsByChange(scope.waitingOn);
  const stray = strayDecisions(scope.waitingOn, rows);
  const decide = useDecideAction('decide');
  const total = rows.filter((r) => r.status !== 'done' && r.status !== 'dropped').length;
  if (groups.length === 0 && stray.length === 0 && held.length === 0) {
    return (
      <Section label="Work">
        <EmptyState
          title={scope.node ? 'Nothing open at this node or beneath it.' : 'Nothing open.'}
          hint="A change names this node with --features when it touches it."
        />
      </Section>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Label>Work</Label>
        <span className="text-meta text-ink-faint">
          {plural(total, 'change')}
          {scope.node ? ' at this node or beneath it' : ''} · grouped as the bridge groups them
        </span>
      </div>
      {stray.length > 0 && (
        <Section label="Waits on you" aside={String(stray.length)}>
          <DecisionGroup
            decisions={stray.map(fromWaiting)}
            lens={lens}
            where="session"
            wide
            onDecide={decide}
            showChange
          />
        </Section>
      )}
      {groups.map((g) => (
        <Section
          key={g.motion}
          label={g.label}
          aside={`${plural(g.rows.length, 'change')}${g.rows.length > 1 ? ' · by last touch' : ''}`}
        >
          {g.rows.map((r) => {
            const waits = decisions.get(r.key);
            return (
              <MotionCard
                key={r.key}
                change={factsOfRow(r, scope.sessions, names)}
                hot={hover === r.key}
                onHover={onHover}
                onHold={() => onHold(r.key)}
                now={now}
              >
                {waits && waits.length > 0 && (
                  <DecisionGroup decisions={waits.map(fromWaiting)} lens={lens} where="session" wide onDecide={decide} />
                )}
              </MotionCard>
            );
          })}
        </Section>
      ))}
    </div>
  );
}
