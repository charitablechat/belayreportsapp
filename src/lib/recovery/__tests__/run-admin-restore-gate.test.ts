/**
 * Slice 5C — runAdminRestoreGate orchestrator behaviour.
 *
 * Synthetic fixtures only.
 */
import { describe, it, expect } from 'vitest';
import {
  runAdminRestoreGate,
  compareAdminRestoreGateRestrictiveness,
  fingerprintAdminSnapshot,
  adminBlockReasonToast,
} from '@/lib/recovery/run-admin-restore-gate';

const GOOD_ROW = {
  report_type: 'inspection',
  report_id: 'r-1',
  snapshot_data: {
    parent: { id: 'r-1', updated_at: '2026-01-02T00:00:00Z' },
    children: { inspection_equipment: [{ id: 'e1' }] },
  },
};

describe('runAdminRestoreGate — role precheck', () => {
  it('blocks when role is still loading', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: null,
      isAdmin: false,
      roleLoading: true,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('role_unknown');
  });

  it('blocks when isAdmin is null (unknown)', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: null,
      isAdmin: null,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('role_unknown');
  });

  it('blocks non-admin', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: null,
      isAdmin: false,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('not_admin');
  });
});

describe('runAdminRestoreGate — envelope / shape / live read', () => {
  it('blocks on envelope failure', () => {
    const out = runAdminRestoreGate({
      snapshotRow: { ...GOOD_ROW, report_type: 'bogus' },
      liveParent: null,
      isAdmin: true,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('envelope_type_unknown');
  });

  it('blocks on parent.id mismatch (TOCTOU defense)', () => {
    const out = runAdminRestoreGate({
      snapshotRow: {
        ...GOOD_ROW,
        snapshot_data: { ...GOOD_ROW.snapshot_data, parent: { id: 'OTHER' } },
      },
      liveParent: null,
      isAdmin: true,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('parent_id_mismatch');
  });

  it('blocks on unknown child table key', () => {
    const out = runAdminRestoreGate({
      snapshotRow: {
        ...GOOD_ROW,
        snapshot_data: {
          parent: { id: 'r-1' },
          children: { inspection_equipment: [], rogue_table: [] },
        },
      },
      liveParent: null,
      isAdmin: true,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('child_key_unknown');
  });

  it('blocks on live read error', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: 'read-error',
      isAdmin: true,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('block');
    if (out.gate.kind === 'block') expect(out.gate.reason).toBe('live_read_error');
  });
});

describe('runAdminRestoreGate — confirm variants', () => {
  it('confirm_normal when fresh and unlocked', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z', status: 'in_progress' },
      isAdmin: true,
      roleLoading: false,
    });
    expect(out.gate.kind).toBe('confirm');
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_normal');
      expect(out.gate.stale).toBe(false);
      expect(out.gate.locked).toBe(false);
    }
  });

  it('confirm_stale when live is strictly newer', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: { id: 'r-1', updated_at: '2026-02-01T00:00:00Z', status: 'in_progress' },
      isAdmin: true,
      roleLoading: false,
    });
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_stale');
    } else throw new Error('expected confirm');
  });

  it('confirm_stale when freshness is unknown (missing live updated_at)', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: { id: 'r-1', status: 'in_progress' },
      isAdmin: true,
      roleLoading: false,
    });
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_stale');
    } else throw new Error('expected confirm');
  });

  it('confirm_locked when live status === completed', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z', status: 'completed' },
      isAdmin: true,
      roleLoading: false,
    });
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_locked');
      expect(out.gate.locked).toBe(true);
    } else throw new Error('expected confirm');
  });

  it('confirm_stale_and_locked when both', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: { id: 'r-1', updated_at: '2026-02-01T00:00:00Z', status: 'completed' },
      isAdmin: true,
      roleLoading: false,
    });
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_stale_and_locked');
    } else throw new Error('expected confirm');
  });

  it('treats live parent missing as fresh (insert-equivalent)', () => {
    const out = runAdminRestoreGate({
      snapshotRow: GOOD_ROW,
      liveParent: null,
      isAdmin: true,
      roleLoading: false,
    });
    if (out.gate.kind === 'confirm') {
      expect(out.gate.variant).toBe('confirm_normal');
    } else throw new Error('expected confirm');
  });
});

