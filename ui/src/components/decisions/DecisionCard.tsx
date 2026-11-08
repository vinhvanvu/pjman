// The decision card at three depths (decision detail-pages/decision-card): a row (the name, when it was proposed, how
// many options), the ladder (the two rungs, a meta line and the one action, Accept the recommendation, with a chevron
// to the thread), and the thread beneath the ladder in reading order: the question, the criteria, the options as a
// choice list with each one's case, the recommended one marked with its why, the rejected dimmed with the reason, the
// person's comments (one about an option beneath that option, the rest after the options), then the action row: Accept the chosen option, or pick another and accept it, with a line in
// the person's words. A decided decision is a row that reads its answer, the accepted option by its id and its one line,
// with who decided and when; its thread, opening read-only with Reopen as its only action, holds the name and the gist
// (decided decided-decisions-fold/fold-by-default). One component serves every surface that shows a decision.
import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import type { DecideAction, Lens, OptionState } from '@/data/contract';
import { short } from '@/lib/keys';
import { Wash } from '@/lib/motion';
import { TONE } from '@/lib/tones';
import { CopyKey } from '@/components/links/CopyKey';
import { NodeLink } from '@/components/links/NodeLink';
import { Readiness } from '@/components/record/Foundation';
import { pointsOf } from './Options';
import { DecideControl } from './DecideControl';
import { answerOf, type CardDecision, chosenOf, decidedMeta, type Depth, nameOf, proposedMeta } from './model';

/** The card's ground: the waits colour over the raised surface, a shade stronger when open. */
const CARD = 'bg-[color-mix(in_srgb,var(--status-review)_7%,var(--muted))]';
const ROW =
  'bg-[color-mix(in_srgb,var(--status-review)_5%,var(--muted))] hover:bg-[color-mix(in_srgb,var(--status-review)_10%,var(--muted))]';
const LINE = 'border-[color-mix(in_srgb,var(--status-review)_22%,var(--border))]';

/** The thread unfolds beneath the ladder and folds back; under reduced motion it fades. */
const UNFOLD = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { duration: 0.26, ease: 'easeOut' as const } },
  exit: { height: 0, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' as const } },
};

export interface DecisionCardProps {
  d: CardDecision;
  depth: Depth;
  lens: Lens;
  /** The person signed in, so their comments read as "you". */
  actor?: string;
  /** The option the person picked in the thread, when they did. */
  pick?: string;
  onPick?: (option: string) => void;
  /** The line in the person's words. */
  words?: string;
  onWords?: (words: string) => void;
  /** A row opens to the ladder; the chevron and the link toggle the thread. */
  onOpen?: () => void;
  onToggleThread?: () => void;
  onDecide?: DecideAction;
  onReopen?: DecideAction;
  /** The arrival that opened it on the stream: the card washes once. */
  arrival?: number;
  /** Name the change on the row, when the card stands away from it. */
  showChange?: boolean;
  className?: string;
}

export function DecisionCard(props: DecisionCardProps) {
  const { d, depth } = props;
  if (d.status !== 'proposed') return <DecidedRow {...props} />;
  if (depth === 'row') return <WaitingRow {...props} />;
  return <WaitingCard {...props} />;
}

