/**
 * Contract tests for the temp→UUID parent ID swap and child-FK rewrite.
 *
 * Two layers locked here:
 *   1. The fail-loud guard (`assertNoTempIdsInArray`) covers every child-table
 *      call-site label used in atomic-sync-manager.ts so a future refactor
 *      that drops a transform step is caught at the DB boundary.
 *   2. The pure rewrite helper (`rewriteChildForeignKeys`) is exercised
 *      directly: completeness, no-op on equal IDs, and selective rewriting
 *      (only rows whose FK actually matches the old temp id are touched).
 */

import { describe, it, expect } from 'vitest';
import { assertNoTempIdsInArray } from '@/lib/sw-sync-validators';
import { rewriteChildForeignKeys } from '@/lib/atomic-sync-manager';

const REAL_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const OTHER_UUID = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';

const CHILD_CALL_SITES = [
  'inspection_systems.upsert',
  'inspection_ziplines.upsert',
  'inspection_equipment.upsert',
  'inspection_standards.upsert',
  'inspection_summary.upsert',
  'training_systems_in_place.upsert',
  'training_verifiable_items.upsert',
  'training_immediate_attention.upsert',
  'training_operating_systems.upsert',
  'daily_assessment_beginning_of_day.upsert',
  'daily_assessment_end_of_day.upsert',
  'daily_assessment_environment_checks.upsert',
  'daily_assessment_equipment_checks.upsert',
  'daily_assessment_structure_checks.upsert',
  'daily_assessment_operating_systems.upsert',
];

describe('assertNoTempIdsInArray — child-table call-site labels', () => {
  for (const ctx of CHILD_CALL_SITES) {
    it(`throws naming the offender + context for ${ctx}`, () => {
      const rows = [{ id: REAL_UUID }, { id: 'temp-bad-row-7' }];
      expect(() => assertNoTempIdsInArray(rows, ctx)).toThrow(/temp-bad-row-7/);
      expect(() => assertNoTempIdsInArray(rows, ctx)).toThrow(new RegExp(ctx.replace('.', '\\.')));
    });
  }
});

describe('rewriteChildForeignKeys — pure FK rewrite contract', () => {
  it('rewrites every matching FK and leaves no temp- string in the output', () => {
    const tempId = 'temp-abc';
    const children = [
      { id: 'c1', inspection_id: tempId, name: 'Belay 1' },
      { id: 'c2', inspection_id: tempId, name: 'Belay 2' },
      { id: 'c3', inspection_id: tempId, name: 'Belay 3' },
    ];
    const out = rewriteChildForeignKeys(children, tempId, REAL_UUID, 'inspection_id');

    expect(out).toHaveLength(3);
    for (const row of out) {
      expect(row.inspection_id).toBe(REAL_UUID);
      expect(row.inspection_id.startsWith('temp-')).toBe(false);
    }
    // No temp- string anywhere in serialised payload.
    expect(JSON.stringify(out)).not.toContain('temp-');
  });

  it('preserves row count and field shape', () => {
    const tempId = 'temp-xyz';
    const children = [
      { id: 'a', inspection_id: tempId, payload: { nested: true } },
      { id: 'b', inspection_id: tempId, payload: { nested: false } },
    ];
    const before = JSON.parse(JSON.stringify(children));
    const out = rewriteChildForeignKeys(children, tempId, REAL_UUID, 'inspection_id');

    expect(out.length).toBe(before.length);
    expect(out[0].payload).toEqual(before[0].payload);
    expect(out[1].payload).toEqual(before[1].payload);
  });

  it('is a no-op when oldId === newId (no accidental clones, identity preserved)', () => {
    const children = [
      { id: 'c1', inspection_id: REAL_UUID },
      { id: 'c2', inspection_id: REAL_UUID },
    ];
    const out = rewriteChildForeignKeys(children, REAL_UUID, REAL_UUID, 'inspection_id');
    expect(out).toBe(children); // same array reference
    expect(out[0].inspection_id).toBe(REAL_UUID);
    expect(out[1].inspection_id).toBe(REAL_UUID);
  });

  it('only rewrites rows whose FK matches oldId — does not re-point unrelated rows', () => {
    const tempId = 'temp-parent-A';
    const children = [
      { id: 'c1', inspection_id: tempId },
      { id: 'c2', inspection_id: OTHER_UUID }, // belongs to a different parent
      { id: 'c3', inspection_id: tempId },
    ];
    rewriteChildForeignKeys(children, tempId, REAL_UUID, 'inspection_id');
    expect(children[0].inspection_id).toBe(REAL_UUID);
    expect(children[1].inspection_id).toBe(OTHER_UUID); // untouched
    expect(children[2].inspection_id).toBe(REAL_UUID);
  });

  it('handles empty / nullish input safely', () => {
    expect(rewriteChildForeignKeys([], 'temp-x', REAL_UUID, 'inspection_id')).toEqual([]);
    // @ts-expect-error — verify defensive null-handling at runtime
    expect(rewriteChildForeignKeys(null, 'temp-x', REAL_UUID, 'inspection_id')).toBeNull();
  });
});
