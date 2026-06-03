import { describe, it, expect } from 'vitest';
import { validateRestoreEnvelope } from '@/lib/recovery/restore-envelope';

const RID = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

describe('validateRestoreEnvelope', () => {
  it('passes when envelope is null and parent identity matches', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      parent: { id: RID },
    });
    expect(r).toEqual({ ok: true });
  });

  it('passes when envelope is null and parent is null (shape validator owns parent_missing)', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      parent: null,
    });
    expect(r).toEqual({ ok: true });
  });

  it('passes when cloud envelope matches and parent matches', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'training',
      expectedReportId: RID,
      envelope: { report_type: 'training', report_id: RID },
      parent: { id: RID },
    });
    expect(r).toEqual({ ok: true });
  });

  it('rejects when envelope is an object but missing fields', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'training',
      expectedReportId: RID,
      envelope: { report_type: 'training' },
      parent: { id: RID },
    });
    expect(r).toEqual({ ok: false, reason: 'envelope_missing' });
  });

  it('rejects envelope_type_mismatch', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: { report_type: 'training', report_id: RID },
      parent: { id: RID },
    });
    expect(r).toEqual({ ok: false, reason: 'envelope_type_mismatch' });
  });

  it('rejects envelope_id_mismatch', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: { report_type: 'inspection', report_id: OTHER },
      parent: { id: RID },
    });
    expect(r).toEqual({ ok: false, reason: 'envelope_id_mismatch' });
  });

  it('rejects parent_id_mismatch', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      parent: { id: OTHER },
    });
    expect(r).toEqual({ ok: false, reason: 'parent_id_mismatch' });
  });

  it('rejects parent_type_mismatch when parent carries report_type', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      parent: { id: RID, report_type: 'training' },
    });
    expect(r).toEqual({ ok: false, reason: 'parent_type_mismatch' });
  });

  it('tolerates parent without id field (shape validator owns that branch)', () => {
    const r = validateRestoreEnvelope({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      parent: { some: 'thing' },
    });
    expect(r).toEqual({ ok: true });
  });
});
