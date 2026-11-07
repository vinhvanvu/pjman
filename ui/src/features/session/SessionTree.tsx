// The session page as one tree (change:session-detail; decisions session-leads-the-dock, one-shown-change,
// one-tree-two-variables): the session is the subject, the change it is on its body. The session bar first (who,
// working for how long, when it last acted, what waits); then the focus card, whose header is the row of changes the
// session touched, last touch first, each with its writes or the word read, the focus chip ringed with the live pulse
// and the word now, a dot where a decision waits; the shown change is the person's pick while they hold one, else the
// session's focus, and while they hold a pick away from the focus a banner names where the session is with the way
// back. The card body reads the shown change: the identity row with the link to its page, its name and gist, the
// path line, the plan with its bar, the decisions (only what waits is a card; the decided are on the rail), the
// sources. The rail is the session's own, held to the shown change (change:session-timeline-focus): the row of chips
// is the one filter, so the rail holds the shown change's lane alone and draws no filter of its own.
// Width forks two things only: how far the plan and the sources open (docked the plan shows its active row and the
// sources one line, each opening in place; wide the plan is out and the sources sit in the panel above the rail), and
// where the rail sits (beneath the body docked, in the panel wide). Cardinality forks one: the chip row exists only
// with several changes. Everything else is one component.
// Motion (decision one-shown-change): the chosen chip's fill slides to the picked chip, the body rises in and the
// rail's rows with it; when the focus moves and nothing is held, the ring moves to the new chip and the chips reorder
// in place; held, only the ring moves. Reduced motion keeps the fades and drops the rise and the slide.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { cn } from 'cn';
import { Check, ChevronRight, Diamond } from 'lucide-react';
import { m } from 'motion/react';
import { useState } from 'react';
import type { ChangeAspects, ChangeContext, Lens, ScopeNode, SessionFacts, StoreEvent } from '@/data/contract';
import { useDecideAction, useRail, useScope, useStore } from '@/data/queries';
import { Pending } from '@/components/Pending';
import { KeyText, Label } from '@/components/chips/Chip';
import { fromRow } from '@/components/decisions/model';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Readiness } from '@/components/record/Foundation';
import { AspectReading, AspectWholeBody } from '@/features/aspects';
import { dockArrivals } from '@/features/dock/model';
import { ActivityRail } from '@/features/rail/ActivityRail';
import { UNFOLDED } from '@/features/rail/model';
import { agoWords } from '@/lib/format';
import { useHeldList, useHold } from '@/lib/hold';
import { short } from '@/lib/keys';
import { Wash } from '@/lib/motion';
import { statusTone, TONE } from '@/lib/tones';
import type { PageSearch } from '@/routes/-search';
import { useFreshEvents } from '@/state/arrivals';
import { useAt } from '@/state/moment';
import {
  type ChipView,
  childrenView,
  chipViews,
  effectsOf,
  identityLabel,
  planView,
  type Segment,
  sessionBar,
  shownOf,
  sourcesView,
  viewing,
} from './model';

const NO_EVENTS: readonly StoreEvent[] = [];
/** The lanes over the session's life, every one of them: the rail's page is read by the rail itself. */
const LANES_QUERY = { limit: 1, fold: UNFOLDED } as const;
const chipKey = (c: ChipView) => c.key;
/** The lane's colour, as the custom property the chips, the bars and the dots read. */
const laneStyle = (colour: string) => ({ '--lane': colour }) as React.CSSProperties;
/** The body rises in: 4 px and a fade, 180 ms ease-out; reduced motion keeps the fade. */
const RISE = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
};
const SLIDE = { duration: 0.18, ease: 'easeOut' as const };

/** The page's two session parameters: the change held shown, and the decision open (decision one-shown-change,
 *  decision-card). Both live in the URL, so a link lands where the person was. */
