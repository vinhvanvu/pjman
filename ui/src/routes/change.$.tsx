// /change/*: a change's own page (decision change-detail/own-route). The rest of the path is the key after `change:`,
// so /change/pjman/releases-homebrew is change:pjman/releases-homebrew; one address per change, whatever lens it was
// opened from. Width decides the page, never the route: wide the change opened out with its panel, docked the same
// tree folded.
import { createFileRoute } from '@tanstack/react-router';
import { ChangePage } from './-ChangePage';
import { pageSearch } from '@/lib/search';

export const Route = createFileRoute('/change/$')({
  validateSearch: pageSearch,
  component: Page,
});

function Page() {
  const { _splat } = Route.useParams();
  return <ChangePage key={_splat} changeKey={`change:${_splat ?? ''}`} />;
}
