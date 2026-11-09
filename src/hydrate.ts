// Hydration: what the store has for a session since it was last briefed. The mirror of the receipt: the receipt is what
// the store received from a session since a point, the brief is what the store has for it since a point. Deterministic,
// so an adapter can hand it to the agent on every prompt and show the person its size.
//
// Two signals about a session (decision hydration/binding-follows-writes). Binding is what the session is credited with
// working on (`changes`, the last one bound); it drives the brief. Focus is what it is looking at: the change whose
// context it last read, or the change it last wrote; the dock follows it.
import type { Store } from './config.js';
import { eventsBySession, follow, readEvents, streamMemo, type StoreEvent } from './events.js';
import { eventKeysOf, findSession, loadStore, type Loaded, type Rec } from './records.js';
import { receiptLines } from './receipt.js';
import { LIVE_MINUTES } from './scope.js';
import { changeContext, formatChangeContext } from './commands/view.js';
import { sessionBriefed } from './commands/session.js';
import { notesOf } from './commands/note.js';
import { effectsOf, live } from './tree.js';
import { CliError, notFound } from './util.js';

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The change a decision sits on, from its key (decision:<product>/<change>/<slug>), through aliases. */
function changeOfDecision(loaded: Loaded, key: string): Rec | undefined {
  const m = /^decision:(.+)\/[^/]+$/.exec(key);
  return m ? live(loaded, `change:${m[1]}`) : undefined;
}

/** The change an event is about: a change, or the change a decision sits on. */
function changeOfEvent(loaded: Loaded, e: StoreEvent): Rec | undefined {
  if (e.type === 'change') return live(loaded, e.key);
  if (e.type === 'decision') return changeOfDecision(loaded, e.key);
  return undefined;
}

/** The change the session is bound to: the last one in `changes` that still resolves. */
export function boundOf(loaded: Loaded, session: Rec): Rec | undefined {
  return list(session.data.changes).map((k) => live(loaded, k)).filter((r): r is Rec => !!r).at(-1);
}

/** What the session is looking at, and since when: the latest of the context it read (`focus`), a change or a decision it
 *  wrote, and a change it bound. A batch is one move, onto the change it was for, never onto each record it touched. */
export function focusOf(loaded: Loaded, session: Rec, events: StoreEvent[]): { change: string; at: string } | undefined {
  let best: { change: string; at: string } | undefined;
  const consider = (change: Rec | undefined, at: string | undefined) => {
    if (change && at && (!best || at >= best.at)) best = { change: change.key, at };
  };
  const read = session.data.focus as { change?: string; at?: string } | undefined;
  if (read) consider(live(loaded, read.change), read.at);
  const batches = streamMemo(events, 'batches', () => new Set(events.filter((e) => e.op === 'applied' && e.commit).map((e) => e.commit)));
  for (const e of eventsBySession(events).get(session.key) ?? []) {
    if (e.op === 'applied') consider(live(loaded, e.key), e.at);
    else if (e.commit && batches.has(e.commit)) continue;
    else if (e.key === session.key && e.op === 'bind') consider(boundOf(loaded, session), e.at);
    else if (e.op !== 'log') consider(changeOfEvent(loaded, e), e.at);
  }
  return best;
}

/** The keys whose events a session bound to `change` is told about: the change, its milestone, the changes on either
 *  end of its dependency edges; and the decisions on it, matched by the change they sit on. */
function scopeOf(loaded: Loaded, change: Rec): Set<string> {
  const keys = new Set<string>(eventKeysOf(change));
  const add = (r: Rec | undefined) => r && eventKeysOf(r).forEach((k) => keys.add(k));
  add(live(loaded, change.data.parent));
  for (const d of list(change.data.depends_on)) add(live(loaded, d));
  for (const r of loaded.records) if (r.type === 'change' && r.valid && list(r.data.depends_on).some((d) => live(loaded, d)?.key === change.key)) add(r);
  return keys;
}

