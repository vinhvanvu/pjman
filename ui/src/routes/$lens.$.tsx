// /:lens/*: a node in a lens. The lens is validated; the rest of the path is the node's key.
import { createFileRoute, notFound } from '@tanstack/react-router';
import { LENSES, type Lens } from '@/data/contract';
import { LensPage } from './-LensPage';
import { pageSearch } from './-search';

export const Route = createFileRoute('/$lens/$')({
  params: {
    parse: (raw) => {
      if (!(LENSES as readonly string[]).includes(raw.lens)) throw notFound();
      return { lens: raw.lens as Lens, _splat: raw._splat ?? '' };
    },
    stringify: (p) => ({ lens: p.lens, _splat: p._splat }),
  },
  validateSearch: pageSearch,
  component: Page,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-ink-muted">No such lens. The lenses are feature, project and milestone.</div>
  ),
});

function Page() {
  const { lens, _splat } = Route.useParams();
  return <LensPage lens={lens} node={_splat || undefined} />;
}
