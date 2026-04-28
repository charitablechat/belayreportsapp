/**
 * PR-A regression lock: the form-side write helper
 * `applyTrackedFieldWrite` (and `applyTrackedFieldsWrite`) must populate
 * `field_timestamps` for tracked fields, AND the result must round-trip
 * through `mergeRecordFields` such that two devices' concurrent edits to
 * different tracked fields both survive.
 *
 * Audit gap this closes: prior to PR-A every form's header setter wrote
 *   `{ ...record, [field]: value, updated_at: now }`,
 * which never populated `field_timestamps`. The merger then degraded to
 * row-level last-writer-wins for every tracked field. These tests bind
 * the contract so any regression (a future form bypassing the helper)
 * fails CI.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyTrackedFieldWrite,
  applyTrackedFieldsWrite,
  mergeRecordFields,
  TRACKED_FIELDS,
  type MergeableRecord,
} from '@/lib/field-merge';

const advanceClockMs = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe('applyTrackedFieldWrite', () => {
  it('stamps field_timestamps[field] for tracked inspection fields', () => {
    const before = {
      id: 'insp-1',
      organization: 'old',
      updated_at: '2025-04-01T10:00:00.000Z',
    };
    const after = applyTrackedFieldWrite(before, 'inspection', 'organization', 'new');
    expect(after.organization).toBe('new');
    expect(after.field_timestamps?.organization).toBeDefined();
    expect(new Date(after.field_timestamps!.organization).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
    // updated_at advances too so unsynced-counts detector sees the row.
    expect(new Date(after.updated_at!).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
  });

  it('does NOT stamp field_timestamps for untracked fields (e.g. status)', () => {
    const before = {
      id: 'insp-1',
      status: 'draft',
      updated_at: '2025-04-01T10:00:00.000Z',
      field_timestamps: { organization: '2025-04-01T09:55:00.000Z' },
    };
    const after = applyTrackedFieldWrite(before, 'inspection', 'status', 'completed');
    expect(after.status).toBe('completed');
    // Existing tracked-field timestamps survive untouched.
    expect(after.field_timestamps?.organization).toBe('2025-04-01T09:55:00.000Z');
    // No new entry was added for `status`.
    expect(after.field_timestamps?.status).toBeUndefined();
  });

  it('preserves earlier per-field timestamps when stamping a different field', () => {
    const before = {
      id: 'insp-1',
      organization: 'OrgA',
      location: 'LocA',
      updated_at: '2025-04-01T10:00:00.000Z',
      field_timestamps: { organization: '2025-04-01T09:55:00.000Z' },
    };
    const after = applyTrackedFieldWrite(before, 'inspection', 'location', 'LocB');
    // organization stamp is preserved.
    expect(after.field_timestamps?.organization).toBe('2025-04-01T09:55:00.000Z');
    // location stamp is fresh.
    expect(after.field_timestamps?.location).toBeDefined();
  });

  it('TRACKED_FIELDS coverage matches helper behaviour for training', () => {
    const before = { id: 't-1', updated_at: '2025-04-01T10:00:00.000Z' };
    for (const field of TRACKED_FIELDS.training) {
      const after = applyTrackedFieldWrite(before, 'training', field, 'value');
      expect(after.field_timestamps?.[field]).toBeDefined();
    }
  });

  it('TRACKED_FIELDS coverage matches helper behaviour for daily_assessment', () => {
    const before = { id: 'a-1', updated_at: '2025-04-01T10:00:00.000Z' };
    for (const field of TRACKED_FIELDS.daily_assessment) {
      const after = applyTrackedFieldWrite(before, 'daily_assessment', field, 'value');
      expect(after.field_timestamps?.[field]).toBeDefined();
    }
  });
});

describe('applyTrackedFieldsWrite (batch)', () => {
  it('stamps every tracked key in the patch with a single shared timestamp', () => {
    const before = {
      id: 'insp-1',
      updated_at: '2025-04-01T10:00:00.000Z',
    };
    const after = applyTrackedFieldsWrite(before, 'inspection', {
      organization: 'X',
      location: 'Y',
      status: 'completed', // untracked — no stamp expected
    });
    expect(after.organization).toBe('X');
    expect(after.location).toBe('Y');
    expect(after.status).toBe('completed');
    expect(after.field_timestamps?.organization).toBeDefined();
    expect(after.field_timestamps?.location).toBeDefined();
    expect(after.field_timestamps?.status).toBeUndefined();
    // Shared timestamp: organization and location stamps are equal.
    expect(after.field_timestamps?.organization).toBe(after.field_timestamps?.location);
  });

  it('returns record unchanged shape when patch has no tracked keys', () => {
    const before = {
      id: 'insp-1',
      updated_at: '2025-04-01T10:00:00.000Z',
      field_timestamps: { organization: '2025-04-01T09:55:00.000Z' },
    };
    const after = applyTrackedFieldsWrite(before, 'inspection', { status: 'completed' });
    // No new stamps written, but pre-existing stamps are preserved (spread).
    expect(after.field_timestamps?.organization).toBe('2025-04-01T09:55:00.000Z');
  });
});

describe('PR-A end-to-end: form helper + merger preserves concurrent edits', () => {
  it('Device A edits organization, Device B edits location — both survive merge', async () => {
    // Both devices start from the same baseline.
    const baseline = {
      id: 'insp-1',
      organization: 'BaselineOrg',
      location: 'BaselineLoc',
      updated_at: '2025-04-01T10:00:00.000Z',
      field_timestamps: {},
    };

    // Device A edits organization at T0.
    const deviceA = applyTrackedFieldWrite(baseline, 'inspection', 'organization', 'A-org');

    // Device B edits location 1ms later (so its row updated_at is newer).
    await advanceClockMs(2);
    const deviceB = applyTrackedFieldWrite(baseline, 'inspection', 'location', 'B-loc');

    // Cross-device merge — order should not matter.
    const ab = mergeRecordFields(deviceA, deviceB, TRACKED_FIELDS.inspection);
    const ba = mergeRecordFields(deviceB, deviceA, TRACKED_FIELDS.inspection);

    expect(ab.organization).toBe('A-org');
    expect(ab.location).toBe('B-loc');

    expect(ba.organization).toBe('A-org');
    expect(ba.location).toBe('B-loc');

    // Both per-field stamps survive in the unified map.
    expect(ab.field_timestamps?.organization).toBe(deviceA.field_timestamps?.organization);
    expect(ab.field_timestamps?.location).toBe(deviceB.field_timestamps?.location);
  });

  it('regression: bypassing the helper (manual { ...rec, [field]: value, updated_at }) loses fields under merge', () => {
    // This test demonstrates the BUG that PR-A fixes: form code that
    // sets fields without populating field_timestamps regresses to
    // row-level last-writer-wins. If anyone reverts the form wiring to
    // the manual pattern, the cross-device merger can no longer keep
    // both devices' edits.
    const baseline = {
      id: 'insp-1',
      organization: 'Baseline',
      location: 'Baseline',
      updated_at: '2025-04-01T10:00:00.000Z',
      field_timestamps: {},
    };

    const deviceAManual = {
      ...baseline,
      organization: 'A-org',
      updated_at: '2025-04-01T10:01:00.000Z',
      // No field_timestamps populated — pre-PR-A pattern.
    };
    const deviceBManual = {
      ...baseline,
      location: 'B-loc',
      updated_at: '2025-04-01T10:02:00.000Z',
      // No field_timestamps populated.
    };

    const merged = mergeRecordFields(deviceAManual, deviceBManual, TRACKED_FIELDS.inspection);
    // Without per-field stamps, the merger falls back to row-level updated_at:
    // B is newer, so B's `Baseline` value for organization clobbers A's `A-org`.
    expect(merged.organization).toBe('Baseline');
    expect(merged.location).toBe('B-loc');
  });
});
