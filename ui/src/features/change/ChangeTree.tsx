// The change tree (change:change-detail; decisions mirror-the-session-page, one-tree-two-variables): one component
// draws a change wherever it is read, the session page's body, the change's own page and the map's side panel, forked
// only for a reason written here. Width decides how far each section opens: wide, the plan is out with what is behind
// it folded to one line, and the sections are out; folded, each section is its head with a one-line summary opening in
// place, the plan its active row. Where it is drawn decides the rest: on the session page the session is the subject,
// so only what waits is a card (the decided are on the session's rail) and the record's sections are one drill away;
// where the change is the subject its decided rows and history stay (decision detail-pages/decision-card) and its
// sections follow the decisions. The identity row says where the session is on the session page, the change's kind
// elsewhere; its right end is the way to the change's page, or on that page the key to copy. A milestone's children
// stand where a change has its plan (decision milestone-detail/children-in-order), drawn by the caller into the
// milestone slot with the frame they are read against, and the decisions waiting beneath join its own as cards.
import { cn } from 'cn';
import { Check, ChevronRight, Diamond } from 'lucide-react';
import { m } from 'motion/react';
import { useState } from 'react';
import type { ChangeAspects, ChangeContext, Lens, WaitingDecision } from '@/data/contract';
import type { useDecideAction } from '@/data/queries';
import { Chip, KeyText, Label } from '@/components/chips/Chip';
import { fromRow, fromWaiting, groupHead } from '@/components/decisions/model';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { CopyKey } from '@/components/links/CopyKey';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { Readiness } from '@/components/record/Foundation';
import { AspectReading, AspectWholeBody } from '@/features/aspects';
import type { dockArrivals } from '@/features/dock/model';
import { agoWords } from '@/lib/format';
import { short } from '@/lib/keys';
import { Wash } from '@/lib/motion';
import { statusTone, TONE } from '@/lib/tones';
import { effectsOf, identityLabel, planFold, planView, shippedWords, sourcesView } from './model';

/** The body rises in: 4 px and a fade, 180 ms ease-out; reduced motion keeps the fade. */
export const RISE = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
};

type Decide = ReturnType<typeof useDecideAction>;
type Mode = 'focus' | 'select';

export interface ChangeTreeProps {
  ctx: ChangeContext;
  lens: Lens;
  /** Wide opens the plan and the sections out; folded each is its head, opening in place. */
  wide: boolean;
  /** Where the tree is drawn: the session page, where the session is the subject, or where the change is. */
  where: 'session' | 'change';
  /** On the change's own page: the identity row carries the key to copy, not the way to the page. */
  page?: boolean;
  /** How the tree's links move: focus makes the key the page, select keeps the page and selects it. */
  mode: Mode;
  /** On the session page: the person views a change that is not the session's focus, and the session is live. */
  isViewing?: boolean;
  live?: boolean;
  /** A session is working the change now (change:alive-step-bars): the plan's active segment breathes. */
  working?: boolean;
  /** The chain above the change, nearest first: the path line names the top when the change has no parent. */
  under?: { key: string; name?: string; title?: string }[];
  /** The feature names the map knows, by key. */
  names?: Map<string, string>;
  arrivals?: ReturnType<typeof dockArrivals>;
  moment?: string;
  decide?: Decide;
  reopen?: Decide;
  actor?: string;
  held?: boolean;
  linked?: string;
  onLink: (key: string | undefined) => void;
  /** Drawn above the identity row: the change bar, where the change is the subject. */
  bar?: React.ReactNode;
  /** On a milestone: its children where a change has its plan (features/milestones), drawn by the caller. */
  milestoneSlot?: React.ReactNode;
  /** On a milestone: the decisions waiting beneath it, each a card naming its change. */
  waitingBeneath?: readonly WaitingDecision[];
}

const NO_WAITING: readonly WaitingDecision[] = [];

const NO_NAMES = new Map<string, string>();
const NO_UNDER: { key: string; name?: string; title?: string }[] = [];
const nameOf = (r: { key: string; name?: string; title?: string }) => r.name ?? r.title ?? short(r.key);

/** The tree: the identity row, the ladder (name, gist, what it needs), the path line, the aspects, then the plan or a
 *  milestone's children, the decisions, and where the change is the subject its sections. Keyed on the change by the
 *  caller, so it rises in whenever the change shown swaps. */
