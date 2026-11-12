// A note: a person's word to whoever works a change, or to one running session (decision
// messages/note-is-a-line-on-its-record). One line under `## Notes` on the record it is addressed to; `pjman undo
// <commit>` takes it back, as any one write.
import fs from 'node:fs';
import type { Store } from '../store/config.js';
import { loadStore, resolve, unresolvedError } from '../store/records.js';
import { CliError, nowIso } from '../store/util.js';
import { envelope, finishWrite, render, snapshot, validateOrUndo } from './write.js';

export const NOTE_LINE = /^-\s*(\S+)\s+—\s+(?:(\S+):\s+)?(.*)$/;

export interface Note {
  at: string;
  writer?: string;
  text: string;
}

/** The notes on a record, oldest first. */
export function notesOf(body: string | undefined): Note[] {
  return (body ?? '')
    .split('\n')
    .map((l) => NOTE_LINE.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ at: m[1], writer: m[2], text: m[3] }));
}

/** Append a note to a change or a session. */
export function note(store: Store, ref: string, text: string, flags: { writer?: string; session?: string } = {}): { key: string; path: string; commit: string | null } {
  if (!text.trim()) throw new CliError('a note needs its text');
  const loaded = loadStore(store);
  const res = resolve(loaded, ref);
  if (res.status !== 'ok' && res.status !== 'alias') throw unresolvedError(res, ref);
  const rec = res.rec;
  if (rec.type !== 'change' && rec.type !== 'session') throw new CliError(`a note is addressed to a change or a session, not ${rec.key}`);
  if (!rec.valid) throw new CliError(`${rec.path} is invalid; fix it before adding a note`);
  const env = envelope(flags);
  let body = rec.body.replace(/\s+$/, '');
  if (!rec.sections.has('Notes')) body += `${body ? '\n\n' : ''}## Notes`;
  body += `\n- ${nowIso()} — ${env.writer ? `${env.writer}: ` : ''}${text.trim().replace(/\s*\n\s*/g, ' ')}\n`;
  const prior = snapshot(store, [rec.path]);
  fs.writeFileSync(rec.abs, render(rec.type, rec.data, body));
  validateOrUndo(store, [rec.path], [], prior);
  const commit = finishWrite(store, `pjman: note ${rec.key}`, env.session, [{ op: 'log', key: rec.key, type: rec.type, path: rec.path, fields: ['notes'], writer: env.writer }]);
  return { key: rec.key, path: rec.path, commit };
}
