// The search params every page understands: what identifies the view. Validated with zod, absent means the default.
import { z } from 'zod';
import { GROUPINGS, VIEWS } from '@/data/contract';

export const pageSearch = z.object({
  view: z.enum(VIEWS).optional().catch(undefined),
  group: z.enum(GROUPINGS).optional().catch(undefined),
  done: z.boolean().optional().catch(undefined),
  retired: z.boolean().optional().catch(undefined),
  days: z.number().int().positive().optional().catch(undefined),
});

export type PageSearch = z.infer<typeof pageSearch>;