export function ChangeTree({
  ctx,
  lens,
  wide,
  where,
  page = false,
  mode,
  isViewing = false,
  live = false,
  working = false,
  under = NO_UNDER,
  names = NO_NAMES,
  arrivals,
  moment,
  decide,
  reopen,
  actor,
  held = false,
  linked,
  onLink,
  bar,
  milestoneSlot,
  waitingBeneath = NO_WAITING,
}: ChangeTreeProps) {
  const c = ctx.change;
  const milestone = ctx.children.length > 0;
  const beneath = waitingBeneath.filter((d) => d.change !== c.key).map(fromWaiting);
  const decisions = [...ctx.decisions.map((d) => fromRow(d, c.key)), ...beneath];
  const waiting = decisions.filter((d) => d.status === 'proposed').length;
  const decided = decisions.length - waiting;
  const kind = c.data.kind === 'bug' ? 'bug' : milestone ? 'milestone' : 'change';
  const onSession = where === 'session';
  const onNow = onSession && !isViewing && live;
  return (
    <m.div {...RISE} className={cn('flex flex-col', wide ? 'gap-6' : 'gap-3')}>
      {bar}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center gap-[7px] text-meta font-semibold tracking-[.04em]',
            onNow ? TONE.live.text : 'text-ink-faint',
          )}
        >
          {onNow && <Pulse className="size-[7px]" />}
          {onSession ? identityLabel(isViewing, kind) : kind}
        </span>
        {!onSession && <Severity data={c.data} />}
        <span className="ml-auto flex min-w-0 items-center gap-3">
          {!onSession && (
            <span className="inline-flex min-w-0 items-center gap-1 text-meta text-ink-faint">
              <KeyText className="truncate">{c.key}</KeyText>
              <CopyKey refKey={c.key} bare />
            </span>
          )}
          {!page && (
            <NodeLink
              to={c.key}
              lens={lens}
              mode="focus"
              className="inline-flex shrink-0 items-center gap-0.5 text-meta font-medium text-primary hover:underline"
            >
              Open the {kind} page
              <ChevronRight className="size-3" aria-hidden="true" />
            </NodeLink>
          )}
        </span>
      </div>
      <div className="relative flex flex-col gap-1.5">
        <Wash
          arrival={arrivals?.status?.seq}
          className={cn(statusTone(c.status).wash, '-inset-x-2 -inset-y-1 rounded-card')}
        />
        <h1 className="text-[18px] leading-[1.3] font-semibold tracking-tight">{c.name ?? c.gist ?? short(c.key)}</h1>
        {c.name && c.gist && c.gist !== c.name && <p className="text-body leading-normal text-ink-muted">{c.gist}</p>}
        <Readiness needs={ctx.needs} stale={ctx.stale} migrated={ctx.migrated} />
        <PathLine ctx={ctx} lens={lens} mode={mode} under={under} names={names} />
        {ctx.aspects && <AspectChips aspects={ctx.aspects} lens={lens} />}
      </div>

      <div className={cn('flex flex-col', wide ? 'max-w-[760px] gap-8' : 'gap-3')}>
        {milestone ? milestoneSlot : <PlanPart ctx={ctx} wide={wide} working={working} />}

        <section className="flex flex-col gap-2.5">
          <Head
            label={beneath.length ? 'Decisions beneath' : 'Decisions'}
            sum={decisions.length || onSession ? groupHead(waiting, decided, where) : 'none yet'}
          />
          {(onSession ? waiting > 0 : decisions.length > 0) && (
            <DecisionGroup
              decisions={decisions}
              lens={lens}
              where={where}
              actor={actor}
              wide={wide}
              linked={linked}
              onLink={onLink}
              onDecide={decide}
              onReopen={onSession ? undefined : reopen}
              opened={arrivals?.opened}
              moment={moment}
              held={held}
              showChange={beneath.length > 0}
            />
          )}
        </section>

        {!onSession && <SectionsPart sections={ctx.sections} wide={wide} />}
      </div>
    </m.div>
  );
}

/** A bug's severity, where on the tree the behaviour is lost; alarm when a product or a feature is out. */
function Severity({ data }: { data: ChangeContext['change']['data'] }) {
  if (data.kind !== 'bug' || typeof data.severity !== 'string') return null;
  const s = data.severity;
  return (
    <Chip
      tone="quiet"
      className={s === 'product' || s === 'feature' ? TONE.alarm.text : ''}
      title="severity: where on the tree the behaviour is lost"
    >
      {s === 'nuisance' || s === 'cosmetic' ? s : `${s} out`}
    </Chip>
  );
}

/** The path line: the status, what the change does to which features, where it sits, what it needs and what needs
 *  it, the release it shipped in, its branch. A separator travels with the word after it. */
