// /session/:id: the board follows a session, showing what it is on in the lens that fits the key.
import { createFileRoute } from '@tanstack/react-router';
import { useSessionView } from '@/data/queries';
import { kindOf } from '@/lib/keys';
import { LensPage } from './-LensPage';
import { pageSearch } from './-search';

export const Route = createFileRoute('/session/$id')({
  validateSearch: pageSearch,
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const { data, error } = useSessionView(id);
  if (error)
    return (
      <div className="p-6 text-sm text-ink-muted">
        No session {id}: {error.message}
      </div>
    );
  if (!data) return null;
  const key = data.showing.key ?? data.showing.board ?? undefined;
  const lens = key && kindOf(key) === 'project' ? 'project' : 'feature';
  return <LensPage lens={lens} node={key} following={{ session: id, on: data.showing.key }} />;
}
