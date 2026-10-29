// The bridge's lanes (decision live-sessions/stage-strip-transport): one row per session over the transport's rolling
// window, on the transport's own layer so a beat here and a tick there stand at the same instant and slide together.
// Each line the session wrote is a beat, each decision it opened a flag, a bar runs from its first act to its last;
// beats and bar take the session's state colour, a flag its decision's status now: amber while it still waits on the
// person, green once decided (lib/tones).
// Held at a moment, a line marks it on every row and what came after is dimmed; a beat or a flag locks on its event,
// the row's name opens the session's dock. The stage will stand above them (change:roadmap-graph).
// Alive (change:motion-design): a row that arrives opens its space and fades in, one that leaves fades and then
// closes; under the pointer or focus the rows hold their order. The beat or flag a live event adds pops in and glows
// in that event's colour, as the transport's now marker does at the same moment.
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { AnimatePresence, m } from 'motion/react';
import { useRef } from 'react';
import type { BridgeSession, TimelineEvent } from '@/data/contract';
import { clock } from '@/features/moment';
import { EventTip, hourMarks, useEventTip, useRolling, WINDOW_MS } from '@/features/transport';
import { restOf, short } from '@/lib/keys';
import { Label } from '@/components/chips/Chip';
import { useHeldList, useHold } from '@/lib/hold';
import { Flash, MOVE } from '@/lib/motion';
import { useFresh } from '@/state/arrivals';
import { lanesOf, type Lane } from './model';
import { decisionTone, eventTone, SESSION, sessionDot } from '@/lib/tones';

/** The name column's width; the axis above the rows is offset by it. */
const WHO = 'w-[150px] shrink-0';
const FADE = { maskImage: 'linear-gradient(to right, transparent 0, black 6%)' };

