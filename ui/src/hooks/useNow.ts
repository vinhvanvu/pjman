// A clock that ticks: what "40 s ago" is measured against, so a row's last touch keeps reading true while the page is
// open. One interval per mount.
import { useEffect, useState } from 'react';

export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
