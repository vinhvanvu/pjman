// The root: providers that need the router, the theme on the document, and the event stream keeping the cache live.
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLiveInvalidation } from '@/data/live';
import { useApplyTheme } from '@/features/theme';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  useApplyTheme();
  useLiveInvalidation();
  return (
    <TooltipProvider delayDuration={300}>
      <Outlet />
    </TooltipProvider>
  );
}
