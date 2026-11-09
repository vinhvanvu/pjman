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
// A session bound to a milestone works inside it (decision milestone-detail/milestone-leads-the-dock): the body is
// the milestone's tree, the child the session is on (or the person looks at) opened in place among its children,
// and the page stays while the focus moves beneath the milestone; a tap on a child's row is a look at it, the pick.
// Motion (decision one-shown-change): the chosen chip's fill slides to the picked chip, the body rises in and the
// rail's rows with it; when the focus moves and nothing is held, the ring moves to the new chip and the chips reorder
// in place; held, only the ring moves. Reduced motion keeps the fades and drops the rise and the slide.
import { useNavigate, useSearch } from '@tanstack/react-router';
import { cn } from 'cn';
import { m } from 'motion/react';
import type { Lens, SessionFacts, StoreEvent } from '@/data/contract';
import { useDecideAction, useRail, useScope, useStore } from '@/data/queries';
import { Pending } from '@/components/Pending';
import { Label } from '@/components/chips/Chip';
import { Pulse } from '@/components/presence/Presence';
import { ChangeTree, featureNames, RISE, Sources } from '@/features/change';
import { dockArrivals } from '@/features/dock/model';
import { beneathOf, frameOf, MilestoneChildren } from '@/features/milestones';
import { ActivityRail } from '@/features/rail/ActivityRail';
import { UNFOLDED } from '@/features/rail/model';
import { useHeldList, useHold } from '@/lib/hold';
import { short } from '@/lib/keys';
import { TONE } from '@/lib/tones';
import type { PageSearch } from '@/routes/-search';
import { useFreshEvents } from '@/state/arrivals';
import { useAt } from '@/state/moment';
import { type ChipView, chipViews, sessionBar, shownOf, viewing } from './model';

const NO_EVENTS: readonly StoreEvent[] = [];
/** The lanes over the session's life, every one of them: the rail's page is read by the rail itself. */
const LANES_QUERY = { limit: 1, fold: UNFOLDED } as const;
const chipKey = (c: ChipView) => c.key;
/** The lane's colour, as the custom property the chips, the bars and the dots read. */
const laneStyle = (colour: string) => ({ '--lane': colour }) as React.CSSProperties;
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
  // the frame (decision milestone-leads-the-dock): the last milestone the session bound that stands over the shown
  // change; the body is then the milestone's tree with the shown child open, read against the product's rows
  const roadmap = useScope({ lens: 'roadmap', node: session.product, done: true }, !!session.product);
  const rows = new Map((roadmap.data?.changes ?? []).map((r) => [r.key, r]));
  const frameKey = frameOf(session.binds, shown, rows);
  const subject = frameKey ?? shown;
  const scope = useScope({ lens: 'feature', node: subject }, !!subject);
  // the shown change's record, never the one before it while this one loads
  const read = scope.data;
  const ctx = read?.change && read.change.change.key === subject ? read.change : undefined;
  const parentOf = read?.crumbs.filter((k) => !k.key.startsWith('product:')).toReversed() ?? [];
  const beneath = frameKey ? beneathOf(frameKey, rows.values()) : undefined;
  const waitingBeneath = beneath ? waitingOn.filter((d) => beneath.has(d.change)) : [];
  const frame = frameKey
    ? {
        rows,
        sessions: product.data?.sessions ?? [],
        waiting: waitingBeneath,
        open: shown === frameKey ? undefined : shown,
        onPick: setPick,
      }
    : undefined;
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
            wide ? 'relative flex-[999_1_560px] gap-6 overflow-auto px-9 pt-6 pb-9' : 'gap-[22px]',
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
          <aside className="relative flex w-[520px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface px-[22px] py-6">
            {rail}
          </aside>
        )}
      </div>
    );
  }

  const body = ctx ? (
    <ChangeTree
      key={subject}
      ctx={ctx}
      lens={lens}
      where="session"
      mode={mode}
      wide={wide}
      isViewing={isViewing}
      live={session.state === 'live'}
      working={session.working && !isViewing}
      under={parentOf}
      names={names}
      arrivals={arrivals}
      moment={at}
      decide={decide}
      actor={actor}
      held={hold.held}
      linked={decision}
      onLink={setDecision}
      milestoneSlot={
        frame ? (
          <MilestoneChildren
            ctx={ctx}
            lens={lens}
            mode={mode}
            wide={wide}
            frame={frame}
            working={session.working}
            decide={decide}
            actor={actor}
            linked={decision}
            onLink={setDecision}
            moment={at}
            held={hold.held}
          />
        ) : undefined
      }
      waitingBeneath={frame ? waitingBeneath : undefined}
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
          className="relative flex min-w-0 flex-[999_1_560px] flex-col gap-6 overflow-auto px-9 pt-6 pb-9"
          {...hold.props}
        >
          {barRow}
          {header}
          {body}
        </section>
        <aside
          aria-label="The session's sources and timeline"
          className="relative flex w-[520px] shrink-0 flex-col gap-3 overflow-auto border-l border-line bg-surface px-[22px] py-6"
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