function PathLine({
  ctx,
  lens,
  mode,
  under,
  names,
}: {
  ctx: ChangeContext;
  lens: Lens;
  mode: Mode;
  under: { key: string; name?: string; title?: string }[];
  names: Map<string, string>;
}) {
  const c = ctx.change;
  const top = under[0];
  const shipped = shippedWords(ctx);
  const release = ctx.releases?.at(-1);
  const link = (key: string, text: string) => (
    <NodeLink to={key} lens={lens} mode={mode} className="text-ink hover:text-primary">
      {text}
    </NodeLink>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted">
      <span className={cn('font-medium', statusTone(c.status).text)}>{c.status ?? 'open'}</span>
      {ctx.children.length > 0 && <Part>milestone · {ctx.children.length} children</Part>}
      {effectsOf(c.data.features).map((e) => (
        <Part key={e.key}>
          {e.effect} {link(e.key, names.get(e.key) ?? short(e.key))}
        </Part>
      ))}
      {ctx.parent && <Part>under {link(ctx.parent.key, nameOf(ctx.parent))}</Part>}
      {!ctx.parent && top && <Part>in {link(top.key, nameOf(top))}</Part>}
      {ctx.dependsOn.map((d) => (
        <Part key={d.key}>
          needs{' '}
          <NodeLink
            to={d.key}
            lens={lens}
            mode={mode}
            className={cn('hover:text-primary', d.status === 'done' ? TONE.done.text : 'text-ink')}
          >
            {nameOf(d)}
          </NodeLink>
        </Part>
      ))}
      {ctx.neededBy.map((d) => (
        <Part key={d.key}>needed by {link(d.key, nameOf(d))}</Part>
      ))}
      {shipped && release && (
        <Part>
          {shipped.replace(/v\S+$/, '')}
          {release.url ? (
            <a href={release.url} target="_blank" rel="noreferrer" className="text-ink hover:text-primary">
              v{release.version.replace(/^v/, '')}
            </a>
          ) : (
            link(release.key, `v${release.version.replace(/^v/, '')}`)
          )}
        </Part>
      )}
      {typeof c.data.target === 'string' && <Part>target {c.data.target}</Part>}
      {ctx.branch && (
        <Part>
          branch <KeyText className="text-ink-muted">{ctx.branch.name}</KeyText>
        </Part>
      )}
    </div>
  );
}

/** The plan: folded, its head and the active row, opening in place; wide, out, with what is behind the work folded to
 *  one line above it that opens in place. */
function PlanPart({ ctx, wide, working }: { ctx: ChangeContext; wide: boolean; working: boolean }) {
  const [open, setOpen] = useState(false);
  const plan = planView(ctx.plan);
  const fold = planFold(ctx.plan);
  const rows = wide ? (open ? ctx.plan : fold.shown) : open ? ctx.plan : plan.row ? [plan.row] : [];
  return (
    <section className="flex flex-col gap-2.5">
      <Head
        label="Plan"
        sum={plan.sum}
        open={wide ? undefined : open}
        onToggle={wide || !ctx.plan.length ? undefined : () => setOpen((v) => !v)}
      />
      {ctx.plan.length > 0 && <SegmentBar segments={plan.segments} label={`Plan: ${plan.sum}`} working={working} />}
      <div className="flex flex-col">
        {wide && fold.sum && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 py-1 pl-7 text-left text-xs text-ink-faint hover:text-ink"
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 transition-transform duration-200', open && 'rotate-90')}
              aria-hidden="true"
            />
            {open ? 'fold what is behind the work' : `${fold.sum} behind the work`}
          </button>
        )}
        {rows.map((s, i) => (
          <PlanRow key={`${i}-${s.text}`} step={s} on={s === plan.row && s.state !== 'done'} />
        ))}
      </div>
    </section>
  );
}

/** The sections in order of depth, as written: wide each out, folded each its head with its first line, opening in
 *  place. */
function SectionsPart({ sections, wide }: { sections: Record<string, string>; wide: boolean }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const entries = Object.entries(sections).filter(([, v]) => v.trim());
  if (!entries.length) return null;
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <div className={cn('flex flex-col', wide ? 'gap-8' : 'gap-1')}>
      {entries.map(([k, v]) => {
        const shown = wide || open.has(k);
        const first = v
          .trim()
          .split('\n')[0]!
          .replace(/^[-*>]\s*/, '');
        return (
          <section key={k} className="flex flex-col gap-2.5">
            <Head
              label={k}
              sum={wide ? undefined : first}
              open={wide ? undefined : shown}
              onToggle={wide ? undefined : () => toggle(k)}
            />
            {shown && (
              <p className="max-w-[720px] text-body leading-relaxed whitespace-pre-line text-ink">{v.trim()}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** One section head at every width: the label, a one-line summary, a chevron only when the section is folded. */
export function Head({
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
      <span className="shrink-0 text-[13.5px] font-semibold text-ink">{label}</span>
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

/** The bar: a segment a step or a child; done green, the one on in the lane's colour, dropped faint. While a session
 *  works the change the one on breathes in the live colour instead (change:alive-step-bars, decision the-motion). */
export function SegmentBar({
  segments,
  label,
  working = false,
}: {
  segments: readonly string[];
  label: string;
  working?: boolean;
}) {
  const cls = (s: string) => (working && (s === 'on' || s === 'active') ? 'working-segment' : segmentClass(s));
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={working ? `${label} · a session working now` : label}
    >
      {segments.map((s, i) => (
        <span key={i} className={cn('h-1 flex-1 rounded-sm transition-colors duration-200', cls(s))} />
      ))}
    </div>
  );
}

const segmentClass = (s: string) =>
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
 *  the panel; folded the head alone, opening in place. */
export function Sources({ ctx, lens, mode, wide }: { ctx: ChangeContext; lens: Lens; mode: Mode; wide: boolean }) {
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
function SourceLink({ s, lens, mode, mono }: { s: Source; lens: Lens; mode: Mode; mono?: boolean }) {
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
        <Label className="sr-only">Aspects</Label>
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