export function useSessionSearch() {
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const set = (patch: Partial<Pick<PageSearch, 'show' | 'decision'>>) =>
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: true,
    });
  return {
    pick: search.show,
    setPick: (key: string | undefined) => set({ show: key }),
    decision: search.decision,
    setDecision: (key: string | undefined) => set({ decision: key }),
  };
}

export function SessionTree({
  session,
  lens,
  wide,
  className,
}: {
  session: SessionFacts;
  lens: Lens;
  wide: boolean;
  className?: string;
}) {
  const { pick, setPick, decision, setDecision } = useSessionSearch();
  const at = useAt();
  const focus = session.on;
  const shown = shownOf(pick, focus);
  const isViewing = viewing(pick, focus);
  const lanes = useRail(session.key, LANES_QUERY);
  const product = useScope({ lens: 'feature', node: session.product }, !!session.product);
  const waitingOn = product.data?.waitingOn ?? [];
  const live = chipViews(lanes.data?.lanes ?? [], focus, waitingOn);
  // held: while the person holds a pick the chips keep their places; only the ring moves (decision one-shown-change).
  // The hold begins once the lanes are read, so a page opened on a pick does not hold an empty row
  const { shown: chips } = useHeldList(live, isViewing && lanes.isSuccess, chipKey);
  const scope = useScope({ lens: 'feature', node: shown }, !!shown);
  // the shown change's record, never the one before it while this one loads
  const read = scope.data;
  const ctx = read?.change && read.change.change.key === shown ? read.change : undefined;
  const parentOf = read?.crumbs.filter((k) => !k.key.startsWith('product:')).toReversed() ?? [];
  const names = featureNames(product.data?.tree ?? []);
  // the session bar sums the waits across the chips (decision decision-card)
  const waits = waitingOn.filter((d) => live.some((c) => c.key === d.change)).length;
  const bar = sessionBar(session, waits);
  const colour =
    chips.find((c) => c.key === shown)?.colour ?? live.find((c) => c.key === shown)?.colour ?? 'var(--primary)';
  const hold = useHold();
  const fresh = useFreshEvents();
  const arrivals = dockArrivals(at ? NO_EVENTS : fresh, session.key, shown);
  const decide = useDecideAction('decide');
  const { data: store } = useStore();
  const actor = store?.actor ?? undefined;
  const mode = wide ? 'focus' : 'select';
  const focusChip = chips.find((c) => c.isFocus) ?? live.find((c) => c.isFocus);
  const shownChip = chips.find((c) => c.key === shown) ?? live.find((c) => c.key === shown);

  const barRow = <SessionBar live={session.state === 'live'} parts={bar.parts} waits={bar.waits} alarm={bar.alarm} />;
  const header = (
    <>
      {chips.length > 1 && (
        <ChipRow
          chips={chips}
          shown={shown}
          onPick={setPick}
          id={session.key}
          className={wide ? 'border-b border-line pb-3.5' : undefined}
        />
      )}
      {isViewing && (
        <m.div
          key="viewing"
          {...RISE}
          role="status"
          className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] text-ink-muted', TONE.live.soft)}
        >
          <Pulse className="size-[7px]" />
          <span className="min-w-0">
            The session is on{' '}
            <b className="font-semibold text-ink">{focusChip?.title ?? (focus ? short(focus) : 'no change')}</b> · you
            are viewing <b className="font-semibold text-ink">{shownChip?.title ?? (shown ? short(shown) : '')}</b>
          </span>
          <button
            type="button"
            onClick={() => setPick(undefined)}
            className={cn(
              'ml-auto h-[26px] shrink-0 rounded-row border px-2.5 text-xs font-semibold',
              TONE.live.line,
              TONE.live.text,
            )}
          >
            Back to it
          </button>
        </m.div>
      )}
    </>
  );
  const rail = (
    <ActivityRail
      scope={session.key}
      lens={lens}
      limit={wide ? 20 : 8}
      only={shown}
      label="Timeline"
      note={<span className="text-meta text-ink-faint">newest first · the shown change only</span>}
      held={hold.held}
    />
  );

  if (!shown) {
    // the session has bound no change yet: the bar, the word, and its own lines
    return (
      <div className={cn(wide ? 'flex min-h-0 flex-1' : 'flex flex-col gap-[22px] px-4 pt-[18px] pb-4', className)}>
        <section
          className={cn(
            'flex min-w-0 flex-col',
            wide ? 'flex-[999_1_560px] gap-6 overflow-auto px-9 pt-6 pb-9' : 'gap-[22px]',
          )}
        >
          {barRow}
          <div className="flex flex-col gap-1.5">
            <Label>session</Label>
            <h1 className="text-[18px] font-semibold tracking-tight">No change yet</h1>
            <p className="text-body text-ink-muted">
              The page moves to the change the moment this session binds one: name it in a prompt, or start on its
              branch.
            </p>
          </div>
          {!wide && rail}
        </section>
        {wide && (
          <aside className="flex w-[520px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface px-[22px] py-6">
            {rail}
          </aside>
        )}
      </div>
    );
  }

  const body = ctx ? (
    <FocusBody
      key={shown}
      ctx={ctx}
      lens={lens}
      mode={mode}
      wide={wide}
      isViewing={isViewing}
      live={session.state === 'live'}
      under={parentOf}
      names={names}
      arrivals={arrivals}
      moment={at}
      decide={decide}
      actor={actor}
      held={hold.held}
      linked={decision}
      onLink={setDecision}
    />
  ) : (
    <Pending />
  );
  const sources = ctx && <Sources ctx={ctx} lens={lens} mode={mode} wide={wide} />;

  if (wide)
    return (
      <div className={cn('flex min-h-0 flex-1', className)} style={laneStyle(colour)}>
        <section
          aria-label="The session and the change it is on now"
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 overflow-auto px-9 pt-6 pb-9"
          {...hold.props}
        >
          {barRow}
          {header}
          {body}
        </section>
        <aside
          aria-label="The session's sources and timeline"
          className="flex w-[520px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface px-[22px] py-6"
        >
          {sources}
          {sources && <div className="my-1.5 h-px bg-line" aria-hidden="true" />}
          {rail}
        </aside>
      </div>
    );

  return (
    <article
      className={cn('flex flex-col gap-[22px] px-4 pt-[18px] pb-4', className)}
      style={laneStyle(colour)}
      {...hold.props}
    >
      {barRow}
      <section aria-label="The change the session is on now" className="flex flex-col gap-3">
        {header}
        {body}
        {sources}
      </section>
      {rail}
    </article>
  );
}

