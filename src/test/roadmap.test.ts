import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveTarget, violations, worstSeverity, type RoadmapRow } from '../model/roadmap.js';

const row = (key: string, r: Partial<RoadmapRow> = {}): RoadmapRow => ({ key: `change:${key}`, dependsOn: [], ...r });
const TODAY = '2026-10-26';

test('order: a dependant before what it depends on is a violation; after or in the same column is not; later is after everything', () => {
  const rows = [
    row('lib', { position: 2 }),
    row('app', { position: 0, dependsOn: ['change:lib'] }),
    row('fine', { position: 3, dependsOn: ['change:lib'] }),
    row('same', { position: 2, dependsOn: ['change:lib'] }),
    row('loose', { dependsOn: ['change:lib'] }),
    row('early', { position: 1, dependsOn: ['change:loose'] }),
    row('done-dep', { position: 0, dependsOn: ['change:old'] }),
    row('old', { status: 'done', position: 5 }),
  ];
  assert.deepEqual(violations(rows, TODAY), [
    { kind: 'order', change: 'change:app', against: 'change:lib' },
    { kind: 'order', change: 'change:early', against: 'change:loose' },
  ]);
});

test('targets: against the order, against a dependency through the parent, and overdue', () => {
  const rows = [
    row('m1', { position: 0, target: '2026-12-01' }),
    row('m2', { position: 1, target: '2026-11-01' }),
    row('m3', { position: 2, target: '2026-12-15' }),
    row('child-of-m2', { parent: 'change:m2', dependsOn: ['change:m1'] }),
    row('late', { target: '2026-10-01', status: 'active' }),
    row('late-done', { target: '2026-10-01', status: 'done' }),
  ];
  assert.equal(effectiveTarget(new Map(rows.map((r) => [r.key, r])), 'change:child-of-m2'), '2026-11-01');
  assert.deepEqual(violations(rows, TODAY), [
    { kind: 'target-dependency', change: 'change:child-of-m2', against: 'change:m1' },
    { kind: 'overdue', change: 'change:late' },
    { kind: 'target-order', change: 'change:m2', against: 'change:m1' },
  ]);
});

test('worst severity', () => {
  assert.equal(worstSeverity('cosmetic', 'feature'), 'feature');
  assert.equal(worstSeverity('product', undefined), 'product');
  assert.equal(worstSeverity(undefined, 'nuisance'), 'nuisance');
  assert.equal(worstSeverity(undefined, undefined), undefined);
});
