// The bridge's lanes (decision live-sessions/stage-strip-transport): one row per session over the transport's rolling
// window, on the transport's own layer so a beat here and a tick there stand at the same instant and slide together.
// Each line the session wrote is a beat, each decision it opened a flag, a bar runs from its first act to its last;
// beats and bar take the session's state colour, the flag the colour of what waits on the person (lib/tones).
// Held at a moment, a line marks it on every row and what came after is dimmed; a beat or a flag locks on its event,
// the row's name opens the session's dock. The stage will stand above them (change:roadmap-graph).
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import type { BridgeSession, TimelineEvent } from '@/data/contract';
import { clock } from '@/features/moment';
import { eventWords, hourMarks, useRolling, WINDOW_MS } from '@/features/transport';
import { restOf, short } from '@/lib/keys';
import { Label } from '@/components/chips/Chip';
import { lanesOf } from './model';
import { SESSION, sessionDot, TONE } from '@/lib/tones';

/** The name column's width; the axis above the rows is offset by it. */
const WHO = 'w-[150px] shrink-0';
const FADE = { maskImage: 'linear-gradient(to right, transparent 0, black 6%)' };

export function Lanes({
  product,
  sessions,
  className,
}: {
  product: string;
  sessions: readonly BridgeSession[];
  className?: string;
}) {
  const r = useRolling(product);
  const lanes = lanesOf(sessions, r.events);
  const held = r.mode !== 'live';
  // what had not happened yet at the held moment
  const after = (e: TimelineEvent) => held && (r.cursor.event ? e.seq > r.cursor.event : Date.parse(e.at) > r.heldAt);

  return (
    <section
      aria-label="Sessions over the day"
      className={cn('flex flex-col gap-1.5 rounded-card border border-line bg-surface px-4 pt-3 pb-2.5', className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <Label>Sessions · last 12 hours</Label>
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
        <ol className="flex flex-col">
          {lanes.map((lane) => {
            const s = lane.session;
            const title = s.change ? (s.change.title ?? short(s.change.key)) : 'No change yet';
            return (
              <li key={s.key} className="flex h-7 items-center gap-3">
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
                        now={r.now}
                        dim={after(e)}
                        onLock={() => r.go({ event: e.seq })}
                      >
                        <span
                          className={cn(
                            'absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                            e.seq === r.cursor.event ? 'size-2 bg-primary' : SESSION[s.state].bg,
                          )}
                        />
                      </Mark>
                    ))}
                    {lane.flags.map((e) => (
                      <Mark
                        key={e.seq}
                        e={e}
                        pct={r.at(Date.parse(e.at))}
                        now={r.now}
                        dim={after(e)}
                        onLock={() => r.go({ event: e.seq })}
                        flag
                      >
                        <span
                          className={cn(
                            'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2',
                            e.seq === r.cursor.event ? 'bg-primary' : TONE.waits.bg,
                          )}
                        />
                        <span
                          className={cn(
                            'absolute top-0 left-1/2 ml-px h-[7px] w-2',
                            e.seq === r.cursor.event ? 'bg-primary' : TONE.waits.bg,
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
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A beat or a flag: placed at its instant, a click locks on its event. */
function Mark({
  e,
  pct,
  now,
  dim,
  flag,
  onLock,
  children,
}: {
  e: TimelineEvent;
  pct: number;
  now: number;
  dim: boolean;
  flag?: boolean;
  onLock: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={`#${e.seq} · ${clock(e.at, now)} · ${eventWords(e)}`}
      aria-label={`Lock on event #${e.seq}`}
      className={cn('absolute top-0 h-full w-2.5 -translate-x-1/2', flag && 'z-[1]', dim && 'opacity-35')}
      style={{ left: `${pct}%` }}
      onClick={onLock}
    >
      {children}
    </button>
  );
}
