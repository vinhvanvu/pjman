// A decision's supersedes: the decisions it replaces, one key or a list, and the one write that marks them. A decision
// names what it supersedes at creation (--supersedes) or later (pjman set supersedes=…), and either way the targets
// are set superseded in the same commit, so validate's rule (a superseded decision is pointed at) always holds.
import fs from 'node:fs';
import type { Store } from '../store/config.js';
import type { EventInput } from '../store/events.js';
import { resolve, unresolved, type Loaded, type Rec } from '../store/records.js';
import { CliError } from '../store/util.js';
import { render } from '../ops/write.js';

/** The keys a decision's `supersedes` names, as written: a string or a list, else none. */
export function supersedesOf(data: Record<string, unknown>): string[] {
  const v = data.supersedes;
  if (typeof v === 'string') return [v];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

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

/** Resolve each key a decision would supersede, in `scope`; refused when one does not resolve, names the decision
 *  itself, or is already superseded by another decision. */
export function resolveSupersedes(loaded: Loaded, keys: string[], scope: string | null | undefined, self?: Rec): Rec[] {
  const out: Rec[] = [];
  for (const raw of keys) {
    const res = resolve(loaded, raw, scope ?? undefined);
    if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(`supersedes: ${unresolved(res, raw)}`);
    if (res.rec.type !== 'decision') throw new CliError(`supersedes: ${res.rec.key} is a ${res.rec.type}, not a decision`);
    if (self && res.rec.key === self.key) throw new CliError(`supersedes: a decision cannot supersede itself`);
    const by = supersededBy(loaded, res.rec.key).filter((r) => !self || r.key !== self.key);
    if (by.length) throw new CliError(`supersedes: ${res.rec.key} is already superseded by ${by.map((r) => r.key).join(', ')}`);
    if (!out.some((r) => r.key === res.rec.key)) out.push(res.rec);
  }
  return out;
}

/** The decisions whose `supersedes` points at `key`. */
export function supersededBy(loaded: Loaded, key: string): Rec[] {
  const out: Rec[] = [];
  for (const r of loaded.records) {
    if (r.type !== 'decision') continue;
    for (const k of supersedesOf(r.data)) {
      const t = resolve(loaded, k, r.productSlug ? `product:${r.productSlug}` : undefined);
      if ((t.status === 'ok' || t.status === 'alias') && t.rec.key === key) {
        out.push(r);
        break;
      }
    }
  }
  return out;
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
    m.also.push({ op: 'set', key: rec.key, type: 'decision', path: rec.path, fields: ['status'], value: 'superseded', writer });
    m.notes.push(`${rec.key} is now superseded`);
  }
  return m;
}

/** Undo a marking after a refused validation. */
export function unmark(store: Store, m: Marked): void {
  for (const [rel, text] of m.prior) fs.writeFileSync(`${store.root}/${rel}`, text);
}
