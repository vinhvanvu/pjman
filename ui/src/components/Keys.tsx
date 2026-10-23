import { createContext, useContext } from 'react';
import { Link } from 'react-router-dom';
import type { Lens } from '../api';

/** The lens the page is in: links to nodes of the tree stay in it. */
export const LensContext = createContext<Lens>('feature');

const NODE_KINDS = new Set(['product', 'feature', 'project', 'change']);

/** Where a key leads: a node of the tree in the current lens, a session's page, anything else through the getter. */
export function hrefOf(k: string, lens: Lens): string {
  const i = k.indexOf(':');
  if (i < 0) return `/get/${encodeURIComponent(k)}`;
  const kind = k.slice(0, i);
  const rest = k.slice(i + 1);
  if (NODE_KINDS.has(kind)) return `/${lens}/${k}`;
  if (kind === 'session') return `/session/${encodeURIComponent(rest)}`;
  return `/get/${encodeURIComponent(k)}`;
}

export function useHref(): (k: string) => string {
  const lens = useContext(LensContext);
  return (k) => hrefOf(k, lens);
}

/** A key as a link to its page. */
export function Key({ k, children, className }: { k: string; children?: React.ReactNode; className?: string }) {
  const href = useHref();
  const kind = k.slice(0, Math.max(0, k.indexOf(':')));
  return (
    <Link to={href(k)} className={className ?? `key kind-${kind}`}>
      {children ?? k}
    </Link>
  );
}

export function Status({ s }: { s?: string }) {
  return s ? <span className={`status status-${s}`}>{s}</span> : null;
}

export const MARK: Record<string, string> = { proposed: '○', decided: '●', superseded: '◌', reverted: '⊘' };

/** `person:vinh` → `vinh`; `project:web` → `web`. */
export const short = (k: string): string => k.slice(k.indexOf(':') + 1);

/** A short relative time: just now, 5m, 3h, 2d, 3w. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 21) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}
