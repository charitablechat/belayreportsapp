import { describe, it, expect } from 'vitest';
import { runRestoreGate, blockReasonToast } from '@/lib/recovery/run-restore-gate';

const RID = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';

const validSnapshot = {
  parent: { id: RID, updated_at: '2026-01-01T00:00:00Z', status: 'in_progress' },
  children: { systems: [] },
};

describe('runRestoreGate', () => {
  it('returns confirm_normal for a clean Local-style restore (no envelope, fresh, unlocked)', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: validSnapshot,
      liveParent: null,
      isAdmin: false,
    });
    expect(r.gate).toMatchObject({ kind: 'confirm', variant: 'confirm_normal' });
    expect(r.validated?.parent.id).toBe(RID);
  });

  it('blocks on envelope id mismatch (cloud-style)', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: { report_type: 'inspection', report_id: OTHER },
      snapshot: validSnapshot,
      liveParent: null,
      isAdmin: true,
    });
    expect(r.gate).toEqual({ kind: 'block', reason: 'envelope_id_mismatch' });
  });

  it('blocks on parent id mismatch', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: { parent: { id: OTHER, updated_at: 'x' }, children: {} },
      liveParent: null,
      isAdmin: true,
    });
    expect(r.gate).toEqual({ kind: 'block', reason: 'parent_id_mismatch' });
  });

  it('blocks on unknown child key', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: { parent: { id: RID }, children: { malicious: [] } },
      liveParent: null,
      isAdmin: true,
    });
    expect(r.gate).toEqual({ kind: 'block', reason: 'child_key_unknown' });
  });

  it('returns confirm_stale when live is newer', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: { parent: { id: RID, updated_at: '2026-01-01T00:00:00Z' }, children: {} },
      liveParent: { id: RID, updated_at: '2026-02-01T00:00:00Z' },
      isAdmin: false,
    });
    expect(r.gate).toMatchObject({ kind: 'confirm', variant: 'confirm_stale' });
  });

  it('returns confirm_stale when updated_at is missing (unknown freshness)', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: { parent: { id: RID }, children: {} },
      liveParent: { id: RID, updated_at: '2026-01-01T00:00:00Z' },
      isAdmin: false,
    });
    expect(r.gate).toMatchObject({ kind: 'confirm', variant: 'confirm_stale' });
  });

  it('blocks non-admin on locked report', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: validSnapshot,
      liveParent: { id: RID, updated_at: '2026-01-01T00:00:00Z', status: 'completed' },
      isAdmin: false,
    });
    expect(r.gate).toEqual({ kind: 'block', reason: 'locked_non_admin' });
  });

  it('returns confirm_locked for admin on locked report', () => {
    const r = runRestoreGate({
      expectedReportType: 'inspection',
      expectedReportId: RID,
      envelope: null,
      snapshot: validSnapshot,
      liveParent: { id: RID, updated_at: '2026-01-01T00:00:00Z', status: 'completed' },
      isAdmin: true,
    });
    expect(r.gate).toMatchObject({ kind: 'confirm', variant: 'confirm_locked' });
  });
});

describe('blockReasonToast', () => {
  it('produces a generic identity message for envelope/parent mismatches (no field leak)', () => {
    const msg = blockReasonToast({ kind: 'block', reason: 'envelope_id_mismatch' });
    expect(msg).not.toContain('id');
    expect(msg).not.toMatch(/[0-9a-f-]{36}/);
    expect(msg.toLowerCase()).toContain('not match');
  });

  it('produces a generic malformed message for shape failures (no child key leak)', () => {
    const msg = blockReasonToast({ kind: 'block', reason: 'child_key_unknown' });
    expect(msg).not.toContain('child');
    expect(msg).not.toContain('key');
    expect(msg.toLowerCase()).toContain('unrecognized');
  });

  it('produces an admin-only message for locked_non_admin', () => {
    const msg = blockReasonToast({ kind: 'block', reason: 'locked_non_admin' });
    expect(msg.toLowerCase()).toContain('admin');
  });
});