/** Where the last brief reached: its sequence number when the event there is still the one it saw, else the last event
 *  at or before its instant (a rebuilt stream renumbers). */
function since(events: StoreEvent[], mark: { seq?: number; at?: string } | undefined): number {
  if (!mark || typeof mark.at !== 'string') return 0;
  const same = events.find((e) => e.seq === mark.seq);
  if (same && same.at === mark.at) return mark.seq!;
  let seq = 0;
  for (const e of events) if (e.at <= mark.at) seq = e.seq;
  return seq;
}

const LOG_LINE = /^-\s*(\S+)\s+—\s+(.*)$/;

function ago(at: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  return min < 1 ? 'just now' : `${min} min ago`;
}

const files = (s: Rec): string[] => (Array.isArray(s.data.observed) ? (s.data.observed as { to?: unknown }[]) : []).map((o) => o.to).filter((t): t is string => typeof t === 'string' && t.startsWith('file:'));

export interface Neighbour {
  session: string;
  on: string;
  /** The feature node both changes name, when the neighbour is on another change. */
  feature?: string;
  last: string;
  touched?: string;
  /** Files both sessions touched. */
  shared: string[];
}

/** The other live sessions on the same change, or on a change naming the exact same feature node (decision
 *  hydration/neighbours-inform-and-warn). Live is the dashboard's one definition: a write within LIVE_MINUTES, not ended. */
export function neighboursOf(loaded: Loaded, session: Rec, change: Rec, events: StoreEvent[], now = Date.now()): Neighbour[] {
  const liveSince = new Date(now - LIVE_MINUTES * 60_000).toISOString();
  const last = new Map<string, string>();
  for (const e of events) if (e.session && e.at >= liveSince && (!last.has(e.session) || e.at > last.get(e.session)!)) last.set(e.session, e.at);
  const mine = new Set(effectsOf(change).map((f) => live(loaded, f.key)?.key ?? f.key));
  const myFiles = new Set(files(session));
  const out: Neighbour[] = [];
  for (const [key, at] of last) {
    if (key === session.key) continue;
    const s = findSession(loaded, key.replace(/^session:/, ''));
    if (!s?.valid) continue;
    const log = (s.sections.get('Log') ?? '').split('\n').map((l) => LOG_LINE.exec(l.trim())).filter((m): m is RegExpExecArray => !!m);
    if (log.at(-1)?.[2].startsWith('session ended')) continue;
    const on = boundOf(loaded, s);
    if (!on) continue;
    let feature: string | undefined;
    if (on.key !== change.key) {
      feature = effectsOf(on).map((f) => live(loaded, f.key)?.key ?? f.key).find((f) => mine.has(f));
      if (!feature) continue;
    }
    const theirs = files(s);
    out.push({ session: key, on: on.key, feature, last: at, touched: theirs.at(-1), shared: [...new Set(theirs.filter((f) => myFiles.has(f)))] });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last));
}

export function formatNeighbour(n: Neighbour, now = Date.now()): string {
  const who = `session:${n.session.replace(/^session:/, '').slice(0, 8)}`;
  const where = n.feature ? `on ${n.on}, which also names ${n.feature}` : `on this change`;
  const touched = n.touched ? `, last touched ${n.touched}` : '';
  const warn = n.shared.length ? ` — warning: it also touched ${n.shared.join(', ')}` : '';
  return `${who} ${where}, last moved ${ago(n.last, now)}${touched}${warn}`;
}

const isNote = (e: StoreEvent) => e.op === 'log' && !!e.fields?.includes('notes');

/** The notes a session is given after `from`: those on the session itself and on the change it is bound to, written by
 *  anyone but the session, each in full (decision messages/note-is-a-line-on-its-record). The k-th note event on a record
 *  after the point is the k-th of its last lines, so a note is matched to the write that made it. */
