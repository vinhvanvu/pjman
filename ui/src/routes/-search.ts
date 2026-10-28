// The search params every page understands: what identifies the page's state. Validated with zod, absent means the default.
// The path is the scope (what the structure pane draws); `sel` is the selection (what the record pane shows); the
// filter params narrow the structure pane and are what a saved view will be made of.
import { z } from 'zod';
import { TABS } from '@/data/contract';

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
  /** Bugs only: the map keeps the nodes a bug is listed at, with the path to each. */
  bugs: z.boolean().optional().catch(undefined),
});

export type PageSearch = z.infer<typeof pageSearch>;
