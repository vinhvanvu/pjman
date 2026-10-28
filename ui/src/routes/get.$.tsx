// /get/*: anything in, the right page out. A node key opens its lens; a ticket or file opens the change in reach;
// a decision opens its change in the feature lens; a project, which has no lens, is shown here with its changes.
// What cannot be resolved says what was tried.
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useResolve, useScope } from '@/data/queries';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { changeOfDecision, isNodeKey, kindOf, restOf, short, targetOf } from '@/lib/keys';

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
  const onChange = key ? changeOfDecision(key) : undefined;
  if (onChange) return <Navigate to="/$lens/$" params={{ lens: 'feature', _splat: onChange }} replace />;
  if (key && isNodeKey(key)) {
    const t = targetOf(key, 'feature');
    if (t.kind === 'node') return <Navigate to="/$lens/$" params={{ lens: t.lens, _splat: t.node }} replace />;
  }
  if (key && kindOf(key) === 'session') return <Navigate to="/session/$id" params={{ id: restOf(key) }} replace />;
  if (key && kindOf(key) === 'project') return <ProjectPage project={key} />;
  const change = data.changes[0]?.change.key;
  if (change) return <Navigate to="/$lens/$" params={{ lens: 'feature', _splat: change }} replace />;
  return (
    <div className="flex flex-col gap-2 p-6 text-sm text-ink-muted">
      <div>{key ? `${key} is not something the board shows on its own.` : `Nothing resolves from ${ref}.`}</div>
      {data.resolution.tried.length > 0 && (
        <div className="text-xs text-ink-faint">Tried: {data.resolution.tried.join(', ')}</div>
      )}
    </div>
  );
}

/** A project has no lens: its open changes, from the store-wide scope, as cards that open in the feature lens. */
function ProjectPage({ project }: { project: string }) {
  const { data } = useScope({ lens: 'feature' });
  const rows = data?.changes.filter((r) => r.project === project) ?? [];
  return (
    <section className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <span className="label">project</span>
        <h1 className="text-heading font-semibold tracking-tight">{short(project)}</h1>
        <p className="text-xs text-ink-muted">
          A project is where the code lives. Its work is seen through the product map and the roadmap; these are its
          open changes.
        </p>
      </header>
      {data && rows.length === 0 && <p className="text-xs text-ink-faint">No open changes in this project.</p>}
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <ChangeCard key={r.key} row={r} lens="feature" />
        ))}
      </div>
    </section>
  );
}
