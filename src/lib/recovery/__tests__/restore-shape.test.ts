import { describe, it, expect } from 'vitest';
import { validateSnapshotShape, _ALLOWED_CHILD_KEYS } from '@/lib/recovery/restore-shape';

const RID = '00000000-0000-0000-0000-000000000001';

const goodParent = { id: RID, updated_at: '2026-01-01T00:00:00.000Z' };

describe('validateSnapshotShape', () => {
  it('accepts a minimal valid inspection snapshot', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: goodParent, children: { systems: [] } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parent.id).toBe(RID);
      expect(r.children).toEqual({ systems: [] });
    }
  });

  it('accepts a valid snapshot WITHOUT updated_at (shape does not require it)', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: { id: RID }, children: {} },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects parent_missing when snapshot is null', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: null,
    });
    expect(r).toMatchObject({ ok: false, reason: 'parent_missing' });
  });

  it('rejects parent_missing when parent is missing', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { children: {} },
    });
    expect(r).toMatchObject({ ok: false, reason: 'parent_missing' });
  });

  it('rejects parent_missing when parent is an array (not a plain object)', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: [], children: {} },
    });
    expect(r).toMatchObject({ ok: false, reason: 'parent_missing' });
  });

  it('rejects parent_id_missing when parent has no id', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: { updated_at: 'x' }, children: {} },
    });
    expect(r).toMatchObject({ ok: false, reason: 'parent_id_missing' });
  });

  it('rejects parent_id_missing when id is empty string', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: { id: '' }, children: {} },
    });
    expect(r).toMatchObject({ ok: false, reason: 'parent_id_missing' });
  });

  it('rejects children_not_object when children is an array', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: goodParent, children: [] },
    });
    expect(r).toMatchObject({ ok: false, reason: 'children_not_object' });
  });

  it('rejects children_not_object when children is null', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: goodParent, children: null },
    });
    expect(r).toMatchObject({ ok: false, reason: 'children_not_object' });
  });

  it('rejects unknown child key (fail-closed for inspection)', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: goodParent, children: { systems: [], malicious_extra: [] } },
    });
    expect(r).toMatchObject({ ok: false, reason: 'child_key_unknown' });
  });

  it('rejects unknown child key (fail-closed for training)', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'training',
      // 'systems' is an inspection key, not a training key
      snapshot: { parent: goodParent, children: { systems: [] } },
    });
    expect(r).toMatchObject({ ok: false, reason: 'child_key_unknown' });
  });

  it('rejects non-array value at known child key', () => {
    const r = validateSnapshotShape({
      expectedReportType: 'inspection',
      snapshot: { parent: goodParent, children: { systems: { not: 'array' } } },
    });
    expect(r).toMatchObject({ ok: false, reason: 'child_not_array' });
  });

  it('accepts all known inspection / training / daily_assessment keys', () => {
    for (const rt of ['inspection', 'training', 'daily_assessment'] as const) {
      const children: Record<string, unknown[]> = {};
      for (const key of _ALLOWED_CHILD_KEYS[rt]) children[key] = [];
      const r = validateSnapshotShape({
        expectedReportType: rt,
        snapshot: { parent: goodParent, children },
      });
      expect(r.ok).toBe(true);
    }
  });
});
