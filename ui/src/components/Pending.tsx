// What a pane shows while its data is on the way: nothing at first, so a load that lands within a beat paints no
// placeholder and nothing blinks; the words only once the wait is long enough to notice.
import { cn } from 'cn';
import { useEffect, useState } from 'react';

const DELAY_MS = 300;

export function Pending({ className }: { className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={cn('p-6 text-xs text-ink-faint', className)} aria-busy="true">
      {shown ? 'Loading…' : null}
    </div>
  );
}
