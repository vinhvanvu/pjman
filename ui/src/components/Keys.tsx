import { Link } from 'react-router-dom';

/** A key as a link to its page: a change, a decision, a source, a session, a project. */
export function Key({ k, children }: { k: string; children?: React.ReactNode }) {
  const i = k.indexOf(':');
  const kind = k.slice(0, i);
  const rest = k.slice(i + 1);
  const to = kind === 'project' ? `/board/${rest}` : kind === 'session' ? `/session/${encodeURIComponent(rest)}` : `/get/${encodeURIComponent(k)}`;
  return (
    <Link to={to} className={`key kind-${kind}`}>
      {children ?? k}
    </Link>
  );
}

export function Status({ s }: { s?: string }) {
  return s ? <span className={`status status-${s}`}>{s}</span> : null;
}

export const MARK: Record<string, string> = { proposed: '○', decided: '●', superseded: '◌', reverted: '⊘' };
