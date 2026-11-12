// /milestones/*: the fourth of the product's destinations (decision milestone-detail/milestones-on-the-rail): the
// milestones in flight nearest to done first, the done folded. The rest of the path is the product's key.
import { createFileRoute } from '@tanstack/react-router';
import { MilestonesPage } from './-MilestonesPage';
import { pageSearch } from '@/lib/search';

export const Route = createFileRoute('/milestones/$')({
  validateSearch: pageSearch,
  component: Page,
});

function Page() {
  const { _splat } = Route.useParams();
  return <MilestonesPage key={_splat} productKey={_splat || undefined} />;
}