export function Lanes({
  product,
  sessions,
  moment,
  className,
}: {
  product: string;
  sessions: readonly BridgeSession[];
  /** What the page reads as of: a new one redraws the rows at once, unanimated. */
  moment?: string;
  className?: string;
}) {
  const r = useRolling(product);
  const frame = useRef<HTMLElement>(null);
  const tips = useEventTip(frame);
  const fresh = useFresh();
  const hold = useHold();
  const { shown: lanes } = useHeldList(lanesOf(sessions, r.events), hold.held, laneKey);
  const held = r.mode !== 'live';
  // what had not happened yet at the held moment
  const after = (e: TimelineEvent) => held && (r.cursor.event ? e.seq > r.cursor.event : Date.parse(e.at) > r.heldAt);

  return (
    <section
      ref={frame}
      aria-label="Sessions over the day"
      className={cn(
        'relative flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 pt-3 pb-2.5',
        className,
      )}
    >
      <EventTip tip={tips.tip} now={r.now} />
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <Label>Recent sessions · last 12 hours</Label>
        <span className="text-meta text-ink-faint">
          each line a session wrote is a beat · a flag where it opened a decision
        </span>
      </div>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className={WHO} />
        <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden" style={FADE}>
          <div key={r.span.to} {...r.layer()}>
            {hourMarks(r.layerStart - WINDOW_MS, Date.parse(r.span.to)).map((t) => (
              <span
                key={t}
                className="absolute top-0 -translate-x-1/2 text-[10.5px] leading-none whitespace-nowrap text-ink-faint tabular-nums"
                style={{ left: `${r.at(t)}%` }}
              >
                {clock(new Date(t).toISOString(), r.now)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {lanes.length === 0 ? (
        <div className="py-2 text-xs text-ink-faint">No session wrote in the last 12 hours.</div>
      ) : (
        <ol key={moment} className="flex flex-col" {...hold.props}>
          <AnimatePresence initial={false}>
            {lanes.map((lane) => {
              const s = lane.session;
              const title = s.change ? (s.change.title ?? short(s.change.key)) : 'No change yet';
              return (
                <m.li
                  key={s.key}
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0, transition: { ...MOVE, delay: MOVE.duration } }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  className="flex h-7 items-center gap-3"
                >
                  <Link
                    to="/session/$id"
                    params={{ id: restOf(s.key) }}
                    search={{}}
                    title={title}
                    className={cn(WHO, 'flex min-w-0 items-center gap-2 text-xs font-medium hover:underline')}
                  >
                    <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', sessionDot(s.state))} />
                    <span className={cn('truncate', !s.change && 'text-ink-muted')}>{title}</span>
                  </Link>
                  <div className="relative h-4 min-w-0 flex-1 overflow-hidden border-b border-line" style={FADE}>
                    <div key={r.span.to} {...r.layer()}>
                      <span
                        aria-hidden="true"
                        className={cn('absolute top-1.5 h-1 rounded-full', SESSION[s.state].bg, 'opacity-35')}
                        style={{
                          left: `${r.at(Date.parse(lane.first))}%`,
                          width: `max(4px, ${r.at(Date.parse(lane.last)) - r.at(Date.parse(lane.first))}%)`,
                        }}
                      />
                      {lane.beats.map((e) => (
                        <Mark
                          key={e.seq}
                          e={e}
                          pct={r.at(Date.parse(e.at))}
                          dim={after(e)}
                          onLock={() => r.go({ event: e.seq })}
                          onTip={(el) => tips.show(e, el)}
                          onUntip={tips.hide}
                        >
                          <m.span
                            initial={fresh(e.seq) ? { scale: 2.2 } : false}
                            animate={{ scale: 1 }}
                            transition={{ duration: 0.6 }}
                            className={cn(
                              'absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                              e.seq === r.cursor.event ? 'size-2 bg-primary' : SESSION[s.state].bg,
                            )}
                          >
                            <Flash arrival={fresh(e.seq) ? e.seq : undefined} className={eventTone(e).text} />
                          </m.span>
                        </Mark>
                      ))}
                      {lane.flags.map((e) => (
                        <Mark
                          key={e.seq}
                          e={e}
                          pct={r.at(Date.parse(e.at))}
                          dim={after(e)}
                          onLock={() => r.go({ event: e.seq })}
                          onTip={(el) => tips.show(e, el)}
                          onUntip={tips.hide}
                          flag
                        >
                          <span
                            className={cn(
                              'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
                              e.seq === r.cursor.event ? 'bg-primary' : decisionTone(e.statusNow ?? e.status).bg,
                            )}
                          >
                            <Flash arrival={fresh(e.seq) ? e.seq : undefined} className={eventTone(e).text} />
                          </span>
                          <span
                            className={cn(
                              'absolute top-0 left-1/2 ml-px h-[7px] w-2',
                              e.seq === r.cursor.event ? 'bg-primary' : decisionTone(e.statusNow ?? e.status).bg,
                            )}
                            style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
                          />
                        </Mark>
                      ))}
                      {held && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
                          style={{ left: `${r.at(r.heldAt)}%` }}
                        />
                      )}
                    </div>
                  </div>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

const laneKey = (l: Lane) => l.session.key;

/** A beat or a flag: placed at its instant; the pointer on it shows its tip, a click locks on its event. */
function Mark({
  e,
  pct,
  dim,
  flag,
  onLock,
  onTip,
  onUntip,
  children,
}: {
  e: TimelineEvent;
  pct: number;
  dim: boolean;
  flag?: boolean;
  onLock: () => void;
  onTip: (el: Element) => void;
  onUntip: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={`Lock on event #${e.seq}`}
      className={cn('absolute top-0 h-full w-3 -translate-x-1/2', flag && 'z-[1]', dim && 'opacity-35')}
      style={{ left: `${pct}%` }}
      onPointerEnter={(ev) => onTip(ev.currentTarget)}
      onPointerLeave={onUntip}
      onClick={onLock}
    >
      {children}
    </button>
  );
}
