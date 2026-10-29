// Deciding in place (decision decide-in-place/decide-route-and-reopen): a proposed decision set decided by the person,
// and its reverse, a decided one set back to proposed. Both are the command's own set, so the commit and the event are
// the ones a decision decided in a session makes; the event is what wakes the sessions bound to its change.
import type { Store } from '../config.js';
import { loadStore, resolve, unresolved } from '../records.js';
import { supersededBy } from '../supersede.js';
import { CliError, today } from '../util.js';
import { set, type SetResult } from './set.js';

function decision(store: Store, ref: string) {
  const loaded = loadStore(store);
  const raw = ref.startsWith('decision:') ? ref : `decision:${ref}`;
  const res = resolve(loaded, raw);
  if (res.status !== 'ok' && res.status !== 'alias') throw new CliError(unresolved(res, raw));
  if (res.rec.type !== 'decision') throw new CliError(`${res.rec.key} is not a decision`);
  return { loaded, rec: res.rec };
}

/** A proposed decision, decided by `by` today. Refused unless it is proposed. */
export function decide(store: Store, ref: string, opts: { by: string; on?: string; session?: string }): SetResult {
  const { rec } = decision(store, ref);
  if (rec.data.status !== 'proposed') throw new CliError(`${rec.key} is ${String(rec.data.status)}, not proposed; only a proposed decision is decided`);
  return set(store, rec.key, ['status=decided', `decided_by=${opts.by}`, `decided_on=${opts.on ?? today()}`], { session: opts.session });
}

/** Deciding's reverse: a decided decision back to proposed, who decided it and when removed. Refused unless it is
 *  decided and nothing supersedes it. */
export function reopen(store: Store, ref: string, opts: { session?: string } = {}): SetResult {
  const { loaded, rec } = decision(store, ref);
  if (rec.data.status !== 'decided') throw new CliError(`${rec.key} is ${String(rec.data.status)}, not decided; only a decided decision is reopened`);
  const by = supersededBy(loaded, rec.key).map((r) => r.key);
  if (by.length) throw new CliError(`${rec.key} is superseded by ${by.join(', ')}; reopen that instead`);
  return set(store, rec.key, ['status=proposed', 'decided_by=', 'decided_on='], { session: opts.session });
}
