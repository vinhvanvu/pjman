// The session page when the store has no view for the id. A session on its way (the pane is pointed at the page
// before the record is written) is waited for, in the words a load uses, and the stream's invalidation brings the
// page in with the record; one the store never learns is said plainly, with the way back to the product; a failure
// of the server is said as it is. Mounted per id, so a new id starts its own window.
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError } from '@/data/client';
import { absence, STARTING_MS } from './model';

export function SessionAbsent({ id, error }: { id: string; error: Error }) {
  const status = error instanceof ApiError ? error.status : undefined;
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), STARTING_MS);
    return () => clearTimeout(t);
  }, []);
  const state = absence(status, waited);
  if (state === 'starting')
    return (
      <div className="p-6 text-xs text-ink-faint" aria-busy="true">
        Waiting for the session to start…
      </div>
    );
  if (state === 'none')
    return (
      <EmptyState
        title={`No session ${id}.`}
        hint={
          <>
            <div>
              The store has no record of it. A session that starts on this id will show here when its record is written.
            </div>
            <Link to="/" className="mt-2 inline-block text-ink-muted hover:text-ink">
              Back to the product
            </Link>
          </>
        }
        className="m-6 text-sm"
      />
    );
  return <EmptyState title="The session page could not load." hint={error.message} className="m-6 text-sm" />;
}
