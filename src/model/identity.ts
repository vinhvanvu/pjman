// Who the person is: the actor the user config names (`actor:` in ~/.pjman/config.yaml) and their record in the store.
// A plain read; nothing here asks an app, writes the store or writes the config. What is off is said with the command
// that resolves it.

import { readUserConfig, type Store } from '../store/config.js';
import { loadStore } from '../store/records.js';

export interface Identity {
  /** The configured actor key, or null. */
  actor: string | null;
  name: string | null;
  /** The person record exists. */
  record: boolean;
  /** What is off, one sentence each, with the command that resolves it. */
  notices: string[];
}

/** Who the person is: the configured actor and their record. Writes nothing. */
export function identity(store: Store): Identity {
  const actor = readUserConfig().actor ?? null;
  const loaded = loadStore(store);
  const rec = actor
    ? (loaded.byKey.get(actor)?.[0] ?? loaded.byKey.get(loaded.aliases.get(actor)?.[0] ?? '')?.[0])
    : undefined;
  const notices: string[] = [];
  if (!actor)
    notices.push("no actor is configured: run pjman init, or set 'actor: person:<handle>' in ~/.pjman/config.yaml");
  else if (!rec) notices.push(`${actor} has no record: run pjman init, which makes it`);
  return {
    actor,
    name: typeof rec?.data.name === 'string' ? rec.data.name : null,
    record: !!rec,
    notices,
  };
}

/** The read as lines: who, then what is off. */
export function formatIdentity(id: Identity): string[] {
  const out: string[] = [];
  if (!id.actor) out.push('no actor configured');
  else out.push(`you are ${id.actor}${id.name ? ` (${id.name})` : ''}${id.record ? '' : ' (no record)'}`);
  for (const n of id.notices) out.push(`note: ${n}`);
  return out;
}
