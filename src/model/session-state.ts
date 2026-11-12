// A session's state, read one way everywhere it is shown (change:alive-step-bars): the bridge's rows, a scope's live
// sessions and the session page all derive it from the same facts, so a bar that moves for a working session moves
// by the rule the session dot uses. The facts are what the store already holds: the session's log lines (the hook
// writes one at every stop and a closing one at the end), the writes stamped with the session, and whether a
// decision is proposed on its change. Nothing is stored.
import { streamMemo, type StoreEvent } from '../store/events.js';
import type { HostStatus } from '../hosts/host.js';
import type { Rec } from '../store/records.js';

/** A session is live while something it did reached the stream inside this window. */
export const LIVE_MINUTES = 30;

export type SessionState = 'working' | 'waiting' | 'stopped' | 'ended';

/** Where a session runs, as the views read it off the record (change:rex-adapter): the host's name and version, and
 *  whether the adapter validated that version. */
export interface SessionHostFacts {
  name: string;
  version?: string;
  validated?: boolean;
  /** What the host says the program is doing, when the server follows it. */
  status?: { state: HostStatus['state']; kind?: HostStatus['kind']; at: string };
}

/** The host facts of a session record, with the host's word when the server has it; absent when the session runs in
 *  no host. */
export function hostFactsOf(data: Record<string, unknown>, status?: HostStatus): SessionHostFacts | undefined {
  const h = data.host;
  if (!h || typeof h !== 'object' || typeof (h as { name?: unknown }).name !== 'string') return undefined;
  const r = h as { name: string; version?: unknown; validated?: unknown };
  const facts: SessionHostFacts = { name: r.name };
  if (typeof r.version === 'string') facts.version = r.version;
  if (typeof r.validated === 'boolean') facts.validated = r.validated;
  if (status) facts.status = { state: status.state, kind: status.kind, at: status.at };
  return facts;
}

/** The facts a state is read from. */
export interface StateFacts {
  /** The session wrote its closing line. */
  ended: boolean;
  /** When its last line was written. */
  line?: string;
  /** The last write stamped with it that is not a line of its own. */
  act?: string;
  /** A decision on its change is proposed. */
  proposed: boolean;
  /** What the host says the program is doing, when a host holds the session and the server follows it
   *  (change:rex-adapter): first-hand, so it decides over the silence window. */
  host?: HostStatus;
}

/** A session's state. Ended once it wrote its closing line. Working while something it did reached the stream inside
 *  the live window and its last act was not a stop line: the hook writes a line at every stop, so a session whose
 *  latest act is its own line is stopped, waiting on the person's next prompt. A stopped session with a decision
 *  proposed on its change is waiting; otherwise it is stopped. A session that went quiet mid-turn (nothing for the
 *  live window, no stop line) reads as stopped too. */
export function sessionState(f: StateFacts, now = Date.now(), liveMinutes = LIVE_MINUTES): SessionState {
  if (f.ended) return 'ended';
  // the host's word is first-hand: blocked is waiting on the person (a question, a permission, a login), working is
  // working, and a program at rest (idle, done, failed) waits only when a decision is proposed on its change
  if (f.host) {
    if (f.host.state === 'blocked') return 'waiting';
    if (f.host.state === 'working') return 'working';
    return f.proposed ? 'waiting' : 'stopped';
  }
  const last = [f.line, f.act]
    .filter((x): x is string => !!x)
    .toSorted()
    .at(-1);
  const liveSince = new Date(now - liveMinutes * 60_000).toISOString();
  const stopped = !!f.line && (!f.act || f.act <= f.line);
  if (!stopped && last && last >= liveSince) return 'working';
  return f.proposed ? 'waiting' : 'stopped';
}

const LOG_LINE = /^-\s*(\S+)\s+—\s+(.*)$/;
const CLOSING = /^session ended(?:\s*\((.*)\))?$/;

export interface LogLine {
  at: string;
  text: string;
}

/** A session's log read for its state: every line, the closing one when it has ended (with the reason the line
 *  gives), and the last line before any closing one. */
export interface SessionLog {
  log: LogLine[];
  closing?: LogLine;
  ended?: { at: string; reason: string };
  line?: LogLine;
}

/** Read once per record: a loaded record does not change (change:dashboard-reads-slow). */
const logs = new WeakMap<Rec, SessionLog>();

export function sessionLogOf(rec: Rec): SessionLog {
  let read = logs.get(rec);
  if (!read) logs.set(rec, (read = sessionLogOnce(rec)));
  return read;
}

function sessionLogOnce(rec: Rec): SessionLog {
  const log = (rec.sections.get('Log') ?? '')
    .split('\n')
    .map((l) => LOG_LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ at: m[1], text: m[2] }));
  const tail = log.at(-1);
  const closing = tail && CLOSING.test(tail.text) ? tail : undefined;
  const ended = closing ? { at: closing.at, reason: CLOSING.exec(closing.text)![1] ?? 'other' } : undefined;
  return { log, closing, ended, line: closing ? log.at(-2) : tail };
}

/** The last act of each session from the stream: a write stamped with it, its own log lines excluded (the line's own
 *  instant is read from the log, so a stop reads as a stop and not as an act after it). */
export function lastActs(events: readonly StoreEvent[], until?: number): Map<string, string> {
  return until === undefined
    ? streamMemo(events, 'last-acts', () => lastActsOnce(events))
    : lastActsOnce(events, until);
}

function lastActsOnce(events: Iterable<StoreEvent>, until?: number): Map<string, string> {
  const acts = new Map<string, string>();
  for (const e of events) {
    if (until !== undefined && e.seq > until) break;
    const s = e.session ?? (e.type === 'session' ? e.key : undefined);
    if (!s) continue;
    if (e.op === 'log' && e.key === s) continue;
    if (!acts.has(s) || e.at > acts.get(s)!) acts.set(s, e.at);
  }
  return acts;
}
