// Session kinds (decision unbound-sessions/kinds): what a session with no change is doing, as a record of its own
// (session-kinds/<slug>.md) with the five verbs every entity has. Four are seeded with the store; the naming command
// creates one it is handed that does not exist. A kind is inferred from a session's own record (decision
// unbound-sessions/naming): what it read, never what the harness saw it do.
import type { Store } from './config.js';
import type { Loaded, Rec } from './records.js';
import { loadStore, resolve } from './records.js';
import { newSessionKind } from './commands/new.js';

export interface SessionKindSeed {
  slug: string;
  name: string;
  gist: string;
}

/** The kinds every store starts with. */
export const DEFAULT_SESSION_KINDS: readonly SessionKindSeed[] = [
  { slug: 'review', name: 'Review', gist: 'A pull request or a branch read and commented on, not written' },
  { slug: 'backlog', name: 'Backlog', gist: 'Tickets and records sorted, filed and cleaned up, no one change built' },
  { slug: 'chat', name: 'Chat', gist: 'A conversation that planned or explained, with nothing bound' },
  { slug: 'other', name: 'Other', gist: 'Work that fits none of the kinds the store has' },
];

export const sessionKindKey = (slug: string): string => `session-kind:${slug}`;

/** The kinds the store holds. */
export function sessionKindsOf(loaded: Loaded): Rec[] {
  return loaded.records.filter((r) => r.type === 'session-kind' && r.valid);
}

/** The default kinds the store lacks (by key or former name). */
export function missingSessionKinds(loaded: Loaded): SessionKindSeed[] {
  return DEFAULT_SESSION_KINDS.filter((k) => !loaded.byKey.has(sessionKindKey(k.slug)) && !loaded.aliases.has(sessionKindKey(k.slug)));
}

/** Create the default kinds the store lacks, one write each; the keys created. */
export function seedSessionKinds(store: Store, opts: { writer?: string; session?: string } = {}): string[] {
  const created: string[] = [];
  for (const k of missingSessionKinds(loadStore(store))) {
    newSessionKind(store, k.slug, { name: k.name, gist: k.gist, writer: opts.writer, session: opts.session });
    created.push(sessionKindKey(k.slug));
  }
  return created;
}

export interface Inferred {
  kind: string;
  /** The name the record suggests, when it does: the source's title, else its key. */
  name?: string;
  /** What the inference read. */
  from: string;
}

/** The sources a session observed on itself (not on a change): the edges whose from is the session. */
export function ownSources(rec: Rec): { edge: string; to: string; at?: string }[] {
  if (!Array.isArray(rec.data.observed)) return [];
  const out: { edge: string; to: string; at?: string }[] = [];
  for (const o of rec.data.observed as unknown[]) {
    if (!o || typeof o !== 'object') continue;
    const e = o as Record<string, unknown>;
    if (typeof e.edge !== 'string' || typeof e.to !== 'string' || e.from !== rec.key) continue;
    out.push({ edge: e.edge, to: e.to, at: typeof e.at === 'string' ? e.at : undefined });
  }
  return out;
}

/** The log lines a session wrote, the start line included. */
function logLines(rec: Rec): string[] {
  const log = rec.sections.get('Log') ?? '';
  return log.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '));
}

/** What a session's own record says it is doing: a PR among its sources reads review, a ticket with no change bound
 *  backlog, nothing but log lines beyond the start chat; nothing on the record infers nothing. The name is the first
 *  such source's title when the store has a record for it, else its key's rest. */
export function inferSessionKind(loaded: Loaded, rec: Rec): Inferred | null {
  const sources = ownSources(rec);
  const titleOf = (key: string): string | undefined => {
    const r = resolve(loaded, key);
    const t = r.status === 'ok' || r.status === 'alias' ? r.rec.data.title : undefined;
    return typeof t === 'string' && t.trim() ? t.trim() : undefined;
  };
  const restOf = (key: string): string => key.slice(key.indexOf(':') + 1);
  const pr = sources.find((s) => s.to.startsWith('github-pr:'));
  if (pr) return { kind: 'review', name: titleOf(pr.to) ?? `Review of ${restOf(pr.to)}`, from: pr.to };
  const bound = Array.isArray(rec.data.changes) && rec.data.changes.length > 0;
  const ticket = sources.find((s) => s.to.startsWith('github-issue:') || s.to.startsWith('linear:'));
  if (ticket && !bound) return { kind: 'backlog', name: titleOf(ticket.to) ?? restOf(ticket.to), from: ticket.to };
  if (logLines(rec).length > 1) return { kind: 'chat', from: 'its log' };
  return null;
}
