// The overview of the selected node of the product map. One header at every node; beneath it a body chosen by the
// node's level in the template, so siblings always share one experience: the product is the portfolio, a feature is
// its capabilities and the work beneath, a capability is the work itself (with whatever nests under it listed first).
// Work is grouped by intent, what waits on a person first.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ChangeRow, Lens, Scope, ScopeNode, WaitingDecision } from '@/data/contract';
import { ago, pct, plural, sinceDays, truncate } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, Label, StateDot, StatusChip } from '@/components/chips/Chip';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { NodeHeader } from '@/components/record/NodeHeader';
import {
  allWork,
  bodyOf,
  byIntent,
  byMotion,
  featuresBelow,
  featuresByState,
  goals,
  healthWord,
  unassigned,
} from './model';

const STATES = ['live', 'building', 'planned', 'retired'] as const;
/** A level label in the plural: capability, capabilities. */
const many = (label: string) => (label.endsWith('y') ? `${label.slice(0, -1)}ies` : `${label}s`);
/** How many changes a capped intent group shows before pointing at the lanes. */
const CAP = 4;
const TOP = 8;

export function Overview({ scope, lens }: { scope: Scope; lens: Lens }) {
  const node = scope.node;
  const body = bodyOf(scope);
  const title = node ? (node.name ?? node.title ?? short(node.key)) : 'Everything';
  const sentence = node?.name && node.title && node.title !== node.name ? node.title : node?.summary;
  const open = scope.changes.filter((r) => r.status !== 'done' && r.status !== 'dropped');
  const inFlight = open.filter((r) => r.status === 'active' || r.status === 'review' || r.status === 'blocked');

  return (
    <section aria-label={title} className="flex flex-col gap-6 p-5 md:px-6">
      <NodeHeader
        level={node ? (node.level ?? node.type) : 'store'}
        state={node?.type === 'feature' ? (node.derived ?? node.status) : undefined}
        title={title}
        sentence={sentence}
        owners={scope.owners.owners.map(short)}
        ownersFrom={scope.owners.from && scope.owners.from !== node?.key ? short(scope.owners.from) : undefined}
        word={healthWord(scope.health)}
        health={scope.health}
        open={open.length}
        inFlight={inFlight.length}
        waiting={scope.waitingOn.length}
      />
      {body === 'product' && <ProductBody scope={scope} lens={lens} />}
      {body === 'feature' && <FeatureBody scope={scope} lens={lens} />}
      {body === 'capability' && <CapabilityBody scope={scope} lens={lens} />}
    </section>
  );
}

// --- product: the portfolio ------------------------------------------------------------------------------------

