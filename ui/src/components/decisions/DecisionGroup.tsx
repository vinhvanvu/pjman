// A change's decisions as a group (decision detail-pages/decision-card): the proposed first and oldest first, one open
// as the ladder and the rest rows under a waits-on-you head with the count; the decided as rows whose thread opens
// read-only; the superseded and reverted folded under one history line. Opening is in place: the card's height eases
// open, the cards beneath move down, nothing else changes; several may be open on a wide page, one at a time docked.
// The open decision is in the URL, so a link to a decision lands on it open. Deciding from an open card collapses it
// into a decided row that leaves the waiting group at once: it holds, washed done green, then fades where it stands
// (decision space-follows-the-element), and only then gives up its space. A decision that arrives slides in; one
// opened on the stream washes in waits amber.
import { cn } from 'cn';
import { AnimatePresence, m } from 'motion/react';
import { useState } from 'react';
import type { DecideAction, Lens, StoreEvent } from '@/data/contract';
import { useHeldList } from '@/lib/hold';
import { liveItem } from '@/lib/motion';
import { TONE } from '@/lib/tones';
import { DecisionCard } from './DecisionCard';
import { type CardDecision, grouped, openByDefault } from './model';

/** A decided card holds, washed done green, then fades where it stands; its children take the label, so the wash
 *  shows. */
const DECIDED = {
  decided: { opacity: [1, 1, 0], scale: [1, 1, 0.97], transition: { duration: 0.9, times: [0, 0.6, 1] } },
};
const DECIDED_MARK = { decided: { opacity: 1, transition: { duration: 0.15 } } };

const keyOf = (d: CardDecision) => d.key;

export interface DecisionGroupProps {
  decisions: readonly CardDecision[];
  lens: Lens;
  /** On the session page only what waits is drawn; on a change the decided follow as rows. */
  where: 'session' | 'change';
  /** The person signed in, so their comments read as "you". */
  actor?: string;
  /** Several cards open at once wide; one at a time docked. */
  wide?: boolean;
  /** The decision the URL opens, and how to set it. */
  linked?: string;
  onLink?: (key: string | undefined) => void;
  onDecide?: DecideAction;
  onReopen?: DecideAction;
  /** The decisions the live stream just opened, by key: each washes once. */
  opened?: ReadonlyMap<string, StoreEvent>;
  /** The moment the list is read at: a new one swaps the rows without motion. */
  moment?: string;
  /** Held still (lib/hold): the waiting list keeps its places, a new one waits until the release. */
  held?: boolean;
  /** After a decision on the group was decided and has left. */
  onDecided?: (key: string) => void;
  /** Name the change on each card, when the group stands away from one change. */
  showChange?: boolean;
  className?: string;
}

export function DecisionGroup({
  decisions,
  lens,
  where,
  actor,
  wide = false,
  linked,
  onLink,
  onDecide,
  onReopen,
  opened,
  moment,
  held = false,
  onDecided,
  showChange = false,
  className,
}: DecisionGroupProps) {
  const { waiting: live, decided, history } = grouped(decisions);
  const { shown: waiting, letGo } = useHeldList(live, held, keyOf);
  // open: the cards drawn as the ladder; thread: the ones unfolded; a link opens its decision to the thread
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = openByDefault(live, linked);
    return new Set(first ? [first] : []);
  });
  const [thread, setThread] = useState<Set<string>>(() => new Set(linked ? [linked] : []));
  const [seen, setSeen] = useState(linked);
  if (linked !== seen) {
    setSeen(linked);
    if (linked) {
      setOpen((prev) => (wide ? new Set(prev).add(linked) : new Set([linked])));
      setThread((prev) => new Set(prev).add(linked));
    }
  }
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [words, setWords] = useState<Record<string, string>>({});
  const [histOpen, setHistOpen] = useState(false);

  const openCard = (key: string) => {
    setOpen((prev) => (wide ? new Set(prev).add(key) : new Set([key])));
    setThread((prev) => new Set(prev).add(key));
    onLink?.(key);
  };
  const toggleThread = (key: string) => {
    const was = thread.has(key);
    setThread((prev) => {
      const next = new Set(prev);
      if (was) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!was) {
      setOpen((prev) => (wide ? new Set(prev).add(key) : new Set([key])));
      onLink?.(key);
    } else {
      setPicks((p) => ({ ...p, [key]: '' }));
      if (linked === key) onLink?.(undefined);
    }
  };
  const decide: DecideAction | undefined =
    onDecide &&
    ((key, opts) =>
      onDecide(key, opts).then((r) => {
        letGo(key);
        onDecided?.(key);
        return r;
      }));

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <ol className="flex flex-col empty:hidden">
        <AnimatePresence key={moment ?? 'now'} initial={false}>
          {waiting.map((d) => {
            const depth = thread.has(d.key) ? 'thread' : open.has(d.key) ? 'ladder' : 'row';
            return (
              <m.li key={d.key} {...liveItem} exit="decided" variants={DECIDED} className="relative pb-1.5 last:pb-0">
                {/* rests hidden by its own style: AnimatePresence's initial={false} skips an initial, so a list
                    mounted with its rows already there showed every row decided (change:dock-waits-turn-green) */}
                <m.span
                  aria-hidden="true"
                  style={{ opacity: 0 }}
                  variants={DECIDED_MARK}
                  className={cn('pointer-events-none absolute inset-0 z-10 rounded-lg', TONE.done.wash)}
                />
                <DecisionCard
                  d={d}
                  depth={depth}
                  lens={lens}
                  actor={actor}
                  pick={picks[d.key] || undefined}
                  onPick={(o) => setPicks((p) => ({ ...p, [d.key]: o }))}
                  words={words[d.key]}
                  onWords={(w) => setWords((p) => ({ ...p, [d.key]: w }))}
                  onOpen={() => openCard(d.key)}
                  onToggleThread={() => toggleThread(d.key)}
                  onDecide={decide}
                  arrival={opened?.get(d.key)?.seq}
                  showChange={showChange}
                />
              </m.li>
            );
          })}
        </AnimatePresence>
      </ol>
      {where === 'change' && decided.length > 0 && (
        <ol className="flex flex-col">
          {decided.map((d) => (
            <li key={d.key}>
              <DecisionCard
                d={d}
                depth={thread.has(d.key) ? 'thread' : 'row'}
                lens={lens}
                actor={actor}
                onToggleThread={() => toggleThread(d.key)}
                onReopen={onReopen}
                showChange={showChange}
              />
            </li>
          ))}
        </ol>
      )}
      {where === 'change' && history.length > 0 && (
        <div className="flex flex-col pl-[17px]">
          <button
            type="button"
            onClick={() => setHistOpen((v) => !v)}
            aria-expanded={histOpen}
            className="self-start text-xs text-ink-faint hover:text-ink"
          >
            {history.length} {history.length === 1 ? 'decision' : 'decisions'} superseded or reverted
            {histOpen ? '' : ' …'}
          </button>
          {histOpen &&
            history.map((d) => (
              <DecisionCard
                key={d.key}
                d={d}
                depth={thread.has(d.key) ? 'thread' : 'row'}
                lens={lens}
                actor={actor}
                onToggleThread={() => toggleThread(d.key)}
                showChange={showChange}
              />
            ))}
        </div>
      )}
    </div>
  );
}
