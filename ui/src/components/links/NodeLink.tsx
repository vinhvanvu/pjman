// A link to any key, following the link rule: the current lens when the node lives there, else its home lens; sessions
// and everything else go to their own routes. Routes keep their search (view, flags) when the lens does not change.
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Lens } from '@/data/contract';
import { targetOf } from '@/lib/keys';

export interface NodeLinkProps extends Omit<LinkProps, 'to' | 'params' | 'search' | 'children'> {
  to: string;
  lens: Lens;
  className?: string;
  title?: string;
  children?: ReactNode;
  /** Keep the current search params (view, done, days) when staying in the same lens. */
  keepSearch?: boolean;
}

export function NodeLink({ to, lens, keepSearch = true, children, ...rest }: NodeLinkProps) {
  const t = targetOf(to, lens);
  switch (t.kind) {
    case 'node':
      return (
        <Link
          to="/$lens/$"
          params={{ lens: t.lens, _splat: t.node }}
          search={(prev: Record<string, unknown>) => (keepSearch && t.lens === lens ? prev : {})}
          {...rest}
        >
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
        <a href={t.url} target="_blank" rel="noreferrer" className={rest.className}>
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