function ProductBody({ scope, lens }: { scope: Scope; lens: Lens }) {
  const states = featuresByState(scope.tree);
  const total = Object.values(states).reduce((n, c) => n + c, 0);
  const top = byMotion(featuresBelow(scope.tree));
  const g = goals(scope.changes);
  const left = unassigned(scope.tree);
  return (
    <>
      <Section label="Features" aside={plural(total, 'feature')}>
        {total === 0 ? (
          <EmptyState title="No features yet." hint="A feature is created when someone names a capability." />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {STATES.filter((s) => states[s]).map((s) => (
              <Link
                key={s}
                to="."
                search={(prev: Record<string, unknown>) => ({ ...prev, state: s })}
                replace
                className="inline-flex h-7 items-center gap-1.5 rounded-row border border-line-strong px-2.5 text-xs text-ink-muted hover:bg-raised hover:text-ink"
              >
                <StateDot state={s} />
                <span className="font-medium text-ink">{states[s]}</span> {s}
              </Link>
            ))}
          </div>
        )}
      </Section>

      {g.length > 0 && (
        <Section label="Goals" aside="nearest to done first">
          <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {g.slice(0, 5).map((m) => {
              const p = m.progress ?? { done: 0, total: 0 };
              return (
                <li key={m.key}>
                  <NodeLink to={m.key} lens={lens} className="flex flex-col gap-2 px-4 py-3 hover:bg-raised">
                    <div className="flex items-center gap-2">
                      {m.live && <Pulse className="size-[7px]" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{m.title ?? short(m.key)}</span>
                      {m.waiting > 0 && <Chip tone="quiet">○ {m.waiting} waiting</Chip>}
                      <span className="w-14 text-right text-meta text-ink-faint">
                        {p.done} / {p.total}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-raised">
                      <div
                        className="h-full rounded-full bg-status-done"
                        style={{ width: `${pct(p.done, p.total)}%` }}
                      />
                    </div>
                  </NodeLink>
                </li>
              );
            })}
          </ol>
          {g.length > 5 && (
            <Link
              to="/$lens/$"
              params={{ lens: 'milestone', _splat: scope.node?.key ?? '' }}
              className="text-xs text-ink-muted hover:text-ink"
            >
              and {g.length - 5} more in the milestone lens
            </Link>
          )}
        </Section>
      )}

      {top.length > 0 && (
        <Section label="Where it is moving" aside="most recent first">
          <FeatureList features={top.slice(0, TOP)} lens={lens} />
          {top.length > TOP && <p className="text-xs text-ink-faint">and {top.length - TOP} more in the map</p>}
        </Section>
      )}

      <WaitingList items={scope.waitingOn} lens={lens} />
      <LiveList scope={scope} lens={lens} />

      {left && (
        <p className="text-xs text-ink-faint">
          {plural(left.open, 'open change')} {left.open === 1 ? 'names' : 'name'} no feature:{' '}
          {left.children.map((c) => short(c.key)).join(' · ')}
        </p>
      )}
    </>
  );
}

// --- feature: its capabilities, then the work beneath ----------------------------------------------------------

function FeatureBody({ scope, lens }: { scope: Scope; lens: Lens }) {
  const caps = featuresBelow(scope.tree);
  const label = many(caps[0]?.level ?? 'capability');
  const work = allWork(scope);
  return (
    <>
      <Section label={label} aside={caps.length ? String(caps.length) : undefined}>
        {caps.length === 0 ? (
          <EmptyState
            title={`No ${label} yet.`}
            hint="The changes at this feature are below. A capability is created beneath it when someone names one."
          />
        ) : (
          <FeatureList features={caps} lens={lens} />
        )}
      </Section>
      <Work
        scope={scope}
        lens={lens}
        rows={work}
        waiting={scope.waitingOn}
        cap={CAP}
        label="Work beneath"
        empty="Nothing open at this feature or beneath it."
      />
      <Signals />
    </>
  );
}

// --- capability: the work itself ----------------------------------------------------------------------------

function CapabilityBody({ scope, lens }: { scope: Scope; lens: Lens }) {
  // a capability may hold capabilities of its own: the same compact list a feature shows, only when there are any
  const below = featuresBelow(scope.tree);
  return (
    <>
      {below.length > 0 && (
        <Section label={`${many(below[0]?.level ?? 'capability')} beneath`} aside={String(below.length)}>
          <FeatureList features={below} lens={lens} />
        </Section>
      )}
      <Work
        scope={scope}
        lens={lens}
        rows={allWork(scope)}
        waiting={scope.waitingOn}
        label="Work"
        empty="Nothing open here."
      />
      <Signals />
    </>
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

/** Features as compact rows: state, name, what is open, when it last moved. */
function FeatureList({ features, lens }: { features: ScopeNode[]; lens: Lens }) {
  return (
    <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
      {features.map((f) => {
        const h = f.health;
        const word = h ? healthWord(h) : 'not started';
        return (
          <li key={f.key}>
            <NodeLink to={f.key} lens={lens} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-raised">
              <StateDot state={f.derived ?? f.status} />
              <span className="min-w-0 flex-1 truncate font-medium">{f.name ?? f.title ?? short(f.key)}</span>
              <span className="text-meta text-ink-faint">{f.open ? `${f.open} open` : '—'}</span>
              <span
                className={
                  word === 'stale'
                    ? 'w-24 text-right text-meta text-status-review'
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

/** The work grouped by intent. Proposed decisions open the waiting group. A cap per group points at the lanes. */
function Work({
  scope,
  lens,
  rows,
  waiting,
  cap,
  label,
  empty,
}: {
  scope: Scope;
  lens: Lens;
  rows: ChangeRow[];
  waiting: WaitingDecision[];
  cap?: number;
  label: string;
  empty: string;
}) {
  const groups = byIntent(rows);
  const showProject = scope.projects.length > 1;
  const at = scope.node?.key;
  if (groups.length === 0 && waiting.length === 0) {
    return (
      <Section label={label}>
        <EmptyState title={empty} hint="A change names this feature with --features when it touches it." />
      </Section>
    );
  }
  const hasWaiting = groups.some((g) => g.intent === 'waiting');
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <Label>{label}</Label>
        <span className="text-meta text-ink-faint">{plural(rows.length, 'change')}</span>
      </div>
      {!hasWaiting && waiting.length > 0 && (
        <Section label="Waiting on you" aside={String(waiting.length)}>
          <Decisions items={waiting} lens={lens} />
        </Section>
      )}
      {groups.map((g) => (
        <Section
          key={g.intent}
          label={g.label}
          aside={String(g.rows.length + (g.intent === 'waiting' ? waiting.length : 0))}
        >
          {g.intent === 'waiting' && waiting.length > 0 && <Decisions items={waiting} lens={lens} />}
          {(cap ? g.rows.slice(0, cap) : g.rows).map((r) => (
            <ChangeCard key={r.key} row={r} lens={lens} at={at} showProject={showProject} />
          ))}
          {cap && g.rows.length > cap && (
            <Link
              to="."
              search={(prev: Record<string, unknown>) => ({ ...prev, view: 'lanes' as const })}
              className="text-xs text-ink-muted hover:text-ink"
            >
              and {g.rows.length - cap} more in lanes
            </Link>
          )}
        </Section>
      ))}
    </div>
  );
}

/** Proposed decisions as cards that open in place: the title and the change collapsed; the whole decision, the why, a
 *  copy of its reference and a way to the change's decisions tab when open. Nothing navigates on the first click. */
function Decisions({ items, lens }: { items: WaitingDecision[]; lens: Lens }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <ol className="flex flex-col gap-2">
      {items.map((d) => {
        const isOpen = open.has(d.key);
        return (
          <li key={d.key} className="flex flex-col rounded-card border border-line bg-surface">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(d.key)}
              className="flex w-full flex-col gap-1 px-3.5 py-3 text-left hover:bg-raised"
            >
              <div className="flex items-center gap-2">
                <ChevronRight
                  className={cn('size-3.5 shrink-0 text-ink-faint transition-transform', isOpen && 'rotate-90')}
                  aria-hidden="true"
                />
                <Chip className="text-status-review">
                  <span aria-hidden="true" className="size-[7px] rounded-full bg-current" />
                  decide
                </Chip>
                <span className={cn('min-w-0 flex-1 font-medium', !isOpen && 'truncate')}>
                  {d.title ?? short(d.key)}
                </span>
                <span className="shrink-0 text-meta text-ink-faint">{short(d.change)}</span>
              </div>
              {!isOpen && d.decision && (
                <p className="truncate pl-[22px] text-xs text-ink-muted">{truncate(d.decision, 140)}</p>
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3 pl-[36px]">
                {d.decision && <p className="text-[13px] leading-relaxed text-ink-muted">{d.decision}</p>}
                {d.why && (
                  <p className="text-xs leading-relaxed text-ink-faint">
                    <span className="label mr-1.5">Why</span>
                    {d.why}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-meta text-ink-faint">
                  <span className="font-mono">{short(d.key)}</span>
                  <CopyRef text={d.key} />
                  <NodeLink to={d.key} lens={lens} className="ml-auto hover:text-ink">
                    open on {short(d.change)} →
                  </NodeLink>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Copies a reference for pasting into a session; says so for a moment. */
function CopyRef({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 hover:text-ink"
      title="Copy the reference"
    >
      {done ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {done ? 'copied' : 'copy'}
    </button>
  );
}

function WaitingList({ items, lens }: { items: WaitingDecision[]; lens: Lens }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return (
    <Section label="Waiting on you" aside={String(items.length)}>
      <Decisions items={shown} lens={lens} />
      {items.length > shown.length && (
        <Link
          to="."
          search={(prev: Record<string, unknown>) => ({ ...prev, view: 'inbox' as const })}
          className="text-xs text-ink-muted hover:text-ink"
        >
          and {items.length - shown.length} more in the inbox
        </Link>
      )}
    </Section>
  );
}

function LiveList({ scope, lens }: { scope: Scope; lens: Lens }) {
  if (scope.sessions.length === 0) return null;
  return (
    <Section label="Live now" aside={String(scope.sessions.length)}>
      <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
        {scope.sessions.map((s) => (
          <li key={s.key}>
            <NodeLink to={s.key} lens={lens} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-raised">
              <Pulse className="size-[7px]" />
              <span className="min-w-0 flex-1 truncate text-xs">
                <span className="font-medium">{s.onBehalfOf ? short(s.onBehalfOf) : (s.agent ?? short(s.key))}</span>
                {s.on && <span className="text-ink-muted"> on {short(s.on)}</span>}
              </span>
              {s.on && <StatusChip status={scope.changes.find((r) => r.key === s.on)?.status} />}
              <span className="text-meta text-ink-faint">{ago(s.last)}</span>
            </NodeLink>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** The slot the roll-up reserves for measures observed outside pjman, empty until one exists. */
function Signals() {
  return (
    <p className="text-meta text-ink-faint">
      <span className="label mr-1.5">Signals</span>none observed yet
    </p>
  );
}
