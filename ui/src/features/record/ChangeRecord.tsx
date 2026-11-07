// A change as the selected record, read as the ladder (change:foundation-views): its name, its gist, what it still
// needs, then the plan with the next step marked and the sections in order of depth; decisions (waiting first) by
// their name and gist; the aspects it works under, sources, sessions, children. The record pane in every lens when the
// node is a leaf change.
import type { ChangeContext, Lens } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';
import { GitBranch } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CopyRef } from '@/components/links/CopyKey';
import { DecisionGroup } from '@/components/decisions/DecisionGroup';
import { fromRow, groupHead } from '@/components/decisions/model';
import { useDecideAction } from '@/data/queries';
import { useWide } from '@/hooks/useMediaQuery';
import type { PageSearch } from '@/routes/-search';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { SourceChip } from '@/components/links/SourceChip';
import { Presence } from '@/components/presence/Presence';
import { ChangeAspectsView } from '@/features/aspects';
import { LEAD_SECTIONS, Plan, Readiness, Sections } from '@/components/record/Foundation';
import { TONE } from '@/lib/tones';

export function ChangeRecord({
  ctx,
  lens,
  liveSessions,
}: {
  ctx: ChangeContext;
  lens: Lens;
  liveSessions: Set<string>;
}) {
  const c = ctx.change;
  const ticket =
    typeof c.data.binds === 'object' && Array.isArray(c.data.binds)
      ? (c.data.binds as string[]).find((b) => /^(github-issue|linear|jira):/.test(b))
      : undefined;
  const features = Array.isArray(c.data.features) ? (c.data.features as string[]) : [];
  const decide = useDecideAction('decide');
  const reopen = useDecideAction('reopen');
  const wide = useWide();
  const search = useSearch({ strict: false }) as PageSearch;
  const navigate = useNavigate();
  const link = (decision: string | undefined) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, decision }), replace: true });
  const waiting = ctx.decisions.filter((d) => d.status === 'proposed');
  const decided = ctx.decisions.filter((d) => d.status !== 'proposed');
  return (
    <article className="flex flex-col gap-5 p-5 md:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label>{c.data.kind === 'bug' ? 'bug' : 'change'}</Label>
          <span className="text-ink-faint">·</span>
          <StatusChip status={c.status} />
          {c.data.kind === 'bug' && typeof c.data.severity === 'string' && (
            <Chip
              tone="quiet"
              className={c.data.severity === 'product' || c.data.severity === 'feature' ? TONE.alarm.text : ''}
              title="severity: where on the tree the behaviour is lost"
            >
              {c.data.severity === 'nuisance' || c.data.severity === 'cosmetic'
                ? c.data.severity
                : `${c.data.severity} out`}
            </Chip>
          )}
          {typeof c.data.target === 'string' && <Chip tone="quiet">target {c.data.target}</Chip>}
          {ticket && <SourceChip source={ctx.sources.find((s) => s.key === ticket) ?? { key: ticket }} lens={lens} />}
          {ctx.parent && (
            <NodeLink to={ctx.parent.key} lens={lens}>
              <Chip tone="quiet">↳ {short(ctx.parent.key)}</Chip>
            </NodeLink>
          )}
          {typeof c.data.project === 'string' && (
            <NodeLink to={c.data.project} lens={lens}>
              <Chip tone="quiet">{short(c.data.project)}</Chip>
            </NodeLink>
          )}
        </div>
        <h1 className="text-heading font-semibold tracking-tight">{c.name ?? c.title ?? short(c.key)}</h1>
        {c.name && c.title && c.title !== c.name && (
          <p className="text-[13px] leading-relaxed text-ink-muted">{c.title}</p>
        )}
        <Readiness needs={ctx.needs} stale={ctx.stale} migrated={ctx.migrated} />
        {ctx.branch && (
          <div
            className="flex flex-wrap items-center gap-1.5 text-meta text-ink-muted"
            title={
              ctx.branch.observed
                ? 'the branch a session was seen on'
                : 'the recommended branch, derived from the key; the worktree takes its last segment'
            }
          >
            <GitBranch className="size-3 shrink-0 text-ink-faint" aria-hidden="true" />
            <KeyText>{ctx.branch.name}</KeyText>
            {!ctx.branch.observed && <span className="text-ink-faint">recommended</span>}
            <CopyRef text={ctx.branch.name} className="text-ink-faint" />
          </div>
        )}
        {features.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {features.map((f) => {
              const [effect, key] = f.includes(' ') ? f.split(' ', 2) : ['changes', f];
              return (
                <NodeLink key={f} to={key!} lens={lens}>
                  <Chip tone="quiet">
                    {effect} {short(key!)}
                  </Chip>
                </NodeLink>
              );
            })}
          </div>
        )}
      </header>

      {ctx.next && (
        <div className="flex items-start gap-3.5 rounded-card border border-line bg-surface px-4 py-3.5">
          <Label className="shrink-0 pt-[3px]">Next</Label>
          <p className="min-w-0 flex-1">
            <span className="mr-1.5 font-mono text-meta text-ink-faint">{ctx.next.n}.</span>
            {ctx.next.step.text}
            {ctx.next.step.note && <span className="text-ink-muted"> — {ctx.next.step.note}</span>}
          </p>
        </div>
      )}

      <Sections sections={ctx.sections} only={LEAD_SECTIONS} />
      <Plan plan={ctx.plan} progress={ctx.planProgress} />
      <Sections sections={ctx.sections} omit={LEAD_SECTIONS} />

      {ctx.decisions.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Decisions</Label>
            <span className="text-meta text-ink-faint">{groupHead(waiting.length, decided.length, 'change')}</span>
          </div>
          <DecisionGroup
            decisions={ctx.decisions.map((d) => fromRow(d, c.key))}
            lens={lens}
            where="change"
            wide={wide}
            linked={search.decision}
            onLink={link}
            onDecide={decide}
            onReopen={reopen}
          />
        </section>
      )}

      {ctx.aspects && (
        <section className="flex flex-col gap-2">
          <Label>Aspects</Label>
          <ChangeAspectsView aspects={ctx.aspects} lens={lens} />
        </section>
      )}

      {ctx.children.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Beneath</Label>
            {ctx.progress && (
              <Chip tone="quiet">
                {ctx.progress.done} / {ctx.progress.total}
              </Chip>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {ctx.children.map((k) => (
              <li key={k.key} className="flex items-center gap-2 px-3.5 py-2">
                <NodeLink to={k.key} lens={lens} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                  {k.title ?? short(k.key)}
                </NodeLink>
                <StatusChip status={k.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(ctx.dependsOn.length > 0 || ctx.neededBy.length > 0) && (
        <section className="flex flex-col gap-2">
          {ctx.dependsOn.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Label>Depends on</Label>
              {ctx.dependsOn.map((d) => (
                <NodeLink key={d.key} to={d.key} lens={lens}>
                  <Chip tone="quiet" className={d.status === 'done' ? TONE.done.text : ''}>
                    {d.title && d.title.length <= 32 ? d.title : short(d.key)}
                  </Chip>
                </NodeLink>
              ))}
            </div>
          )}
          {ctx.neededBy.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Label>Needed by</Label>
              {ctx.neededBy.map((d) => (
                <NodeLink key={d.key} to={d.key} lens={lens}>
                  <Chip tone="quiet">{d.title && d.title.length <= 32 ? d.title : short(d.key)}</Chip>
                </NodeLink>
              ))}
            </div>
          )}
        </section>
      )}

      {ctx.sources.length > 0 && (
        <section className="flex flex-wrap items-center gap-2">
          <Label>Sources</Label>
          {ctx.sources.map((s) => (
            <SourceChip key={s.key} source={s} lens={lens} title={s.via} />
          ))}
        </section>
      )}

      {ctx.sessions.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <Label>Sessions</Label>
          <ul className="flex flex-col gap-1 text-xs">
            {ctx.sessions
              .slice(-6)
              .toReversed()
              .map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  {liveSessions.has(s.key) ? (
                    <Presence>
                      <NodeLink to={s.key} lens={lens} className="font-mono text-ink hover:text-primary">
                        {short(s.key).slice(0, 8)}
                      </NodeLink>
                    </Presence>
                  ) : (
                    <NodeLink to={s.key} lens={lens} className="font-mono text-ink-muted hover:text-primary">
                      {short(s.key).slice(0, 8)}
                    </NodeLink>
                  )}
                  {typeof s.data.on_behalf_of === 'string' && (
                    <span className="text-ink-faint">for {short(s.data.on_behalf_of)}</span>
                  )}
                  <span className="ml-auto text-ink-faint">
                    {ago(s.last ?? (s.data.started as string | undefined))}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
      <KeyText>{c.key}</KeyText>
    </article>
  );
}
