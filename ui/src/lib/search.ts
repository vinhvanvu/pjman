// The search params every page understands: what identifies the page's state. Validated with zod, absent means the default.
// The path is the scope (what the structure pane draws); `sel` is the selection (what the record pane shows); the
// filter params narrow the structure pane and are what a saved view will be made of.
import { z } from 'zod';
import { TABS } from '@/data/contract';

/** The moment a page reads as of is a time (decision read-at-a-moment/time-with-event-selection): `at` holds an
 *  instant, resolved by the server to the latest event at or before it; absent is now. A number is still accepted, as
 *  an old link's event, and read as the selection. */
export const atSearch = z
  .union([z.number().int().positive(), z.string().min(1)])
  .optional()
  .catch(undefined);

/** The event selected (a tick clicked, a step, a lock): it pins the page to exactly that event, which a time cannot
 *  do where several events share an instant. The router reads it as JSON, so it arrives as a number. */
export const eventSearch = z.number().int().positive().optional().catch(undefined);

export const pageSearch = z.object({
  sel: z.string().optional().catch(undefined),
  tab: z.enum(TABS).optional().catch(undefined),
  done: z.boolean().optional().catch(undefined),
  retired: z.boolean().optional().catch(undefined),
  days: z.number().int().positive().optional().catch(undefined),
  /** The filter: a text to match on name, title or key; states as a comma list; a milestone (a change key) that
   *  narrows everything in the lens to the work beneath it. */
  q: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  milestone: z.string().optional().catch(undefined),
  /** An aspect (its key): the map narrows to its places and the record pane reads it (decision
   *  aspects-dashboard/aspect-is-a-map-lens). */
  aspect: z.string().optional().catch(undefined),
  /** Bugs only: the map keeps the nodes a bug is listed at, with the path to each. */
  bugs: z.boolean().optional().catch(undefined),
  /** On a session's page: the change the person holds shown (decision session-detail/one-shown-change), absent when
   *  the page follows the session's focus. */
  show: z.string().optional().catch(undefined),
  /** The decision open to its thread (decision detail-pages/decision-card): a link to a decision lands on it open. */
  decision: z.string().optional().catch(undefined),
  /** On the bridge: the changes held (decisions bridge-rework/hold-is-a-button and held-card-lifts), a comma list of
   *  keys, each card lifted under the transport and the transport filtered to their writes; a link carries them. */
  hold: z.string().optional().catch(undefined),
  /** The moment the page reads as of, and the event selected; every query carries them, so the whole page holds
   *  still at that moment. */
  at: atSearch,
  event: eventSearch,
});

export type PageSearch = z.infer<typeof pageSearch>;
