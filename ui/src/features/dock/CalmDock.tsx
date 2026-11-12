// The calm dock (change:dock-redesign, decision calm-dock): the session's change at docked width, read in the order a
// glance looks. The band first, edge to edge under the top bar, says where the change stands (done the one solid band);
// then the name and its gist; what waits on the person, as the decision cards always were; the plan's bar, the step in
// work with its note and the step after it; now; the sources out, links before files; a foot line with the branch and the
// way to the change page. What the dock no longer draws (the session bar, the chips of other changes, the identity row,
// the path line, the aspect chips, the timeline) is the change page's, a tap away. This forks the docked session tree from
// the wide one on purpose: the decision above is the reason (one-tree-two-variables still holds at desktop width).
import { cn } from 'cn';
import { AlertTriangle, Check, ChevronRight, FileText, Link2 } from 'lucide-react';
import { m } from 'motion/react';
import { useState } from 'react';
import { CopyKey } from '@/components/links/CopyKey';
import type { ChangeContext, Lens, RailRowKind, SessionFacts, WaitingDecision } from '@/data/contract';
import { type useDecideAction, useRail } from '@/data/queries';
import { KeyText } from '@/components/chips/Chip';
import { fromRow, fromWaiting } from '@/components/decisions/model';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { NodeLink } from '@/components/links/NodeLink';
import { Pulse } from '@/components/presence/Presence';
import { planView, RISE, SegmentBar, shippedWords } from '@/features/change';
import { ago, agoWords } from '@/lib/format';
import { short } from '@/lib/keys';
import { Wash } from '@/lib/motion';
import { statusTone } from '@/lib/tones';
import { stands, useNowAction } from '@/state/now';
import type { DockArrivals } from './model';
import {
  bandOf,
  type Band,
  type BandTone,
  planRead,
  shownSessionWords,
  sourcePlace,
  sourcesRead,
  writeWords,
} from './calm';

type Decide = ReturnType<typeof useDecideAction>;
type Source = ChangeContext['sources'][number];

/** Each tone's band: a tint of the status over the ground and a hairline beneath, or done's solid fill. Whole class
 *  names, so Tailwind reads them. */
const BAND: Record<BandTone, { ground: string; text: string; mark: string; dot: string }> = {
  live: {
    ground: 'bg-live/10 border-live/30',
    text: 'text-live',
    mark: 'bg-live/20 text-live',
    dot: 'bg-live',
  },
  waits: {
    ground: 'bg-status-review/10 border-status-review/30',
    text: 'text-status-review',
    mark: 'bg-status-review/20 text-status-review',
    dot: 'bg-status-review',
  },
  alarm: {
    ground: 'bg-status-blocked/10 border-status-blocked/30',
    text: 'text-status-blocked',
    mark: 'bg-status-blocked/20 text-status-blocked',
    dot: 'bg-status-blocked',
  },
  done: {
    ground: 'bg-status-done border-status-done',
    text: 'text-background',
    mark: 'bg-background/20 text-background',
    dot: 'bg-background',
  },
  active: {
    ground: 'bg-status-active/10 border-status-active/30',
    text: 'text-status-active',
    mark: 'bg-status-active/20 text-status-active',
    dot: 'bg-status-active',
  },
  planning: {
    ground: 'bg-status-planning/10 border-status-planning/30',
    text: 'text-status-planning',
    mark: 'bg-status-planning/20 text-status-planning',
    dot: 'bg-status-planning',
  },
  open: {
    ground: 'bg-raised border-line',
    text: 'text-ink',
    mark: 'bg-line text-ink-muted',
    dot: 'bg-ink-muted',
  },
  dropped: {
    ground: 'bg-raised border-line',
    text: 'text-ink-muted',
    mark: 'bg-line text-ink-faint',
    dot: 'bg-ink-faint',
  },
};

export interface CalmDockProps {
  ctx: ChangeContext;
  session: SessionFacts;
  lens: Lens;
  /** The person views a change that is not the session's focus: the banner naming where the session is. */
  banner?: React.ReactNode;
  /** A milestone's children, drawn where a change has its plan (decision milestone-detail/children-in-order). */
  milestoneSlot?: React.ReactNode;
  waitingBeneath?: readonly WaitingDecision[];
  /** The session works the shown change now (not a look at another one). */
  working: boolean;
  arrivals?: DockArrivals;
  moment?: string;
  decide?: Decide;
  actor?: string;
  held?: boolean;
  linked?: string;
  onLink: (key: string | undefined) => void;
  /** The way to the session's terminal, when a host holds it. */
  host?: { name: string; open: () => void; busy: boolean };
}

