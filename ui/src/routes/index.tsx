// Home: one product goes straight to it in the feature lens; otherwise the root of the store in the lens that fits.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useStore } from '@/data/queries';
import { LensPage } from './-LensPage';
import { pageSearch } from './-search';

export const Route = createFileRoute('/')({
  validateSearch: pageSearch,
  component: Home,
});

function Home() {
  const { data, error } = useStore();
  if (error) return <div className="p-6 text-sm text-ink-muted">The server did not answer: {error.message}</div>;
  if (!data) return null;
  const products = data.products;
  if (products.length === 1) {
    return (
      <Navigate to="/$lens/$" params={{ lens: 'feature', _splat: products[0]!.key }} search={(prev) => prev} replace />
    );
  }
  return <LensPage lens={products.length ? 'feature' : 'project'} />;
}
