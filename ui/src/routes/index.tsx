// Home: the product last opened (else the first) in the feature lens; the product is the root node of every lens, so
// the app never lands above it. Only a store with no product shows the root itself.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useStore } from '@/data/queries';
import { usePreferences } from '@/state/preferences';
import { LensPage } from './-LensPage';
import { pageSearch } from './-search';

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
    return <Navigate to="/$lens/$" params={{ lens: 'feature', _splat: target.key }} search={(prev) => prev} replace />;
  }
  return <LensPage lens="feature" />;
}