export function notesFor(session: Rec, change: Rec | undefined, events: StoreEvent[], from: number): string[] {
  const out: string[] = [];
  for (const rec of [session, change]) {
    if (!rec) continue;
    const keys = eventKeysOf(rec);
    const later = events.filter((e) => e.seq > from && isNote(e) && keys.includes(e.key));
    if (!later.length) continue;
    const lines = notesOf(rec.sections.get('Notes')).slice(-later.length);
    later.forEach((e, i) => {
      const n = lines[i];
      if (!n || e.session === session.key) return;
      const to = rec === session ? 'to this session' : `on ${rec.key}`;
      out.push(`${n.writer ?? 'someone'} ${to}, ${n.at.replace('T', ' ').slice(0, 16)}: ${n.text}`);
    });
  }
  return out;
}

/** Why an event wakes a session that is idle, or nothing: a decision on the change it is bound to set decided, or a note
 *  on that change or on the session itself, by anyone but the session (decision messages/module-asks-the-server). Every
 *  other event waits for the session's next prompt. */
export function wakeOf(loaded: Loaded, session: Rec, e: StoreEvent): string | undefined {
  if (e.session === session.key) return undefined;
  const change = boundOf(loaded, session);
  if (isNote(e)) {
    if (eventKeysOf(session).includes(e.key)) return 'a note to this session';
    if (change && live(loaded, e.key)?.key === change.key) return `a note on ${change.key}`;
    return undefined;
  }
  if (e.type === 'decision' && e.op === 'set' && e.fields?.includes('status') && change && changeOfDecision(loaded, e.key)?.key === change.key) {
    const d = live(loaded, e.key);
    if (d?.data.status === 'decided') return `${d.key} decided${typeof d.data.decided_by === 'string' ? ` by ${d.data.decided_by}` : ''}`;
  }
  return undefined;
}

export interface Brief {
  session: string;
  /** full: the binding moved, the change's context whole; delta: what changed since the last brief; none: nothing to say. */
  mode: 'full' | 'delta' | 'none';
  change?: string;
  /** The delta, one line per record (decision hydration/delta-one-line-per-record). */
  lines: string[];
  /** The notes the session is given, each in full: on the session and on its bound change. */
  notes?: string[];
  neighbours: string[];
  text: string;
  /** The last sequence number the brief saw: where the next one starts. */
  seq: number;
  at: string;
  /** No ceiling (decision hydration/no-ceiling-show-size): the size is shown instead. Tokens are approximate. */
  size: { lines: number; chars: number; tokens: number };
}

const sizeOf = (text: string) => ({ lines: text ? text.split('\n').filter((l) => l.trim()).length : 0, chars: text.length, tokens: Math.ceil(text.length / 4) });

/** The brief for a session, computed and not recorded. Full when the session's binding has moved since its last brief
 *  (or `full` asks for it, as after the harness compacted the conversation); otherwise the delta over the bound change,
 *  its milestone, its decisions and its dependency edges, without the session's own writes (decision
 *  hydration/brief-with-watermark). An unbound session has no brief. */
