// A change as the selected record: status and ticket, the next line first, summary and plan, decisions (waiting first),
// sources, sessions, children. The record pane in every lens when the node is a leaf change.
import type { ChangeContext, Lens } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';
import { GitBranch } from 'lucide-react';
import { CopyRef } from '@/components/cards/DecisionRows';
import { Chip, KeyText, Label, StatusChip } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Presence } from '@/components/presence/Presence';

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
              className={c.data.severity === 'product' || c.data.severity === 'feature' ? 'text-status-blocked' : ''}
              title="severity: where on the tree the behaviour is lost"
            >
              {c.data.severity === 'nuisance' || c.data.severity === 'cosmetic'
                ? c.data.severity
                : `${c.data.severity} out`}
            </Chip>
          )}
          {typeof c.data.target === 'string' && <Chip tone="quiet">target {c.data.target}</Chip>}
          {ticket && (
            <NodeLink to={ticket} lens={lens}>
              <Chip tone="quiet" mono>
                {short(ticket)}
              </Chip>
            </NodeLink>
          )}
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
        <h1 className="text-heading font-semibold tracking-tight">{c.title}</h1>
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

      {typeof c.data.next === 'string' && c.data.next && (
        <div className="flex items-start gap-3.5 rounded-card border border-line bg-surface px-4 py-3.5">
          <Label className="shrink-0 pt-[3px]">Next</Label>
          <p className="min-w-0 flex-1">{c.data.next}</p>
        </div>
      )}

      {ctx.summary && (
        <section className="flex flex-col gap-1.5">
          <Label>Summary</Label>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-muted">{ctx.summary}</p>
        </section>
      )}
      {ctx.plan && (
        <section className="flex flex-col gap-1.5">
          <Label>Plan</Label>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-muted">{ctx.plan}</p>
        </section>
      )}

      {ctx.decisions.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Label>Decisions</Label>
            {waiting.length > 0 && (
              <Chip tone="quiet" className="text-status-review">
                {waiting.length} waiting
              </Chip>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {[...waiting, ...decided].map((d) => (
              <li key={d.key} className="flex flex-col gap-1 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-[7px] shrink-0 rounded-full ${d.status === 'proposed' ? 'bg-status-review' : 'bg-status-done'}`}
                    aria-hidden="true"
                  />
                  <NodeLink to={d.key} lens={lens} className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                    {d.title ?? short(d.key)}
                  </NodeLink>
                  <span className="text-meta text-ink-faint">{d.status}</span>
                </div>
                {d.decision && <p className="line-clamp-2 text-xs text-ink-muted">{d.decision}</p>}
              </li>
            ))}
          </ul>
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
                  <Chip tone="quiet" className={d.status === 'done' ? 'text-status-done' : ''}>
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
            <NodeLink key={s.key} to={s.key} lens={lens}>
              <Chip tone="quiet" mono title={s.via}>
                {short(s.key)}
              </Chip>
            </NodeLink>
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
