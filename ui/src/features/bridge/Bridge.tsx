// The bridge's content: for now the need strip across the width, what waits on the person first at the grain of the
// decision, then the sessions by state. The transport stands above it (the page's route); held at a moment, the
// heading says which, and locked on an event, the cards it touched are outlined. The stage (the lineage graph lit by
// sessions) and the lanes come in later slices; the strip then moves to the right column (decision
// stage-strip-transport).
import type { Bridge as BridgeData, Lens } from '@/data/contract';
import { momentWords } from '@/features/moment';
import { plural } from '@/lib/format';
import { useCursor, useResolved } from '@/state/moment';
import { Strip, type Touched } from './Strip';

export function Bridge({
  data,
  lens,
  productName,
  touched,
}: {
  data: BridgeData;
  lens: Lens;
  productName: string;
  touched?: Touched;
}) {
  const working = data.sessions.filter((s) => s.state === 'working').length;
  const cursor = useCursor();
  const resolved = useResolved();
  const held = cursor.at || cursor.event ? momentWords(cursor, resolved) : undefined;
  return (
    <div className="flex flex-col gap-5 p-5 md:p-6" data-scroll-restoration-id="bridge">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-section font-semibold">
          Sessions by need{held && <span className="font-normal text-status-review">, {held}</span>}
        </h2>
        <span className="text-meta text-ink-faint">
          {plural(data.sessions.length, 'session')} across {productName} in the last{' '}
          {data.days === 1 ? 'day' : plural(data.days, 'day')}
          {working ? ` · ${working} working` : ''}
          {data.waiting ? ` · ${plural(data.waiting, 'decision')} on you` : ''}
        </span>
      </div>
      <Strip
        waitingOn={data.waitingOn}
        sessions={data.sessions}
        lens={lens}
        touched={touched}
        className="max-w-[720px]"
      />
    </div>
  );
}
