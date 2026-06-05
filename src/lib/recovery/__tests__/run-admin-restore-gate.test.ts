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
  it('produces a stable string for identical rows', async () => {
    expect(await fingerprintAdminSnapshot(GOOD_ROW)).toBe(
      await fingerprintAdminSnapshot(GOOD_ROW),
    );
  });

  it('differs when parent.updated_at changes', async () => {
    const a = await fingerprintAdminSnapshot(GOOD_ROW);
    const b = await fingerprintAdminSnapshot({
      ...GOOD_ROW,
      snapshot_data: {
        ...GOOD_ROW.snapshot_data,
        parent: { id: 'r-1', updated_at: '2030-01-01T00:00:00Z' },
      },
    });
    expect(a).not.toBe(b);
  });

  it('differs when child row count changes', async () => {
    const a = await fingerprintAdminSnapshot(GOOD_ROW);
    const b = await fingerprintAdminSnapshot({
      ...GOOD_ROW,
      snapshot_data: {
        ...GOOD_ROW.snapshot_data,
        children: { inspection_equipment: [{ id: 'e1' }, { id: 'e2' }] },
      },
    });
    expect(a).not.toBe(b);
  });

  it('differs when a child table is added', async () => {
    const a = await fingerprintAdminSnapshot(GOOD_ROW);
    const b = await fingerprintAdminSnapshot({
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

  it('differs when report_id changes', async () => {
    const a = await fingerprintAdminSnapshot(GOOD_ROW);
    const b = await fingerprintAdminSnapshot({ ...GOOD_ROW, report_id: 'OTHER' });
    expect(a).not.toBe(b);
  });

  it('contains no obviously sensitive fields (org / notes / photo_url)', async () => {
    const fp = await fingerprintAdminSnapshot({
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

  // --- Slice 5C follow-up: content-sensitive SHA-256 digest ---

  it('flips when child row CONTENT changes with same keys + same row counts', async () => {
    const base = {
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        parent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z' },
        children: { inspection_equipment: [{ id: 'e1', result: 'pass' }] },
      },
    };
    const mutated = {
      ...base,
      snapshot_data: {
        ...base.snapshot_data,
        children: { inspection_equipment: [{ id: 'e1', result: 'fail' }] },
      },
    };
    expect(await fingerprintAdminSnapshot(base)).not.toBe(
      await fingerprintAdminSnapshot(mutated),
    );
  });

  it('flips when parent CONTENT changes (same id and updated_at)', async () => {
    const base = {
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        parent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z', notes: 'a' },
        children: {},
      },
    };
    const mutated = {
      ...base,
      snapshot_data: {
        ...base.snapshot_data,
        parent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z', notes: 'b' },
      },
    };
    expect(await fingerprintAdminSnapshot(base)).not.toBe(
      await fingerprintAdminSnapshot(mutated),
    );
  });

  it('object key ORDER does not change the fingerprint (canonicalization)', async () => {
    const a = {
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        parent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z', a: 1, b: 2 },
        children: { inspection_equipment: [{ id: 'e1', x: 1, y: 2 }] },
      },
    };
    const b = {
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        children: { inspection_equipment: [{ y: 2, x: 1, id: 'e1' }] },
        parent: { b: 2, updated_at: '2026-01-01T00:00:00Z', a: 1, id: 'r-1' },
      },
    };
    expect(await fingerprintAdminSnapshot(a)).toBe(await fingerprintAdminSnapshot(b));
  });

  it('array ORDER changes the fingerprint (restore order is semantic)', async () => {
    const a = {
      report_type: 'inspection',
      report_id: 'r-1',
      snapshot_data: {
        parent: { id: 'r-1', updated_at: '2026-01-01T00:00:00Z' },
        children: { inspection_equipment: [{ id: 'e1' }, { id: 'e2' }] },
      },
    };
    const b = {
      ...a,
      snapshot_data: {
        ...a.snapshot_data,
        children: { inspection_equipment: [{ id: 'e2' }, { id: 'e1' }] },
      },
    };
    expect(await fingerprintAdminSnapshot(a)).not.toBe(await fingerprintAdminSnapshot(b));
  });

  it('digest segment is opaque hex (sha256:<64 hex>)', async () => {
    const fp = await fingerprintAdminSnapshot(GOOD_ROW);
    expect(fp).toMatch(/\|sha256:[0-9a-f]{64}$/);
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
