// The selected node of the product map: name, state, the roll-up, owners, and the changes at it as cards. The same
// shape for a product, a feature and a capability.
import type { Lens, Scope } from '@/data/contract';
import { plural, sinceDays } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { ChangeCard } from '@/components/cards/ChangeCard';
import { EmptyState } from '@/components/EmptyState';
import { NodeLink } from '@/components/links/NodeLink';
import { Figures } from '@/components/stats/Figures';
import { changesBeneath, changesHere } from './model';

export function FeatureDetail({ scope, lens }: { scope: Scope; lens: Lens }) {
  const node = scope.node;
  const here = changesHere(scope.tree);
  const beneath = changesBeneath(scope);
  // at the root of a product the list beneath is the whole backlog: summarise it by feature instead of listing it
  const summarise = node?.type === 'product' || beneath.reduce((n, g) => n + g.rows.length, 0) > 12;
  const h = scope.health;
  const parent = scope.crumbs.at(-1);
  const state = node?.derived ?? node?.status;
  const title = node ? (node.name ?? node.title ?? short(node.key)) : 'Everything';
  const showProject = scope.projects.length > 1;

  return (
    <section aria-label={title} className="flex flex-col gap-5 p-5 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Label>{node?.level ?? 'store'}</Label>
          {state && (
            <>
              <span className="text-ink-faint">·</span>
              <StatusChip status={state} className={STATE_TONE[state] ?? ''} />
            </>
          )}
        </div>
        <h1 className="text-heading font-semibold tracking-tight">{title}</h1>
        {node?.name && node.title && node.title !== node.name && (
          <p className="text-[13.5px] text-ink-muted">{node.title}</p>
        )}
        {node?.summary && !node.name && <p className="text-[13.5px] text-ink-muted">{node.summary}</p>}
      </header>

      <Figures
        figures={[
          {
            value: sinceDays(h.staleDays),
            label: 'last moved',
            tone: h.staleDays !== null && h.staleDays > h.days ? 'text-status-review' : undefined,
          },
          { value: h.created, label: `new in ${h.days} days` },
          { value: h.done, label: `done in ${h.days} days` },
          { value: h.waiting, label: 'waiting on you', tone: h.waiting ? 'text-status-review' : undefined },
        ]}
      />

      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
        <dt className="text-ink-faint">Owner</dt>
        <dd className="flex items-center gap-2">
          {scope.owners.owners.length ? (
            scope.owners.owners.map((o) => short(o)).join(', ')
          ) : (
            <span className="text-ink-faint">nobody yet</span>
          )}
          {scope.owners.from && scope.owners.from !== node?.key && (
            <span className="text-ink-faint">· from {short(scope.owners.from)}</span>
          )}
        </dd>
        {parent && (
          <>
            <dt className="text-ink-faint">Parent</dt>
            <dd>
              <NodeLink to={parent.key} lens={lens} className="hover:text-primary">
                {parent.name ?? parent.title ?? short(parent.key)}
              </NodeLink>
            </dd>
          </>
        )}
        {node && (
          <>
            <dt className="text-ink-faint">Beneath</dt>
            <dd className="text-ink-muted">
              {plural(scope.tree.filter((n) => n.type === 'feature').length, 'capability', 'capabilities')} ·{' '}
              {plural(scope.changes.length, 'open change')}
              {scope.projects.length > 1 ? ` across ${plural(scope.projects.length, 'project')}` : ''}
            </dd>
            <dt className="text-ink-faint">Key</dt>
            <dd>
              <KeyText>{node.key}</KeyText>
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <Label>Changes here</Label>
          <span className="text-meta text-ink-faint">
            {here.length}
            {beneath.length ? ` · ${beneath.reduce((n, g) => n + g.rows.length, 0)} beneath` : ''}
          </span>
        </div>
        {here.length === 0 && beneath.length === 0 && (
          <EmptyState
            title="Nothing open here."
            hint="A change names this feature with --features when it touches it."
          />
        )}
        {here.map((r) => (
          <ChangeCard key={r.key} row={r} lens={lens} showProject={showProject} />
        ))}
        {summarise && beneath.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label className="mt-1">Beneath, by feature</Label>
            <div className="flex flex-wrap gap-1.5">
              {beneath.map((g) => (
                <NodeLink key={g.feature.key} to={g.feature.key} lens={lens}>
                  <Chip tone="quiet" className="h-6 gap-2 px-2.5 hover:text-ink">
                    {g.feature.name ?? g.feature.title}
                    <span className="text-ink-faint">{g.rows.length}</span>
                  </Chip>
                </NodeLink>
              ))}
            </div>
          </div>
        )}
        {!summarise &&
          beneath.map((g) => (
            <div key={g.feature.key} className="flex flex-col gap-2.5">
              <div className="mt-1 flex items-center gap-2">
                <Label>Beneath · {g.feature.name ?? g.feature.title}</Label>
                <Chip tone="quiet">{g.rows.length}</Chip>
              </div>
              {g.rows.map((r) => (
                <ChangeCard key={r.key} row={r} lens={lens} showProject={showProject} className="opacity-90" />
              ))}
            </div>
          ))}
      </div>
    </section>
  );
}

const STATE_TONE: Record<string, string> = {
  live: 'text-state-live',
  building: 'text-state-building',
  planned: 'text-ink-faint',
  retired: 'text-state-retired',
};
