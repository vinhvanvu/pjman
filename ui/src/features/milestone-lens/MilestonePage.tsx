// The milestone as a goal page: a large ring, the next line first, what leads to completion from three sides (changes
// beneath, features touched, projects involved), the decisions, and what blocks it.
import { Check } from 'lucide-react';
import type { ChangeContext, Lens, Scope, ScopeNode } from '@/data/contract';
import { plural, sinceDays } from '@/lib/format';
import { short } from '@/lib/keys';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Figures } from '@/components/stats/Figures';
import { Ring } from './Ring';
import { childrenByStatus, decided, featuresTouched, projectsInvolved, proposed, rowsBeneath } from './model';

export function MilestonePage({
  scope,
  ctx,
  lens,
  node,
}: {
  scope: Scope;
  ctx: ChangeContext;
  lens: Lens;
  node?: ScopeNode;
}) {
  const p = ctx.progress ?? { done: 0, total: 0 };
  const rows = node ? rowsBeneath(node) : scope.changes;
  const touched = featuresTouched(rows);
  const projects = projectsInvolved(rows);
  const groups = childrenByStatus(ctx);
  const yes = decided(ctx);
  const open = proposed(ctx);
  const c = ctx.change;
  return (
    <article className="flex flex-col gap-6 p-5 md:px-8 md:py-6">
      <header className="flex items-start gap-6">
        <Ring done={p.done} total={p.total} size={112} stroke={8}>
          <span className="text-center">
            <span className="block text-[26px] leading-none font-semibold tracking-tight">
              {p.done}
              <span className="text-sm font-medium text-ink-faint"> / {p.total}</span>
            </span>
            <span className="mt-1 block text-label text-ink-faint">done</span>
          </span>
        </Ring>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label>milestone</Label>
            <span className="text-ink-faint">·</span>
            <StatusChip status={c.status} />
            {ctx.parent && (
              <NodeLink to={ctx.parent.key} lens={lens}>
                <Chip tone="quiet">↳ {short(ctx.parent.key)}</Chip>
              </NodeLink>
            )}
            {typeof c.data.project === 'string' && <Chip tone="quiet">{short(c.data.project)}</Chip>}
          </div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{c.title}</h1>
          {ctx.summary && <p className="max-w-[640px] text-ink-muted">{ctx.summary}</p>}
        </div>
      </header>

      {typeof c.data.next === 'string' && c.data.next && (
        <div className="flex items-start gap-3.5 rounded-card border border-line bg-surface px-4 py-3.5">
          <Label className="shrink-0 pt-[3px]">Next</Label>
          <p className="min-w-0 flex-1">{c.data.next}</p>
        </div>
      )}

      <Figures
        dense
        figures={[
          { value: ctx.children.length, label: ctx.children.length === 1 ? 'change beneath' : 'changes beneath' },
          {
            value: yes.length,
            label: open.length ? `decided · ${open.length} waiting` : 'decisions, all decided',
            tone: open.length ? 'text-status-review' : undefined,
          },
          { value: ctx.sources.length, label: 'sources' },
          { value: sinceDays(scope.health.staleDays), label: 'last moved' },
        ]}
      />

      <div className="grid gap-7 md:grid-cols-2">
        <section className="flex flex-col gap-1.5">
          <Label className="px-3 pb-1.5">Beneath</Label>
          {groups.length === 0 && (
            <p className="px-3 text-xs text-ink-faint">
              No children yet. A change names this one as its parent to count here.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.status} className="flex flex-col">
              {g.rows.map((r) => (
                <NodeLink
                  key={r.key}
                  to={r.key}
                  lens={lens}
                  className="flex h-10 items-center gap-3 rounded-lg px-3 hover:bg-raised"
                >
                  <span
                    className={
                      r.status === 'done'
                        ? 'grid size-4 place-items-center rounded-full bg-status-done'
                        : 'size-4 rounded-full border-[1.5px] border-line-strong'
                    }
                  >
                    {r.status === 'done' && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title ?? short(r.key)}</span>
                  <StatusChip status={r.status} />
                </NodeLink>
              ))}
            </div>
          ))}
          <p className="px-3 pt-1.5 text-xs text-ink-faint">
            Children in any project count here. Dropped ones never do.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <Label className="px-3 pb-1.5">{open.length ? 'Decisions' : 'Decided'}</Label>
          {ctx.decisions.length === 0 && <p className="px-3 text-xs text-ink-faint">No decisions recorded yet.</p>}
          {[...open, ...yes].map((d) => (
            <NodeLink
              key={d.key}
              to={d.key}
              lens={lens}
              className="flex h-8 items-center gap-3 rounded-lg px-3 hover:bg-raised"
            >
              <span
                className={
                  d.status === 'decided'
                    ? 'grid size-4 place-items-center rounded-full bg-status-done'
                    : 'size-4 rounded-full border-[1.5px] border-status-review'
                }
              >
                {d.status === 'decided' && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{d.title ?? short(d.key)}</span>
              {d.status !== 'decided' && <span className="text-meta text-status-review">waiting</span>}
            </NodeLink>
          ))}
        </section>
      </div>

      {touched.length > 0 && (
        <section className="flex flex-wrap items-center gap-2">
          <Label>Features touched</Label>
          {touched.map((t) => (
            <NodeLink key={t.key} to={t.key} lens={lens}>
              <Chip tone="quiet" title={[...t.effects].join(', ')}>
                {t.effects.has('adds') ? 'adds ' : t.effects.has('removes') ? 'removes ' : ''}
                {t.title && t.title.length <= 28 ? t.title : short(t.key)}
              </Chip>
            </NodeLink>
          ))}
        </section>
      )}
      {projects.length > 0 && (
        <section className="flex flex-wrap items-center gap-2">
          <Label>Projects involved</Label>
          {projects.map((k) => (
            <NodeLink key={k} to={k} lens={lens}>
              <Chip tone="quiet">{short(k)}</Chip>
            </NodeLink>
          ))}
        </section>
      )}
      {ctx.sources.length > 0 && (
        <section className="flex flex-wrap items-center gap-2">
          <Label>Sources</Label>
          {ctx.sources.map((s) => (
            <NodeLink key={s.key} to={s.key} lens={lens}>
              <Chip tone="quiet" mono>
                {short(s.key)}
              </Chip>
            </NodeLink>
          ))}
        </section>
      )}
      <KeyText>{c.key}</KeyText>
      <span className="sr-only">{plural(rows.length, 'change')} beneath</span>
    </article>
  );
}