/** The row: the name, when it was proposed, how many options; a tap opens the ladder. */
function WaitingRow({ d, onOpen, showChange, arrival, className }: DecisionCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${nameOf(d)}`}
      className={cn(
        'relative flex h-[38px] w-full items-center gap-2 overflow-hidden rounded-lg px-3.5 text-left text-body transition-colors',
        ROW,
        className,
      )}
    >
      <Wash arrival={arrival} className={TONE.waits.wash} />
      <span className="min-w-0 flex-1 truncate font-medium">{nameOf(d)}</span>
      {showChange && <span className="shrink-0 text-meta text-ink-faint">{short(d.change)}</span>}
      <span className="shrink-0 text-meta font-medium text-ink-faint">{proposedMeta(d)}</span>
      <ChevronDown className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
    </button>
  );
}

/** The ladder, and the thread beneath it when open. */
function WaitingCard({
  d,
  depth,
  lens,
  actor,
  pick,
  onPick,
  words,
  onWords,
  onToggleThread,
  onDecide,
  arrival,
  showChange,
  className,
}: DecisionCardProps) {
  const thread = depth === 'thread';
  const chosen = chosenOf(d.state, thread ? pick : undefined);
  const n = d.state.options.length;
  return (
    <div className={cn('relative flex flex-col gap-2 overflow-hidden rounded-lg px-3.5 py-3', CARD, className)}>
      <Wash arrival={arrival} className={TONE.waits.wash} />
      <div className={cn('flex items-center gap-1.5 text-meta font-semibold', TONE.waits.text)}>
        Waits on you
        <span className="min-w-0 truncate font-medium text-ink-faint">· {proposedMeta(d)}</span>
        {showChange && <span className="font-medium text-ink-faint">· {short(d.change)}</span>}
        <button
          type="button"
          onClick={onToggleThread}
          aria-expanded={thread}
          aria-label={thread ? 'Close the thread' : 'Open the thread'}
          className="ml-auto grid size-[22px] shrink-0 place-items-center rounded-row text-ink-faint hover:bg-raised hover:text-ink"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform duration-200', thread && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="text-[13.5px] font-semibold leading-[1.35]">{nameOf(d)}</div>
      {d.name && d.gist && <div className="text-body leading-normal text-ink-muted">{d.gist}</div>}
      <Readiness needs={d.needs} stale={d.stale} migrated={d.migrated} what="decision" />
      <AnimatePresence initial={false}>
        {thread && (
          <m.div key="thread" {...UNFOLD} className="overflow-hidden">
            <Thread
              d={d}
              actor={actor}
              chosen={chosen?.id}
              onPick={onPick}
              words={words}
              onWords={onWords}
              editable={!!onDecide}
            />
          </m.div>
        )}
      </AnimatePresence>
      <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
        {onDecide && chosen && (
          <DecideControl
            decision={d.key}
            size="button"
            onConfirm={() => onDecide(d.key, { option: chosen.id, words: thread ? words : undefined })}
          />
        )}
        {chosen ? (
          <span className="text-meta font-medium text-ink-faint">
            <span className="font-mono text-ink">{chosen.id}</span> · {chosen.note}
          </span>
        ) : (
          <span className="text-meta text-ink-faint">pick an option in the thread</span>
        )}
        <CopyKey refKey={d.key} />
        <button
          type="button"
          onClick={onToggleThread}
          className="ml-auto text-xs font-medium text-primary hover:underline"
        >
          {thread ? 'Close' : `${n} ${n === 1 ? 'option' : 'options'}`}
        </button>
        {!thread && (
          <NodeLink to={d.key} lens={lens} className="text-meta text-ink-faint hover:text-ink">
            on {short(d.change)} →
          </NodeLink>
        )}
      </div>
    </div>
  );
}

/** The thread in reading order. Editable, each option is a choice; read-only, the accepted one is marked. */
function Thread({
  d,
  actor,
  chosen,
  onPick,
  words,
  onWords,
  editable,
}: {
  d: CardDecision;
  actor?: string;
  chosen?: string;
  onPick?: (option: string) => void;
  words?: string;
  onWords?: (words: string) => void;
  editable: boolean;
}) {
  const s = d.state;
  const who = (by?: string) => (by && actor && by === actor ? 'you' : by ? short(by) : 'someone');
  const why = s.accepted?.text ?? s.recommendation?.text;
  // a comment about an option is drawn beneath it; one about none, or an option no longer in the thread, after them
  const general = s.comments.filter((c) => !c.option || !s.options.some((o) => o.id === c.option));
  return (
    <div className={cn('flex flex-col gap-3 border-t pt-3', LINE)}>
      {s.question && (
        <p className="text-body leading-normal">
          <span className="font-semibold">Question</span> · {s.question}
        </p>
      )}
      {s.criteria.length > 0 && (
        <div className="flex flex-col gap-1 text-xs leading-normal text-ink-muted">
          <span className="text-meta font-semibold text-ink-faint">Criteria</span>
          {s.criteria.map((c, i) => (
            <span key={i} className="flex gap-2">
              <span className="shrink-0 text-ink-faint">–</span>
              {c}
            </span>
          ))}
        </div>
      )}
      <ol className="flex flex-col gap-1.5">
        {s.options.map((o) => (
          <Option
            key={o.id}
            o={o}
            on={editable ? o.id === chosen : o.accepted}
            why={o.recommended || o.accepted ? why : undefined}
            comments={s.comments.filter((c) => c.option === o.id)}
            who={who}
            onPick={editable && onPick ? () => onPick(o.id) : undefined}
          />
        ))}
      </ol>
      {general.length > 0 && (
        <div className="flex flex-col gap-1.5 text-xs leading-normal">
          {general.map((c, i) => (
            <span key={i} className="flex gap-1.5">
              <span className="shrink-0 text-ink-faint">{who(c.by)} ·</span>
              <span>{c.text}</span>
            </span>
          ))}
        </div>
      )}
      {s.accepted && (
        <p className="text-xs leading-normal text-ink-muted">
          <span className="font-semibold text-ink">Accepted</span> {s.accepted.option} by {who(s.accepted.by)}
          {s.accepted.text && <> · {s.accepted.text}</>}
        </p>
      )}
      {editable && (
        <input
          type="text"
          value={words ?? ''}
          onChange={(e) => onWords?.(e.target.value)}
          placeholder="in your words, optional"
          aria-label="Your words at acceptance, optional"
          className="h-[30px] rounded-row border border-line-strong bg-surface px-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
        />
      )}
    </div>
  );
}

/** One option: a choice when the thread is editable, the accepted one marked otherwise; its case as lines, the why
 *  beneath the recommended one, the reason beneath a rejected one. */
type Comment = CardDecision['state']['comments'][number];

function Option({
  o,
  on,
  why,
  comments,
  who,
  onPick,
}: {
  o: OptionState;
  on: boolean;
  why?: string;
  /** The person's comments about this option, beneath its case. */
  comments: readonly Comment[];
  who: (by?: string) => string;
  onPick?: () => void;
}) {
  const rejected = o.rejected !== undefined;
  const Tag = onPick ? 'button' : 'div';
  return (
    <li>
      <Tag
        type={onPick ? 'button' : undefined}
        onClick={onPick}
        aria-pressed={onPick ? on : undefined}
        className={cn(
          'grid w-full grid-cols-[14px_minmax(0,1fr)] gap-x-2 rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors',
          on ? 'border-primary bg-selection' : o.recommended ? 'border-primary/50' : 'border-line-strong',
          rejected && 'opacity-55',
          onPick && 'hover:border-primary/70',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid size-3.5 place-items-center rounded-full border-[1.5px] transition-colors',
            on ? 'border-primary' : 'border-line-strong',
          )}
        >
          <span
            className={cn('size-1.5 rounded-full bg-primary transition-opacity', on ? 'opacity-100' : 'opacity-0')}
          />
        </span>
        <div className="min-w-0">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="rounded-[4px] border border-line-strong bg-raised px-1 font-mono text-[11px] leading-[17px] text-ink">
              {o.id}
            </span>
            {o.accepted && <span className={cn('label', TONE.done.text)}>accepted</span>}
            {!o.accepted && o.recommended && <span className={cn('label', TONE.waits.text)}>recommended</span>}
            {rejected && <span className="label">set aside</span>}
          </div>
          <div className="text-body leading-normal">{o.text}</div>
          {pointsOf(o.case).map((p, i) => (
            <div key={i} className="mt-1 border-l-2 border-line-strong pl-2 text-xs leading-normal text-ink-muted">
              {p}
            </div>
          ))}
          {why && (
            <div className="mt-1 border-l-2 border-line-strong pl-2 text-xs leading-normal text-ink-muted">
              Why: {why}
            </div>
          )}
          {rejected && o.rejected && (
            <div className="mt-1 border-l-2 border-line-strong pl-2 text-xs leading-normal text-ink-muted">
              {o.rejected}
            </div>
          )}
          {comments.map((c, i) => (
            <div key={i} className="mt-1.5 flex gap-1.5 text-xs leading-normal">
              <span className="shrink-0 text-ink-faint">{who(c.by)} ·</span>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      </Tag>
    </li>
  );
}

/** A decided decision: a row with a diamond, the answer (the accepted option's id and line; the name when the thread
 *  holds no accepted option), who and when; its thread opens read-only, the name and gist first, with Reopen. */
function DecidedRow({ d, depth, lens, actor, onToggleThread, onReopen, showChange, className }: DecisionCardProps) {
  const thread = depth === 'thread';
  const faint = d.status !== 'decided';
  const answer = answerOf(d);
  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        onClick={onToggleThread}
        aria-expanded={thread}
        className="flex min-h-[30px] w-full items-center gap-2 text-left text-body text-ink-muted hover:text-ink"
      >
        <span
          aria-hidden="true"
          className={cn('size-[9px] shrink-0 rotate-45 rounded-[2px]', faint ? 'bg-ink-faint' : TONE.done.bg)}
        />
        {answer ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {/* the id says which of several was taken; the only option needs no label */}
            {d.state.options.length > 1 && (
              <span className="shrink-0 rounded-[4px] border border-line-strong bg-raised px-1 font-mono text-[11px] leading-[17px] text-ink">
                {answer.id}
              </span>
            )}
            <span className="min-w-0 truncate">{answer.text}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{nameOf(d)}</span>
        )}
        {showChange && <span className="shrink-0 text-meta text-ink-faint">{short(d.change)}</span>}
        <span className="shrink-0 text-meta text-ink-faint">{decidedMeta(d)}</span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-ink-faint transition-transform duration-200', thread && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {thread && (
          <m.div key="thread" {...UNFOLD} className="overflow-hidden">
            <div className="flex flex-col gap-2.5 pb-2 pl-[17px]">
              {/* the row read the answer, so the thread opens on the name and the gist */}
              {answer && d.name && <p className="text-body leading-normal font-medium text-ink">{d.name}</p>}
              {d.gist && (answer || d.name) && <p className="text-body leading-normal text-ink-muted">{d.gist}</p>}
              <Thread d={d} actor={actor} editable={false} />
              <div className="flex items-center gap-2.5 text-meta text-ink-faint">
                <CopyKey refKey={d.key} />
                {d.supersededBy && <span>superseded by {short(d.supersededBy)}</span>}
                {d.status === 'decided' && onReopen && (
                  <DecideControl decision={d.key} onConfirm={() => onReopen(d.key)} reopen className="ml-auto" />
                )}
                <NodeLink to={d.key} lens={lens} className="hover:text-ink">
                  on {short(d.change)} →
                </NodeLink>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
