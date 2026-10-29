import { describe, expect, it } from 'vitest';
import type { StoreEvent } from '@/data/contract';
import { dockArrivals } from './model';

const ev = (seq: number, over: Partial<StoreEvent>): StoreEvent => ({
  seq,
  at: '2026-10-28T10:00:00Z',
  op: 'set',
  key: 'change:pjman/x',
  type: 'change',
  path: '',
  ...over,
});

describe('dockArrivals', () => {
  const S = 'session:s';
  const C = 'change:pjman/x';
  const events = [
    ev(1, { type: 'session', op: 'log', key: S }),
    ev(2, { fields: ['next'] }),
    ev(3, { fields: ['status'] }),
    ev(4, { type: 'decision', op: 'created', key: 'decision:pjman/x/pick' }),
    ev(5, { key: 'change:pjman/elsewhere', fields: ['next'] }),
  ];
  it('takes the newest arrival on each part the dock draws, and nothing from another change or session', () => {
    const a = dockArrivals(events, S, C);
    expect(a.line?.seq).toBe(1);
    expect(a.next?.seq).toBe(2);
    expect(a.status?.seq).toBe(3);
    expect([...a.opened.keys()]).toEqual(['decision:pjman/x/pick']);
    expect(a.any?.seq).toBe(4);
  });
  it('counts a write stamped with the session as its own, whatever it wrote', () => {
    expect(dockArrivals([ev(9, { key: 'feature:pjman/y', type: 'feature', session: S })], S).any?.seq).toBe(9);
  });
});
