// Home: the bridge of the product last opened (else the first), where a person sees what is moving and orients
// (decision rail-destinations/bridge-is-home); the product is the root of every page, so the app never lands above it.
// Only a store with no product shows the root itself, in the feature lens.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useStore } from '@/data/queries';
import { usePreferences } from '@/state/preferences';
import { LensPage } from './-LensPage';
import { pageSearch } from '@/lib/search';

export const Route = createFileRoute('/')({
  validateSearch: pageSearch,
  component: Home,
});

function Home() {
  const { data, error } = useStore();
  const lastProduct = usePreferences((s) => s.lastProduct);
  if (error) return <div className="p-6 text-sm text-ink-muted">The server did not answer: {error.message}</div>;
  if (!data) return null;
  const products = data.products;
  const target = products.find((p) => p.key === lastProduct) ?? products[0];
  if (target) {
    return <Navigate to="/bridge/$" params={{ _splat: target.key }} search={(prev) => prev} replace />;
  }
  return <LensPage lens="feature" />;
}
