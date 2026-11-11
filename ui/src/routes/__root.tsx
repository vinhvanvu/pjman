// The root: providers that need the router, the theme on the document, the event stream keeping the cache live, and
// the motion vocabulary every live surface draws from (lib/motion).
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, retainSearchParams } from '@tanstack/react-router';
import { z } from 'zod';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLiveInvalidation } from '@/data/live';
import { useFollowWindow } from '@/features/session-follow';
import { useApplyTheme } from '@/features/theme';
import { MotionRoot } from '@/lib/motion';
import { atSearch, eventSearch } from './-search';

export interface RouterContext {
  queryClient: QueryClient;
}

// The time cursor is the app's, not a page's: every navigation keeps it, so moving between the bridge, the map and
// the roadmap stays at the same moment; only the chip's way back to now clears it.
export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: z.object({ at: atSearch, event: eventSearch }),
  search: { middlewares: [retainSearchParams(['at', 'event'])] },
  component: Root,
});

function Root() {
  useApplyTheme();
  useLiveInvalidation();
  useFollowWindow();
  return (
    <MotionRoot>
      <TooltipProvider delayDuration={300}>
        <Outlet />
      </TooltipProvider>
    </MotionRoot>
  );
}
