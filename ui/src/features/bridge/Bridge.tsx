// The bridge's content: for now the need strip across the width. The stage (the lineage graph lit by sessions), the
// lanes and the transport come in later slices; the strip then moves to the right column (decision
// stage-strip-transport).
import type { Bridge as BridgeData, Lens } from '@/data/contract';
import { plural } from '@/lib/format';
import { Strip } from './Strip';

export function Bridge({ data, lens, productName }: { data: BridgeData; lens: Lens; productName: string }) {
  const working = data.sessions.filter((s) => s.state === 'working').length;
  return (
    <div className="flex flex-col gap-5 p-5 md:p-6" data-scroll-restoration-id="bridge">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-section font-semibold">Sessions by need</h2>
        <span className="text-meta text-ink-faint">
          {plural(data.sessions.length, 'session')} across {productName} in the last{' '}
          {data.days === 1 ? 'day' : plural(data.days, 'day')}
          {working ? ` · ${working} working` : ''}
          {data.waiting ? ` · ${data.waiting} ${data.waiting === 1 ? 'waits' : 'wait'} on you` : ''}
        </span>
      </div>
      <Strip sessions={data.sessions} lens={lens} className="max-w-[720px]" />
    </div>
  );
}