/** The feature names the map knows, by key: the path line names features by them. */
function featureNames(tree: readonly ScopeNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: readonly ScopeNode[]) => {
    for (const n of nodes) {
      if (n.name ?? n.title) out.set(n.key, n.name ?? n.title!);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The session bar: a separator travels with the word after it, so a wrapped line never ends in a dot. */
function SessionBar({ live, parts, waits, alarm }: { live: boolean; parts: string[]; waits: string; alarm: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted">
      {live && <Pulse />}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-ink-faint">· </span>}
          {p}
        </span>
      ))}
      <span className={cn(alarm && cn('font-semibold', TONE.waits.text))}>
        <span className="font-normal text-ink-faint">· </span>
        {waits}
      </span>
    </div>
  );
}

/** The chips: the changes this session touched, last touch first. The chosen one's fill slides to the picked chip;
 *  the focus wears the breathing ring and the word now; a dot says a decision waits there. */
function ChipRow({
  chips,
  shown,
  onPick,
  id,
  className,
}: {
  chips: readonly ChipView[];
  shown?: string;
  onPick: (key: string) => void;
  id: string;
  className?: string;
}) {
  return (
    <ul
      role="tablist"
      aria-label="Changes this session, last touch first"
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {chips.map((c) => {
        const on = c.key === shown;
        return (
          <m.li key={c.key} layout="position" style={laneStyle(c.colour)}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onPick(c.key)}
              title={c.isFocus ? `${c.title}, the session's focus` : c.title}
              className={cn(
                'relative inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-200',
                on ? 'border-transparent text-ink' : 'border-line-strong text-ink-muted hover:text-ink',
                c.isFocus && 'breathe',
              )}
            >
              {on && (
                <m.span
                  layoutId={`chip-fill-${id}`}
                  transition={SLIDE}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full border border-[var(--lane)] bg-[color-mix(in_srgb,var(--lane)_16%,var(--card))]"
                />
              )}
              <span aria-hidden="true" className="relative size-2 shrink-0 rounded-full bg-[var(--lane)]" />
              <span className="relative">{c.title}</span>
              {c.isFocus && (
                <span
                  className={cn('relative text-[10.5px] font-semibold tracking-[.04em] uppercase', TONE.live.text)}
                  aria-label="the session's focus"
                >
                  now
                </span>
              )}
              {c.waits > 0 && (
                <span
                  aria-label="a decision waits on you"
                  className={cn('relative size-1.5 shrink-0 rounded-full', TONE.waits.bg)}
                />
              )}
              <span className="relative text-[11px] font-normal text-ink-faint">{c.count}</span>
            </button>
          </m.li>
        );
      })}
    </ul>
  );
}

