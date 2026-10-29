// /session/:id: the page that follows a session. Opening it adopts the session for this tab, so the pill brings the
// person back from anywhere. The scope is what the session is on; a session with no change yet stands at its product.
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSessionView } from '@/data/queries';
import { kindOf } from '@/lib/keys';
import { useFollow } from '@/state/follow';
import { Pending } from '@/components/Pending';
import { LensPage } from './-LensPage';
import { pageSearch } from './-search';

export const Route = createFileRoute('/session/$id')({
  validateSearch: pageSearch,
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const adopt = useFollow((s) => s.adopt);
  useEffect(() => adopt(id), [id, adopt]);
  const { data, error } = useSessionView(id);
  if (error)
    return (
      <div className="p-6 text-sm text-ink-muted">
        No session {id}: {error.message}
      </div>
    );
  if (!data) return <Pending />;
  const key = data.showing.key;
  // what the session is on; a session on no change is followed at its product (its project has no lens of its own)
  const node = key && kindOf(key) !== 'project' ? key : data.session?.product;
  return <LensPage lens="feature" node={node} following={{ session: id, view: data }} />;
}
