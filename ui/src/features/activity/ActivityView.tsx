// Activity: the motion beneath the node, as a view. Live sessions first, then the rail (change:activity-timeline):
// on a change its decisions are the lanes, on a milestone its children, on a feature or the product every change
// beneath it, folding beyond a handful; it opens on the last twenty rows and pages back (change:rail-pages), the
// days before the pages one strip with the health each day moved. The flat list is the rail's other rendering,
// behind its toggle.
import type { Lens, LiveSession } from '@/data/contract';
import { ago } from '@/lib/format';
import { short } from '@/lib/keys';
import { Label } from '@/components/chips/Chip';
import { NodeLink } from '@/components/links/NodeLink';
import { Presence } from '@/components/presence/Presence';
import { ActivityRail } from '@/features/rail/ActivityRail';

export function ActivityView({
  node,
  sessions,
  lens,
}: {
  /** The node the activity is beneath: a change, a milestone, a feature, the product. */
  node: string;
  sessions: LiveSession[];
  lens: Lens;
}) {
  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      <section className="flex flex-col gap-2">
        <Label>Live now</Label>
        {sessions.length === 0 ? (
          <div className="text-xs text-ink-faint">No session has moved here in the last 30 minutes.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sessions.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5"
              >
                <Presence>
                  <NodeLink to={s.key} lens={lens} className="font-mono text-meta text-ink hover:text-primary">
                    {short(s.key).slice(0, 8)}
                  </NodeLink>
                </Presence>
                {s.on && (
                  <span className="text-xs text-ink-muted">
                    on{' '}
                    <NodeLink to={s.on} lens={lens} className="text-ink hover:text-primary">
                      {short(s.on)}
                    </NodeLink>
                  </span>
                )}
                {s.onBehalfOf && <span className="text-xs text-ink-faint">for {short(s.onBehalfOf)}</span>}
                <span className="ml-auto text-meta text-ink-faint">{ago(s.last)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ActivityRail scope={node} lens={lens} limit={20} />
    </div>
  );
}