const NO_WAITING: readonly WaitingDecision[] = [];

export function CalmDock({
  ctx,
  session,
  lens,
  banner,
  milestoneSlot,
  waitingBeneath = NO_WAITING,
  working,
  arrivals,
  moment,
  decide,
  actor,
  held = false,
  linked,
  onLink,
  host,
}: CalmDockProps) {
  const c = ctx.change;
  const now = <Now change={c.key} plan={ctx.plan} session={session} working={working} moment={moment} />;
  const milestone = c.data.kind === 'milestone';
  const beneath = waitingBeneath.filter((d) => d.change !== c.key).map(fromWaiting);
  const decisions = [...ctx.decisions.map((d) => fromRow(d, c.key)), ...beneath];
  const waiting = decisions.filter((d) => d.status === 'proposed').length;
  const band = bandOf({
    status: c.status,
    waiting,
    working,
    started: session.started,
    last: session.last,
    shipped: shippedWords(ctx),
    blockedOn: ctx.sections['Blocked on'],
  });
  const kind = c.data.kind === 'bug' ? 'bug' : milestone ? 'milestone' : 'change';
  const shown = shownSessionWords(session.started, session.prompted);
  return (
    <m.div {...RISE} className="flex flex-col gap-8 px-5 pb-5">
      <section aria-label="Where the change stands" className="flex flex-col gap-[22px]">
        <StateBand band={band} arrival={arrivals?.status?.seq} statusWash={statusTone(c.status).wash} />
        {banner}
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[20px] leading-[1.3] font-semibold tracking-tight">{c.name ?? c.gist ?? short(c.key)}</h1>
          {c.name && c.gist && c.gist !== c.name && (
            <p className="text-[13.5px] leading-normal text-ink-muted">{c.gist}</p>
          )}
          {/* the change's id, copied as a prompt or a command names it (change:dock-now-lines) */}
          <CopyKey refKey={`change:${short(c.key)}`} className="self-start" />
          {/* which session the pane shows: a cmux workspace's sessions share one (decision pjman-24/name-the-shown-session) */}
          {shown && <p className="text-xs text-ink-faint">{shown}</p>}
        </div>
      </section>

      {waiting > 0 && (
        <section aria-label="Decisions waiting on you">
          <DecisionGroup
            decisions={decisions}
            lens={lens}
            where="session"
            actor={actor}
            linked={linked}
            onLink={onLink}
            onDecide={decide}
            opened={arrivals?.opened}
            moment={moment}
            held={held}
            showChange={beneath.length > 0}
          />
        </section>
      )}

      {milestone ? (
        <div className="flex flex-col gap-3">
          {milestoneSlot}
          {now}
        </div>
      ) : (
        <Plan ctx={ctx} working={working} now={now} />
      )}

      <Sources sources={ctx.sources} lens={lens} />

      <footer className="flex items-center gap-2 border-t border-line pt-3.5 text-xs text-ink-faint">
        {ctx.branch && (
          <span className="flex min-w-0 items-center gap-1.5">
            branch <KeyText className="truncate text-ink-muted">{ctx.branch.name}</KeyText>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {host && (
            <button
              type="button"
              onClick={host.open}
              disabled={host.busy}
              className="font-medium text-ink-muted hover:text-ink disabled:opacity-60"
              aria-label={`Open the session's terminal in ${host.name}`}
            >
              Open in {host.name}
            </button>
          )}
          <NodeLink
            to={c.key}
            lens={lens}
            mode="focus"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Open the {kind}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </NodeLink>
        </span>
      </footer>
    </m.div>
  );
}

/** The band: edge to edge under the top bar, its mark on the column's edge, the word in the status's colour and the
 *  aside at the right. A write to the status washes it. */
function StateBand({ band, arrival, statusWash }: { band: Band; arrival?: number; statusWash: string }) {
  const t = BAND[band.tone];
  return (
    <div role="status" className={cn('relative -mx-5 flex items-center gap-2.5 border-b px-5 py-[13px]', t.ground)}>
      <Wash arrival={arrival} className={cn(statusWash, 'inset-0')} />
      <Mark band={band} className={t.mark} />
      <span className={cn('relative text-[15px] font-semibold tracking-[-0.005em]', t.text)}>{band.word}</span>
      {band.aside && (
        <span
          className={cn(
            'relative ml-auto min-w-0 truncate text-right text-[12.5px]',
            band.solid ? 'text-background/85' : 'text-ink-muted',
          )}
          title={band.aside}
        >
          {band.aside}
        </span>
      )}
    </div>
  );
}

function Mark({ band, className }: { band: Band; className: string }) {
  if (band.mark === 'pulse')
    return (
      <span className="relative grid size-[22px] shrink-0 place-items-center">
        <Pulse />
      </span>
    );
  if (band.mark === 'dot')
    return (
      <span className="relative grid size-[22px] shrink-0 place-items-center" aria-hidden="true">
        <span className={cn('size-2 rounded-full', BAND[band.tone].dot)} />
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={cn('relative grid size-[22px] shrink-0 place-items-center rounded-full', className)}
    >
      {band.mark === 'check' ? (
        <Check className="size-3.5" strokeWidth={2.6} />
      ) : band.mark === 'alert' ? (
        <AlertTriangle className="size-3" strokeWidth={2.2} />
      ) : (
        <span className="text-[13px] leading-none font-bold">!</span>
      )}
    </span>
  );
}

/** One quiet label and a figure at the right: the head every section of the calm dock wears. */
function Head({ label, figure }: { label: string; figure?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-semibold tracking-[.07em] text-ink-faint uppercase">{label}</span>
      {figure && <span className="ml-auto text-xs text-ink-muted">{figure}</span>}
    </div>
  );
}

/** How recent a tool call keeps the line working when the store has heard nothing. */
const BUSY_MS = 2 * 60_000;

/** The newest write to the change, as the rail reads it; the live stream refetches it as writes land. */
const LATEST = { limit: 1, kinds: ['write', 'decision', 'file'] as RailRowKind[] };

/** Now (decision calm-dock): two lines, each the latest only and replaced in place. The agent's: a spinner while the
 *  session works, a grey dot and when it stopped at rest; while it works, its latest tool call in words (decision agent-signal). pjman's:
 *  the newest write to the change behind a diamond, washed when a new one lands. */
function Now({
  change,
  plan,
  session,
  working,
  moment,
}: {
  change: string;
  plan: ChangeContext['plan'];
  session: SessionFacts;
  working: boolean;
  moment?: string;
}) {
  const rail = useRail(change, LATEST);
  const row = rail.data?.rows.at(-1);
  // the first row read is where the page came in; only a newer one is an arrival, and never while a moment is held
  const [first, setFirst] = useState<number>();
  if (row && first === undefined) setFirst(row.seq);
  const arrived = !moment && row && first !== undefined && row.seq !== first ? row.seq : undefined;
  const words = row && writeWords(row, plan);
  const ended = session.state === 'ended';
  // the agent's latest action (decision agent-signal): a tool call is proof of work even when nothing reached the
  // store, so a fresh one keeps the spinner on while the session reads, searches or runs tests; held moments show none
  const action = useNowAction(session.key);
  const busy = !moment && !ended && (working || (!!action && stands(action, BUSY_MS)));
  return (
    <div
      aria-label="Now"
      aria-live="polite"
      className="flex flex-col rounded-lg border border-line bg-surface px-3 py-0.5 text-[12.5px]"
    >
      <div className="grid min-h-[32px] grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2">
        {busy ? (
          <span
            aria-hidden="true"
            className="size-2.5 animate-spin rounded-full border-[1.5px] border-live/30 border-t-live motion-reduce:animate-none"
          />
        ) : (
          <span aria-hidden="true" className="ml-px size-2 rounded-full bg-line-strong" />
        )}
        <span className="truncate text-ink-muted" title={busy ? action?.text : undefined}>
          {busy ? (action?.text ?? 'Working') : ended ? 'The session ended' : 'Stopped'}
        </span>
        <span className="text-[11px] text-ink-faint">
          {busy ? (action ? ago(action.at) : 'now') : ago(session.last)}
        </span>
      </div>
      {row && words && (
        <div className="relative grid min-h-[32px] grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 border-t border-line">
          <Wash arrival={arrived} className="-inset-x-3 rounded-none bg-primary/15" />
          <span aria-hidden="true" className="relative ml-0.5 size-2 rotate-45 rounded-[2px] bg-primary" />
          <span
            className="relative truncate text-ink-muted"
            title={[words.verb, words.object].filter(Boolean).join(' ')}
          >
            {words.verb}
            {words.object && <span className="font-medium text-ink"> {words.object}</span>}
          </span>
          <span className="relative text-[11px] text-ink-faint">{ago(row.at)}</span>
        </div>
      )}
    </div>
  );
}

/** The step's note, three lines at a glance; a tap opens the rest in place and folds it again. */
function StepNote({ note, at }: { note: string; at?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={cn(
        'mt-1 block w-full text-left text-[12.5px] leading-normal text-ink-muted hover:text-ink',
        !open && 'line-clamp-3',
      )}
    >
      {note}
      {at && <span className="text-ink-faint"> · {agoWords(at)}</span>}
    </button>
  );
}

/** The plan: its bar, the step in work with its note, now beneath it, and the step after it in one faint line. */
function Plan({ ctx, working, now }: { ctx: ChangeContext; working: boolean; now?: React.ReactNode }) {
  const read = planRead(ctx.plan);
  const bar = planView(ctx.plan);
  return (
    <section aria-label="Plan" className="flex flex-col gap-3">
      <Head label="Plan" figure={read.sum} />
      {ctx.plan.length > 0 && (
        <SegmentBar segments={bar.segments} label={`Plan: ${read.sum}`} working={working} thick />
      )}
      {read.step && (
        <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5">
          <span
            aria-hidden="true"
            className="mt-[3px] size-3.5 rounded-full border-[1.5px] border-[var(--lane)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--lane)_22%,transparent)]"
          />
          <div className="min-w-0">
            <div className="text-[14px] leading-[1.45] font-medium">{read.step.text}</div>
            {read.step.note && <StepNote note={read.step.note} at={read.step.at} />}
          </div>
        </div>
      )}
      {now && <div className={read.step ? 'pl-7' : undefined}>{now}</div>}
      {read.next && (
        <div className="pl-7 text-[12.5px] text-ink-faint">
          Next · <span className="font-medium text-ink-muted">{read.next.text}</span>
        </div>
      )}
    </section>
  );
}

/** The sources, out: links first then files, a few rows and the rest behind a count that opens in place. */
function Sources({ sources, lens }: { sources: ChangeContext['sources']; lens: Lens }) {
  const [all, setAll] = useState(false);
  const read = sourcesRead(sources);
  const rows = all ? [...read.shown, ...read.rest] : read.shown;
  return (
    <section aria-label="Sources" className="flex flex-col gap-3">
      <Head label="Sources" figure={read.sum} />
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((s) => (
            <SourceRow key={s.key} s={s} lens={lens} />
          ))}
        </ul>
      )}
      {read.rest.length > 0 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="self-start pl-[26px] text-xs text-ink-muted hover:text-ink"
        >
          {all ? 'Show fewer' : `${read.rest.length} more`}
        </button>
      )}
    </section>
  );
}

function SourceRow({ s, lens }: { s: Source; lens: Lens }) {
  const file = s.key.startsWith('file:');
  const text = file ? s.key.slice(5) : (s.record?.title ?? short(s.key));
  const Icon = file ? FileText : Link2;
  const cls = cn('min-w-0 truncate text-primary hover:underline', file ? 'font-mono text-xs' : 'text-body');
  return (
    <li className="grid min-h-[34px] grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5">
      <Icon className="size-3.5 text-ink-faint" aria-hidden="true" />
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className={cls} title={`Opens ${s.url}`}>
          {text}
        </a>
      ) : (
        <NodeLink to={s.key} lens={lens} mode="select" className={cls} title={text}>
          {text}
        </NodeLink>
      )}
      {!file && <span className="text-meta text-ink-faint">{sourcePlace(s)}</span>}
    </li>
  );
}
