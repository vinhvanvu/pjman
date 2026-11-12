// /follow: the follow window (change:follow-window). Opening it makes this tab the window that moves to the session
// the person prompts; it goes at once to the one prompted last, or waits for the first prompt.
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { BASE } from '@/data/client';
import { sessionId } from '@/features/session-follow';
import { useFollow } from '@/state/follow';

export const Route = createFileRoute('/follow')({
  component: FollowPage,
});

function FollowPage() {
  const becomeWindow = useFollow((s) => s.becomeWindow);
  const home = useFollow((s) => s.home);
  const navigate = useNavigate();
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    becomeWindow();
    let gone = false;
    void fetch(`${BASE}/follow`)
      .then(async (r) => {
        if (!r.ok) return null;
        const body: { data: { followed: { session: string } | null } } = await r.json();
        return body;
      })
      .then((body) => {
        if (gone) return;
        const to = body?.data.followed?.session ?? (home ? `session:${home}` : undefined);
        if (to) void navigate({ to: '/session/$id', params: { id: sessionId(to) }, search: {}, replace: true });
        else setAsked(true);
      })
      .catch(() => !gone && setAsked(true));
    return () => {
      gone = true;
    };
  }, [becomeWindow, home, navigate]);
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-sm font-medium text-ink">Follow window</h1>
        <p className="text-xs text-ink-muted">
          {asked
            ? 'Waiting for a prompt: this window shows the session you type into next.'
            : 'Finding the session you are on…'}
        </p>
      </div>
    </main>
  );
}