describe('compareAdminRestoreGateRestrictiveness', () => {
  const mkConfirm = (
    variant:
      | 'confirm_normal'
      | 'confirm_stale'
      | 'confirm_locked'
      | 'confirm_stale_and_locked',
  ) => ({
    kind: 'confirm' as const,
    variant,
    stale: variant !== 'confirm_normal',
    locked: variant === 'confirm_locked' || variant === 'confirm_stale_and_locked',
    reportType: 'inspection' as const,
    reportId: 'r-1',
  });

  it('escalation: normal → stale is more restrictive', () => {
    expect(
      compareAdminRestoreGateRestrictiveness(
        mkConfirm('confirm_stale'),
        mkConfirm('confirm_normal'),
      ),
    ).toBeGreaterThan(0);
  });

  it('block is more restrictive than any confirm', () => {
    expect(
      compareAdminRestoreGateRestrictiveness(
        { kind: 'block', reason: 'live_read_error' },
        mkConfirm('confirm_stale_and_locked'),
      ),
    ).toBeGreaterThan(0);
  });

  it('same variants are equal', () => {
    expect(
      compareAdminRestoreGateRestrictiveness(
        mkConfirm('confirm_locked'),
        mkConfirm('confirm_locked'),
      ),
    ).toBe(0);
  });
});

describe('fingerprintAdminSnapshot — TOCTOU detection', () => {
  it('produces a stable string for identical rows', () => {
    expect(fingerprintAdminSnapshot(GOOD_ROW)).toBe(fingerprintAdminSnapshot(GOOD_ROW));
  });

  it('differs when parent.updated_at changes', () => {
    const a = fingerprintAdminSnapshot(GOOD_ROW);
    const b = fingerprintAdminSnapshot({
      ...GOOD_ROW,
      snapshot_data: {
        ...GOOD_ROW.snapshot_data,
        parent: { id: 'r-1', updated_at: '2030-01-01T00:00:00Z' },
      },
    });
    expect(a).not.toBe(b);
  });

  it('differs when child row count changes', () => {
    const a = fingerprintAdminSnapshot(GOOD_ROW);
    const b = fingerprintAdminSnapshot({
      ...GOOD_ROW,
      snapshot_data: {
        ...GOOD_ROW.snapshot_data,
        children: { inspection_equipment: [{ id: 'e1' }, { id: 'e2' }] },
      },
    });
    expect(a).not.toBe(b);
  });

  it('differs when a child table is added', () => {
    const a = fingerprintAdminSnapshot(GOOD_ROW);
    const b = fingerprintAdminSnapshot({
      ...GOOD_ROW,
      snapshot_data: {
        ...GOOD_ROW.snapshot_data,
        children: {
          inspection_equipment: [{ id: 'e1' }],
          inspection_photos: [],
        },
      },
    });
    expect(a).not.toBe(b);
  });

  it('differs when report_id changes', () => {
    const a = fingerprintAdminSnapshot(GOOD_ROW);
    const b = fingerprintAdminSnapshot({ ...GOOD_ROW, report_id: 'OTHER' });
    expect(a).not.toBe(b);
  });

  it('contains no obviously sensitive fields (org / notes / photo_url)', () => {
    const fp = fingerprintAdminSnapshot({
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        parent: {
          id: 'r-1',
          updated_at: '2026-01-01T00:00:00Z',
          organization: 'SHOULD_NOT_APPEAR',
          location: 'SHOULD_NOT_APPEAR',
          notes: 'SHOULD_NOT_APPEAR',
        },
        children: { inspection_photos: [{ photo_url: 'SHOULD_NOT_APPEAR' }] },
      },
    });
    expect(fp).not.toContain('SHOULD_NOT_APPEAR');
  });
});

describe('adminBlockReasonToast', () => {
  it('never includes a UUID or any sensitive field name', () => {
    const reasons = [
      'role_unknown',
      'not_admin',
      'envelope_missing',
      'envelope_type_unknown',
      'envelope_id_missing',
      'parent_id_mismatch',
      'parent_type_mismatch',
      'parent_missing',
      'parent_id_missing',
      'children_not_object',
      'child_key_unknown',
      'child_not_array',
      'live_read_error',
    ] as const;
    for (const reason of reasons) {
      const msg = adminBlockReasonToast({ kind: 'block', reason });
      expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
      expect(msg.toLowerCase()).not.toContain('organization');
      expect(msg.toLowerCase()).not.toContain('photo_url');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