/** One section head at every width: the label, a one-line summary, a chevron only when the section is folded. */
function Head({
  label,
  sum,
  open,
  onToggle,
  className,
}: {
  label: string;
  sum?: string;
  /** Given, the section folds: the chevron shows and turns. */
  open?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const inner = (
    <>
      <span className="text-[13.5px] font-semibold text-ink">{label}</span>
      {sum && <span className="min-w-0 truncate text-xs text-ink-faint">{sum}</span>}
      {onToggle && (
        <ChevronRight
          className={cn(
            'ml-auto size-3.5 shrink-0 text-ink-faint transition-transform duration-200',
            open && 'rotate-90',
          )}
          aria-hidden="true"
        />
      )}
    </>
  );
  return onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn('flex w-full items-center gap-2 text-left', className)}
    >
      {inner}
    </button>
  ) : (
    <div className={cn('flex items-center gap-2', className)}>{inner}</div>
  );
}

/** The bar: a segment a step or a child; done green, the one on in the lane's colour, dropped faint. */
function SegmentBar({ segments, label }: { segments: readonly string[]; label: string }) {
  const cls = (s: string) =>
    s === 'done'
      ? TONE.done.bg
      : s === 'on' || s === 'active'
        ? 'bg-[var(--lane)]'
        : s === 'review'
          ? TONE.waits.bg
          : s === 'dropped'
            ? 'bg-line/40'
            : s === 'blocked'
              ? TONE.alarm.bg
              : 'bg-line-strong';
  return (
    <div className="flex items-center gap-1" role="img" aria-label={label}>
      {segments.map((s, i) => (
        <span key={i} className={cn('h-1 flex-1 rounded-sm transition-colors duration-200', cls(s))} />
      ))}
    </div>
  );
}

type Step = ChangeContext['plan'][number];

