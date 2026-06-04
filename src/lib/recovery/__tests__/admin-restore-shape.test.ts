/**
 * Slice 5C — admin-restore-shape validator behaviour.
 *
 * Pure-module tests. Synthetic fixtures only — no real Supabase, no real
 * production snapshots, no real customer data.
 */
import { describe, it, expect } from 'vitest';
import {
  validateAdminSnapshotShape,
  _ALLOWED_ADMIN_CHILD_KEYS,
} from '@/lib/recovery/admin-restore-shape';

const PARENT = { id: 'r-1', updated_at: '2026-01-01T00:00:00Z' };

describe('validateAdminSnapshotShape', () => {
  it('accepts a well-formed inspection snapshot with whitelisted child tables', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: {
        parent: PARENT,
        children: {
          inspection_systems: [],
          inspection_equipment: [{ id: 'e1' }],
          inspection_photos: [],
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects null snapshot_data', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: null,
    });
    expect(result).toEqual({ ok: false, reason: 'parent_missing' });
  });

  it('rejects missing parent', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: { children: {} },
    });
    expect(result).toEqual({ ok: false, reason: 'parent_missing' });
  });

  it('rejects parent that is an array', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotData: { parent: [] as any, children: {} },
    });
    expect(result).toEqual({ ok: false, reason: 'parent_missing' });
  });

  it('rejects missing parent.id', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: { parent: { updated_at: 'x' }, children: {} },
    });
    expect(result).toEqual({ ok: false, reason: 'parent_id_missing' });
  });

  it('rejects empty parent.id', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: { parent: { id: '' }, children: {} },
    });
    expect(result).toEqual({ ok: false, reason: 'parent_id_missing' });
  });

  it('rejects non-object children (array)', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotData: { parent: PARENT, children: [] as any },
    });
    expect(result).toEqual({ ok: false, reason: 'children_not_object' });
  });

  it('rejects unknown child table key (fail-closed)', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'inspection',
      snapshotData: {
        parent: PARENT,
        children: {
          inspection_equipment: [],
          // Local-IDB shorthand is NOT a valid admin server table name.
          equipment: [],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('child_key_unknown');
      expect(result.field).toBe('equipment');
    }
  });

  it('rejects non-array child value', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'training',
      snapshotData: {
        parent: PARENT,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        children: { training_summary: { not: 'an array' } as any },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('child_not_array');
      expect(result.field).toBe('training_summary');
    }
  });

  it('per-type whitelist rejects cross-type keys', () => {
    const result = validateAdminSnapshotShape({
      expectedReportType: 'training',
      snapshotData: {
        parent: PARENT,
        children: {
          // valid for inspection, not for training
          inspection_equipment: [],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('child_key_unknown');
  });

  it('whitelist matches CHILD_TABLES in admin-edit-snapshot.ts (sanity)', () => {
    // Mirrors src/lib/admin-edit-snapshot.ts CHILD_TABLES — pinned here
    // so a drift in either side is caught at test time.
    expect([..._ALLOWED_ADMIN_CHILD_KEYS.inspection].sort()).toEqual([
      'inspection_equipment',
      'inspection_photos',
      'inspection_standards',
      'inspection_summary',
      'inspection_systems',
      'inspection_ziplines',
    ]);
    expect([..._ALLOWED_ADMIN_CHILD_KEYS.training].sort()).toEqual([
      'training_delivery_approaches',
      'training_immediate_attention',
      'training_operating_systems',
      'training_photos',
      'training_summary',
      'training_systems_in_place',
      'training_verifiable_items',
    ]);
    expect([..._ALLOWED_ADMIN_CHILD_KEYS.daily_assessment].sort()).toEqual([
      'daily_assessment_beginning_of_day',
      'daily_assessment_end_of_day',
      'daily_assessment_environment_checks',
      'daily_assessment_equipment_checks',
      'daily_assessment_operating_systems',
      'daily_assessment_photos',
      'daily_assessment_structure_checks',
    ]);
  });
});
