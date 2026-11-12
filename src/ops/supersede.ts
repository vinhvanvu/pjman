// The write that marks a decision's supersedes: the targets set superseded on disk in the same commit as the decision
// that names them (what it supersedes reads through model/supersede).
import fs from 'node:fs';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import type { Rec } from '../store/records.js';
import { render } from './write.js';

export interface Marked {
  /** The paths rewritten, for validation. */
  touched: string[];
  /** The text each had before, for the undo. */
  prior: Map<string, string>;
  /** The events to record beside the write's own. */
  also: EventInput[];
  /** One line per target, for the person. */
  notes: string[];
}

/** Set each target's status to superseded on disk, leaving one already superseded alone; nothing is committed here. */
export function markSuperseded(targets: Rec[], writer: string | undefined): Marked {
  const m: Marked = { touched: [], prior: new Map(), also: [], notes: [] };
  for (const rec of targets) {
    if (rec.data.status === 'superseded') continue;
    const text = fs.readFileSync(rec.abs, 'utf8');
    m.prior.set(rec.path, text);
    const updated = render('decision', { ...rec.data, status: 'superseded' }, rec.body);
    if (updated !== text) fs.writeFileSync(rec.abs, updated);
    m.touched.push(rec.path);
    m.also.push({
      op: 'set',
      key: rec.key,
      type: 'decision',
      path: rec.path,
      fields: ['status'],
      value: 'superseded',
      writer,
    });
    m.notes.push(`${rec.key} is now superseded`);
  }
  return m;
}

/** Undo a marking after a refused validation. */
export function unmark(store: Store, m: Marked): void {
  for (const [rel, text] of m.prior) fs.writeFileSync(`${store.root}/${rel}`, text);
}