export function computeBrief(store: Store, id: string, opts: { full?: boolean; loaded?: Loaded; now?: number } = {}): Brief {
  const loaded = opts.loaded ?? loadStore(store);
  const now = opts.now ?? Date.now();
  const session = findSession(loaded, id.replace(/^session:/, ''));
  if (!session) throw notFound(`session:${id.replace(/^session:/, '')}`);
  const events = readEvents(store);
  const tail = events.at(-1);
  const base = { session: session.key, seq: tail?.seq ?? 0, at: tail?.at ?? new Date(now).toISOString() };
  const change = boundOf(loaded, session);
  const mark = session.data.briefed as { change?: string; seq?: number; at?: string } | undefined;
  if (!change) {
    // an unbound session has no brief but the notes addressed to it
    const notes = notesFor(session, undefined, events, since(events, mark));
    if (!notes.length) return { ...base, mode: 'none', lines: [], neighbours: [], text: '', size: sizeOf('') };
    const text = `pjman brief: notes for this session:\n${notes.map((l) => `- ${l}`).join('\n')}\n`;
    return { ...base, mode: 'delta', lines: [], notes, neighbours: [], text, size: sizeOf(text) };
  }
  const neighbours = neighboursOf(loaded, session, change, events, now);
  if (opts.full || live(loaded, mark?.change)?.key !== change.key) {
    let text = `pjman brief: this session is bound to ${change.key}; its context in full.\n\n${formatChangeContext(changeContext(store, change.key, loaded))}`;
    if (neighbours.length) text += `\nOther live sessions near this work:\n${neighbours.map((n) => `- ${formatNeighbour(n, now)}`).join('\n')}\n`;
    return { ...base, mode: 'full', change: change.key, lines: [], neighbours: neighbours.map((n) => formatNeighbour(n, now)), text, size: sizeOf(text) };
  }
  const from = since(events, mark);
  const after = events.filter((e) => e.seq > from);
  const scope = scopeOf(loaded, change);
  const delta = after.filter((e) => e.session !== session.key && !isNote(e) && (scope.has(e.key) || (e.type === 'decision' && changeOfDecision(loaded, e.key)?.key === change.key)));
  const lines = receiptLines(delta, loaded, { counts: true });
  const notes = notesFor(session, change, events, from);
  // a neighbour is news when it moved since the last brief; the same line is not repeated on every prompt
  const fresh = neighbours.filter((n) => n.last > (mark?.at ?? ''));
  if (!lines.length && !fresh.length && !notes.length) return { ...base, mode: 'none', change: change.key, lines: [], neighbours: [], text: '', size: sizeOf('') };
  let text = `pjman brief: since this session's last brief, on ${change.key} and what it touches:\n`;
  if (lines.length) text += lines.map((l) => `- ${l}`).join('\n') + '\n';
  if (notes.length) text += `${lines.length ? '\n' : ''}Notes:\n${notes.map((l) => `- ${l}`).join('\n')}\n`;
  if (fresh.length) text += `${lines.length || notes.length ? '\n' : ''}Other live sessions near this work:\n${fresh.map((n) => `- ${formatNeighbour(n, now)}`).join('\n')}\n`;
  text += `(pjman context ${change.key} has the whole record.)\n`;
  return { ...base, mode: 'delta', change: change.key, lines, notes, neighbours: fresh.map((n) => formatNeighbour(n, now)), text, size: sizeOf(text) };
}

/** Compute the brief and, when it says something, record how far it reached: the session's watermark. */
export function brief(store: Store, id: string, opts: { full?: boolean; now?: number } = {}): Brief {
  const b = computeBrief(store, id, opts);
  if (b.mode !== 'none') sessionBriefed(store, b.session, { change: b.change, seq: b.seq, at: b.at });
  return b;
}

export function formatBriefSize(b: Pick<Brief, 'mode' | 'change' | 'size'>): string {
  return `${b.mode === 'full' ? 'full context' : b.change ? 'what changed' : 'notes'}${b.change ? ` on ${b.change}` : ''}: ${b.size.lines} line${b.size.lines === 1 ? '' : 's'}, ~${b.size.tokens} tokens`;
}

export interface Wake {
  seq: number;
  key: string;
  why: string;
}

/** The events after `since` that wake the session, then each one as it lands while `follow` holds: what the adapter's
 *  waking module reads for the session's life. The store is read again only for an event that could wake it. */
export function followWakes(store: Store, id: string, since: number, fn: (w: Wake) => void): () => void {
  const sid = id.replace(/^session:/, '');
  return follow(store, since, (e) => {
    const maybe = isNote(e) || (e.type === 'decision' && e.op === 'set' && !!e.fields?.includes('status'));
    if (!maybe) return;
    const loaded = loadStore(store);
    const session = findSession(loaded, sid);
    if (!session) return;
    const why = wakeOf(loaded, session, e);
    if (why) fn({ seq: e.seq, key: e.key, why });
  });
}
