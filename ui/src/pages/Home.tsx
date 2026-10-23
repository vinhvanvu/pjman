import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { Page } from './Page';

/** Home: the product, when there is one; every product when there are several; the projects when there is none yet. */
export function HomePage() {
  const store = useLive(() => api.store(), [], (e) => e.type === 'product' || e.type === 'project' || e.op === 'init');
  if (store.error) return <p className="error">{store.error.message}</p>;
  if (!store.data) return <p className="muted">loading…</p>;
  const products = store.data.products;
  if (products.length === 1) return <Navigate to={`/feature/${products[0].key}`} replace />;
  return <Page lens={products.length ? 'feature' : 'project'} />;
}
