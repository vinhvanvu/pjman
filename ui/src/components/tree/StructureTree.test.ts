import { describe, expect, it } from 'vitest';
import type { ScopeNode } from '@/data/contract';
import { indexNodes, keysExpanded, ROOT } from './StructureTree';

const node = (key: string, type: ScopeNode['type'], children: ScopeNode[] = []): ScopeNode => ({
  key,
  type,
  owners: [],
  open: 0,
  inFlight: 0,
  projects: [],
  childCount: 0,
  children,
});
// change:bridge names three features and the one above them, so it is drawn under each (change:beneath-duplicate-rows)
const shared = () => node('change:bridge', 'change');
const tree = [
  node('feature:lanes', 'feature', [shared()]),
  node('feature:strip', 'feature', [shared()]),
  node('feature:transport', 'feature', [shared(), node('change:scrub', 'change')]),
  shared(),
];

describe('indexNodes', () => {
  it('gives each row of a key drawn more than once its own id', () => {
    const ix = indexNodes(tree);
    expect(ix.idsOf.get('change:bridge')).toHaveLength(4);
    expect(ix.children.get('feature:lanes')).toHaveLength(1);
    expect(ix.children.get('feature:transport')).toHaveLength(2);
    expect(ix.children.get(ROOT)).toEqual(['feature:lanes', 'feature:strip', 'feature:transport', 'change:bridge']);
    for (const id of ix.idsOf.get('change:bridge')!) expect(ix.items.get(id)?.key).toBe('change:bridge');
  });
});

describe('keysExpanded', () => {
  const nested = [
    node('feature:a', 'feature', [node('change:m', 'change', [node('change:k', 'change')])]),
    node('feature:b', 'feature', [node('change:m', 'change', [node('change:k', 'change')])]),
  ];
  const ix = indexNodes(nested);
  const [inA, inB] = ix.idsOf.get('change:m')! as [string, string];

  it('opens a key when one of its rows opens', () => {
    expect(keysExpanded(ix, ['feature:a'], ['feature:a', inA])).toEqual(['feature:a', 'change:m']);
  });
  it('closes a key when one of its rows closes, though another row of it was open', () => {
    expect(keysExpanded(ix, ['feature:a', 'feature:b', 'change:m'], ['feature:a', 'feature:b', inB])).toEqual([
      'feature:a',
      'feature:b',
    ]);
  });
  it('keeps keys this tree does not draw', () => {
    expect(keysExpanded(ix, ['feature:gone'], ['feature:a'])).toEqual(['feature:gone', 'feature:a']);
  });
});
