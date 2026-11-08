// A link to any key, following the link rule. Two modes: `select` (the default) keeps the scope and puts the key in
// the selection; `focus` makes the key the scope. Both push a history entry: a place changed, so Back undoes it.
// A key that lives in another lens is always a focus into that lens. A change focused is its own page
// (decision change-detail/own-route), and a decision is read on its change, open; on a page that is no lens (the
// change's own page) there is no selection, so every link focuses. Sessions and everything else go to their routes.
import { Link, useLocation, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Lens } from '@/data/contract';
import { changeOfDecision, kindOf, restOf, targetOf } from '@/lib/keys';

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

/** The path of a change's own page: the key after `change:`. */
export const changePath = (key: string): string => restOf(key);

export function NodeLink({ to, lens, mode: asked = 'select', children, ...rest }: NodeLinkProps) {
  const { pathname } = useLocation();
  const mode = pathname.startsWith('/change/') ? 'focus' : asked;
  // a decision is seen on its change, open: selected on the map (the decisions tab, for a milestone), else on the
  // change's page; one at product or store level goes through the getter
  const change = changeOfDecision(to);
  if (change) {
    return mode === 'select' ? (
      <Link to="." search={(prev: Search) => ({ ...selectSearch(change, 'decisions')(prev), decision: to })} {...rest}>
        {children}
      </Link>
    ) : (
      <Link to="/change/$" params={{ _splat: changePath(change) }} search={{ decision: to }} {...rest}>
        {children}
      </Link>
    );
  }
  if (kindOf(to) === 'change' && mode === 'focus') {
    return (
      <Link to="/change/$" params={{ _splat: changePath(to) }} search={{}} {...rest}>
        {children}
      </Link>
    );
  }
  const t = targetOf(to, lens);
  switch (t.kind) {
    case 'node':
      if (t.aspect) {
        const aspect = t.aspect;
        return (
          <Link
            to="/$lens/$"
            params={{ lens: t.lens, _splat: t.node }}
            search={(prev: Search) => ({ ...focusSearch(prev), aspect })}
            {...rest}
          >
            {children}
          </Link>
        );
      }
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
