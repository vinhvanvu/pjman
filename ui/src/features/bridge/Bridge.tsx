// The bridge's content in the canvas's columns (decision stage-strip-transport): the lanes on the left, the sessions
// over the transport's window, and the need strip on the right, what waits on the person first at the grain of the
// decision, then the sessions by state. The transport stands above both (the page's route); held at a moment, the
// heading says which, and locked on an event, the cards it touched are outlined. The stage (the lineage graph lit by
// sessions) comes last, above the lanes.
import type { Bridge as BridgeData, Lens } from '@/data/contract';
import { momentWords } from '@/features/moment';
import { plural } from '@/lib/format';
import { useCursor, useResolved } from '@/state/moment';
import { Lanes } from './Lanes';
import { Strip, type Touched } from './Strip';
import { TONE } from '@/lib/tones';
import { cn } from 'cn';

export function Bridge({
  data,
  lens,
  product,
  productName,
  touched,
}: {
  data: BridgeData;
  product: string;
  lens: Lens;
  productName: string;
  touched?: Touched;
}) {
  const working = data.sessions.filter((s) => s.state === 'working').length;
  const cursor = useCursor();
  const resolved = useResolved();
  const held = cursor.at || cursor.event ? momentWords(cursor, resolved) : undefined;
  return (
    <div className="flex flex-col gap-5 p-5 md:p-6 lg:h-full lg:min-h-0" data-scroll-restoration-id="bridge">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 className="text-section font-semibold">
          Sessions by need{held && <span className={cn('font-normal', TONE.waits.text)}>, {held}</span>}
        </h2>
        <span className="text-meta text-ink-faint">
          {plural(data.sessions.length, 'session')} across {productName} in the last{' '}
          {data.days === 1 ? 'day' : plural(data.days, 'day')}
          {working ? ` · ${working} working` : ''}
          {data.waiting ? ` · ${plural(data.waiting, 'decision')} on you` : ''}
        </span>
      </div>
      {/* the canvas's columns: what shows on the left (the lanes now, the stage above them later), what commands on
          the right, each scrolling on its own at desktop width; narrow, they stack and the page scrolls */}
      <div className="flex flex-wrap items-start gap-5 lg:min-h-0 lg:flex-1 lg:flex-nowrap lg:items-stretch">
        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 lg:overflow-y-auto">
          <Lanes product={product} sessions={data.sessions} />
        </div>
        <Strip
          waitingOn={data.waitingOn}
          sessions={data.sessions}
          lens={lens}
          touched={touched}
          className="min-w-0 flex-[1_1_360px] lg:w-[380px] lg:flex-none lg:overflow-y-auto lg:pr-1"
        />
      </div>
    </div>
  );
}
