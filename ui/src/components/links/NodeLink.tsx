// A link to any key, following the link rule. Two modes: `select` (the default) keeps the scope and puts the key in
// the selection; `focus` makes the key the scope. Both push a history entry: a place changed, so Back undoes it.
// A key that lives in another lens is always a focus into that lens. Sessions and everything else go to their routes.
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Lens } from '@/data/contract';
import { changeOfDecision, targetOf } from '@/lib/keys';

export interface NodeLinkProps extends Omit<LinkProps, 'to' | 'params' | 'search' | 'children' | 'replace'> {
  to: string;
  lens: Lens;
  mode?: 'select' | 'focus';
  className?: string;
  title?: string;
  children?: ReactNode;
}

type Search = Record<string, unknown>;

/** The search that selects a key in the current scope: the selection changes, the tab resets. */
export const selectSearch =
  (key: string, tab?: string) =>
  (prev: Search): Search => ({ ...prev, sel: key, tab });

/** The search that focuses: a new scope starts clean, but the window and the hidden flags stay. */
export const focusSearch = (prev: Search): Search => ({
  view: prev.view,
  group: prev.group,
  done: prev.done,
  retired: prev.retired,
  days: prev.days,
});

export function NodeLink({ to, lens, mode = 'select', children, ...rest }: NodeLinkProps) {
  // a decision is seen on its change, in the decisions tab; one at product or store level goes through the getter
  const change = changeOfDecision(to);
  if (change) {
    return (
      <Link to="." search={selectSearch(change, 'decisions')} {...rest}>
        {children}
      </Link>
    );
  }
  const t = targetOf(to, lens);
  switch (t.kind) {
    case 'node':
      if (mode === 'select' && t.lens === lens) {
        return (
          <Link to="." search={selectSearch(t.node)} {...rest}>
            {children}
          </Link>
        );
      }
      return (
        <Link to="/$lens/$" params={{ lens: t.lens, _splat: t.node }} search={focusSearch} {...rest}>
          {children}
        </Link>
      );
    case 'session':
      return (
        <Link to="/session/$id" params={{ id: t.id }} {...rest}>
          {children}
        </Link>
      );
    case 'external':
      return (
        <a href={t.url} target="_blank" rel="noreferrer" className={rest.className} title={rest.title}>
          {children}
        </a>
      );
    default:
      return (
        <Link to="/get/$" params={{ _splat: t.key }} {...rest}>
          {children}
        </Link>
      );
  }
}
