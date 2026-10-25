// /get/*: anything in, the right page out. A node key opens its lens; a ticket or file opens the change in reach;
// a decision opens its change in the milestone lens. What cannot be resolved says what was tried.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useResolve } from '@/data/queries';
import { isNodeKey, kindOf, restOf, targetOf } from '@/lib/keys';

export const Route = createFileRoute('/get/$')({
  component: Get,
});

function Get() {
  const { _splat } = Route.useParams();
  const ref = _splat ?? '';
  const { data, error } = useResolve(ref || undefined);
  if (!ref) return <Navigate to="/" />;
  if (error) {
    return (
      <div className="flex flex-col gap-2 p-6 text-sm text-ink-muted">
        <div>Nothing resolves from {ref}.</div>
        <div className="text-xs text-ink-faint">{error.message}</div>
      </div>
    );
  }
  if (!data) return null;
  const key = data.resolution.key;
  if (key && kindOf(key) === 'decision') {
    const change = `change:${restOf(key).split('/')[0]}`;
    return <Navigate to="/$lens/$" params={{ lens: 'milestone', _splat: change }} replace />;
  }
  if (key && isNodeKey(key)) {
    const t = targetOf(key, 'feature');
    if (t.kind === 'node') return <Navigate to="/$lens/$" params={{ lens: t.lens, _splat: t.node }} replace />;
  }
  if (key && kindOf(key) === 'session') return <Navigate to="/session/$id" params={{ id: restOf(key) }} replace />;
  const change = data.changes[0]?.change.key;
  if (change) return <Navigate to="/$lens/$" params={{ lens: 'project', _splat: change }} replace />;
  return (
    <div className="flex flex-col gap-2 p-6 text-sm text-ink-muted">
      <div>{key ? `${key} is not something the board shows on its own.` : `Nothing resolves from ${ref}.`}</div>
      {data.resolution.tried.length > 0 && (
        <div className="text-xs text-ink-faint">Tried: {data.resolution.tried.join(', ')}</div>
      )}
    </div>
  );
}
