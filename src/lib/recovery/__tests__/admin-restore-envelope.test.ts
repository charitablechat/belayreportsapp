/**
 * Slice 5C — admin-restore-envelope validator behaviour.
 *
 * Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest';
import { validateAdminRestoreEnvelope } from '@/lib/recovery/admin-restore-envelope';

describe('validateAdminRestoreEnvelope', () => {
  it('accepts a well-formed row with matching parent identity', () => {
    const r = validateAdminRestoreEnvelope({
      row: {
        report_type: 'inspection',
        report_id: 'r-1',
        snapshot_data: { parent: { id: 'r-1' } },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reportType).toBe('inspection');
      expect(r.reportId).toBe('r-1');
    }
  });

  it('accepts row when snapshot_data.parent is absent (shape validator owns that path)', () => {
    const r = validateAdminRestoreEnvelope({
      row: { report_type: 'training', report_id: 'r-2', snapshot_data: {} },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects null row', () => {
    expect(validateAdminRestoreEnvelope({ row: null })).toEqual({
      ok: false,
      reason: 'envelope_missing',
    });
  });

  it('rejects missing report_type', () => {
    const r = validateAdminRestoreEnvelope({
      row: { report_id: 'r-1', snapshot_data: {} },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe('envelope_missing');
  });

  it('rejects unknown report_type', () => {
    const r = validateAdminRestoreEnvelope({
      row: { report_type: 'bogus', report_id: 'r-1' },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe('envelope_type_unknown');
  });

  it('rejects empty report_id', () => {
    const r = validateAdminRestoreEnvelope({
      row: { report_type: 'inspection', report_id: '' },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe('envelope_id_missing');
  });

  it('rejects parent.id that does not match envelope report_id', () => {
    const r = validateAdminRestoreEnvelope({
      row: {
        report_type: 'inspection',
        report_id: 'r-1',
        snapshot_data: { parent: { id: 'OTHER' } },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe('parent_id_mismatch');
  });

  it('rejects parent.report_type that does not match envelope', () => {
    const r = validateAdminRestoreEnvelope({
      row: {
        report_type: 'inspection',
        report_id: 'r-1',
        snapshot_data: { parent: { id: 'r-1', report_type: 'training' } },
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toBe('parent_type_mismatch');
  });
});