/** A plan row: the step's mark, its text, the note of where the work stands and when. */
function PlanRow({ step, on }: { step: Step; on: boolean }) {
  const done = step.state === 'done';
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 py-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-3.5 place-items-center rounded-full border-[1.5px]',
          done ? cn('border-transparent text-primary-foreground', TONE.done.bg) : 'border-line-strong',
          on && 'border-[var(--lane)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lane)_22%,transparent)]',
          step.state === 'dropped' && 'border-dashed',
        )}
      >
        {done && <Check className="size-[9px]" strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <div
          className={cn(
            'text-body leading-normal',
            on && 'font-medium',
            done && 'text-ink-muted',
            step.state === 'dropped' && 'text-ink-faint line-through',
          )}
        >
          {step.text}
        </div>
        {step.note && (
          <div className="mt-1 text-[12.5px] leading-normal text-ink-muted">
            {step.note}
            {step.at && <span className="text-ink-faint"> · {agoWords(step.at)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card body: the shown change read as the ladder, then its plan and its decisions. Keyed on the change by the
 *  caller, so it rises in whenever the shown change swaps. */
function FocusBody({
  ctx,
  lens,
  mode,
  wide,
  isViewing,
  live,
  under,
  names,
  arrivals,
  moment,
  decide,
  actor,
  held,
  linked,
  onLink,
}: {
  ctx: ChangeContext;
  lens: Lens;
  mode: 'focus' | 'select';
  wide: boolean;
  isViewing: boolean;
  live: boolean;
  under: { key: string; name?: string; title?: string }[];
  names: Map<string, string>;
  arrivals: ReturnType<typeof dockArrivals>;
  moment?: string;
  decide?: ReturnType<typeof useDecideAction>;
  actor?: string;
  held: boolean;
  linked?: string;
  onLink: (key: string | undefined) => void;
}) {
  const c = ctx.change;
  const [planOpen, setPlanOpen] = useState(false);
  const milestone = ctx.children.length > 0;
  const plan = planView(ctx.plan);
  const children = childrenView(ctx.children);
  const effects = effectsOf(c.data.features);
  const decisions = ctx.decisions.map((d) => fromRow(d, c.key));
  const waiting = decisions.filter((d) => d.status === 'proposed').length;
  const decided = decisions.length - waiting;
  const kind = c.data.kind === 'bug' ? 'bug' : 'change';
  const label = identityLabel(isViewing, kind);
  const top = under[0];
  const onNow = !isViewing && live;
  return (
    <m.div {...RISE} className={cn('flex flex-col', wide ? 'gap-6' : 'gap-3')}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-[7px] text-meta font-semibold tracking-[.04em]',
            onNow ? TONE.live.text : 'text-ink-faint',
          )}
        >
          {onNow && <Pulse className="size-[7px]" />}
          {label}
        </span>
        <NodeLink
          to={c.key}
          lens={lens}
          mode="focus"
          className="ml-auto inline-flex items-center gap-0.5 text-meta font-medium text-primary hover:underline"
        >
          Open the {kind} page
          <ChevronRight className="size-3" aria-hidden="true" />
        </NodeLink>
      </div>
      <div className="relative flex flex-col gap-1.5">
        <Wash
          arrival={arrivals.status?.seq}
          className={cn(statusTone(c.status).wash, '-inset-x-2 -inset-y-1 rounded-card')}
        />
        <h1 className="text-[18px] leading-[1.3] font-semibold tracking-tight">{c.name ?? c.title ?? short(c.key)}</h1>
        {c.name && c.title && c.title !== c.name && (
          <p className="text-body leading-normal text-ink-muted">{c.title}</p>
        )}
        <Readiness needs={ctx.needs} stale={ctx.stale} migrated={ctx.migrated} />
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
          <span className={cn('font-medium', statusTone(c.status).text)}>{c.status ?? 'open'}</span>
          {milestone && <Part>milestone · {ctx.children.length} children</Part>}
          {effects.map((e) => (
            <Part key={e.key}>
              {e.effect}{' '}
              <NodeLink to={e.key} lens={lens} mode={mode} className="text-ink hover:text-primary">
                {names.get(e.key) ?? short(e.key)}
              </NodeLink>
            </Part>
          ))}
          {ctx.parent && (
            <Part>
              under{' '}
              <NodeLink to={ctx.parent.key} lens={lens} mode={mode} className="text-ink hover:text-primary">
                {ctx.parent.name ?? ctx.parent.title ?? short(ctx.parent.key)}
              </NodeLink>
            </Part>
          )}
          {!ctx.parent && top && (
            <Part>
              in{' '}
              <NodeLink to={top.key} lens={lens} mode={mode} className="text-ink hover:text-primary">
                {top.name ?? top.title ?? short(top.key)}
              </NodeLink>
            </Part>
          )}
          {ctx.branch && (
            <Part>
              branch <KeyText className="text-ink-muted">{ctx.branch.name}</KeyText>
            </Part>
          )}
        </div>
        {ctx.aspects && <AspectChips aspects={ctx.aspects} lens={lens} />}
      </div>

      <div className={cn('flex flex-col', wide ? 'max-w-[760px] gap-8' : 'gap-3')}>
        <section className="flex flex-col gap-2.5">
          {milestone ? (
            <>
              <Head
                label="Children"
                sum={children.sum}
                open={wide ? undefined : planOpen}
                onToggle={wide ? undefined : () => setPlanOpen((v) => !v)}
              />
              <SegmentBar segments={children.segments} label={`Children: ${children.sum}`} />
              {(wide || planOpen ? ctx.children : children.row ? [children.row] : []).map((k) => (
                <div key={k.key} className="flex items-center gap-2 py-1 text-body">
                  <span
                    aria-hidden="true"
                    className={cn('size-[7px] shrink-0 rounded-full', statusTone(k.status).bg)}
                  />
                  <NodeLink
                    to={k.key}
                    lens={lens}
                    mode={mode}
                    className="min-w-0 flex-1 truncate font-medium hover:text-primary"
                  >
                    {k.name ?? k.title ?? short(k.key)}
                  </NodeLink>
                  <span className={cn('text-meta', statusTone(k.status).text)}>{k.status ?? 'open'}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <Head
                label="Plan"
                sum={plan.sum}
                open={wide ? undefined : planOpen}
                onToggle={wide || !ctx.plan.length ? undefined : () => setPlanOpen((v) => !v)}
              />
              {ctx.plan.length > 0 && <SegmentBar segments={plan.segments} label={`Plan: ${plan.sum}`} />}
              <div className="flex flex-col">
                {(wide || planOpen ? ctx.plan : plan.row ? [plan.row] : []).map((s, i) => (
                  <PlanRow key={`${i}-${s.text}`} step={s} on={s === plan.row && s.state !== 'done'} />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2.5">
          <Head label="Decisions" sum={groupHeadWords(waiting, decided)} />
          {waiting > 0 && (
            <DecisionGroup
              decisions={decisions}
              lens={lens}
              where="session"
              actor={actor}
              wide={wide}
              linked={linked}
              onLink={onLink}
              onDecide={decide}
              opened={arrivals.opened}
              moment={moment}
              held={held}
            />
          )}
        </section>
      </div>
    </m.div>
  );
}

const groupHeadWords = (waiting: number, decided: number) =>
  waiting === 0
    ? 'nothing waits · the decided are on the rail'
    : waiting === 1
      ? '1 waits on you'
      : `${waiting} wait on you, oldest first${decided ? '' : ''}`;

/** A part of the path line: the separator travels with it. */
function Part({ children }: { children: React.ReactNode }) {
  return (
    <span>
      <span className="text-ink-faint">· </span>
      {children}
    </span>
  );
}

type Source = ChangeContext['sources'][number];

/** The sources as rows: the branch and whether a session was seen on it, the links, the files. Wide they are out in
 *  the panel; docked the head alone, opening in place. */
function Sources({
  ctx,
  lens,
  mode,
  wide,
}: {
  ctx: ChangeContext;
  lens: Lens;
  mode: 'focus' | 'select';
  wide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const v = sourcesView(ctx);
  const rows = (
    <div className="flex flex-col gap-1.5 text-body">
      {v.branch && (
        <SourceRow label="branch">
          <KeyText className="text-ink">{v.branch.name}</KeyText>
          <span className="text-meta text-ink-faint">
            · {v.branch.observed ? 'a session was seen on it' : 'recommended, not seen yet'}
          </span>
        </SourceRow>
      )}
      {v.links.map((s) => (
        <SourceRow key={s.key} label="link">
          <SourceLink s={s} lens={lens} mode={mode} />
          <span className="text-meta text-ink-faint">· {s.via === 'binds' ? 'bound' : 'linked'}</span>
        </SourceRow>
      ))}
      {v.files.length === 0 ? (
        <SourceRow label="files">
          <span className="text-ink-faint">none yet</span>
        </SourceRow>
      ) : (
        v.files.slice(0, 8).map((s) => (
          <SourceRow key={s.key} label="file">
            <SourceLink s={s} lens={lens} mode={mode} mono />
          </SourceRow>
        ))
      )}
      {v.files.length > 8 && <span className="pl-[60px] text-meta text-ink-faint">and {v.files.length - 8} more</span>}
    </div>
  );
  if (wide)
    return (
      <section className="flex flex-col gap-2.5">
        <Head label="Sources" sum={v.sum} />
        {rows}
      </section>
    );
  return (
    <section className="flex flex-col gap-2.5">
      <Head label="Sources" sum={v.sum} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && rows}
    </section>
  );
}

function SourceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-14 shrink-0 text-xs text-ink-faint">{label}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">{children}</span>
    </div>
  );
}

/** A source by its title, opening outside the store when it has a place there, else at the getter. */
function SourceLink({ s, lens, mode, mono }: { s: Source; lens: Lens; mode: 'focus' | 'select'; mono?: boolean }) {
  const text = s.record?.title ?? short(s.key);
  const cls = cn('min-w-0 truncate text-primary hover:underline', mono && 'font-mono text-meta');
  if (s.url)
    return (
      <a href={s.url} target="_blank" rel="noreferrer" className={cls} title={`Opens ${s.url}`}>
        {text}
      </a>
    );
  return (
    <NodeLink to={s.key} lens={lens} mode={mode} className={cls}>
      {text}
    </NodeLink>
  );
}

/** The aspects the change works under, as chips under its path (aspect:aspects/dashboard): a chip opens the aspect as
 *  it applies here, beneath the row, with the way back. */
function AspectChips({ aspects, lens }: { aspects: ChangeAspects; lens: Lens }) {
  const [open, setOpen] = useState<string | undefined>();
  const chips = [
    ...aspects.named.map((n) => ({ key: n.aspect, named: true, forked: false })),
    ...aspects.at.map((x) => ({ key: x.aspect, named: false, forked: x.layers.some((l) => l.from === x.place) })),
  ];
  if (!chips.length) return null;
  const named = aspects.named.find((n) => n.aspect === open);
  const at = aspects.at.find((x) => x.aspect === open);
  return (
    <div className="flex flex-col gap-2 pt-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-expanded={open === c.key}
            onClick={() => setOpen(open === c.key ? undefined : c.key)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-chip border px-1.5 text-meta',
              open === c.key
                ? 'border-primary/50 bg-selection text-ink'
                : 'border-line-strong text-ink-muted hover:bg-raised hover:text-ink',
            )}
            title={c.named ? 'This change works on the aspect' : 'The change works under this aspect'}
          >
            <Diamond className="size-3" aria-hidden="true" />
            {c.key.split('/').pop()}
            {c.named && <span className="text-ink-faint">· working on it</span>}
            {c.forked && <span className="text-ink-faint">· forked</span>}
          </button>
        ))}
      </div>
      {(named || at) && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface px-3.5 py-3">
          {named ? <AspectWholeBody whole={named} lens={lens} /> : at && <AspectReading at={at} lens={lens} />}
        </div>
      )}
    </div>
  );
}

export type { Segment };
