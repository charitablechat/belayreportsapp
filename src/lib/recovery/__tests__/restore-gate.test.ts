import { describe, it, expect } from 'vitest';
import {
  evaluateRestoreGate,
  compareRestoreGateRestrictiveness,
} from '@/lib/recovery/restore-gate';
import type { RestoreEnvelopeResult } from '@/lib/recovery/restore-envelope';
import type { RestoreShapeResult } from '@/lib/recovery/restore-shape';

const RID = '00000000-0000-0000-0000-000000000001';

const okEnvelope: RestoreEnvelopeResult = { ok: true };
const okShape: RestoreShapeResult = {
  ok: true,
  parent: { id: RID, updated_at: '2026-01-01T00:00:00Z' },
  children: {},
};

describe('evaluateRestoreGate', () => {
  it('blocks on envelope failure', () => {
    const r = evaluateRestoreGate({
      envelope: { ok: false, reason: 'envelope_id_mismatch' },
      shape: okShape,
      freshness: 'fresh',
      completionLocked: false,
      isAdmin: true,
    });
    expect(r).toEqual({ kind: 'block', reason: 'envelope_id_mismatch' });
  });

  it('blocks on shape failure', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: { ok: false, reason: 'child_key_unknown', field: 'evil' },
      freshness: 'fresh',
      completionLocked: false,
      isAdmin: true,
    });
    expect(r).toEqual({ kind: 'block', reason: 'child_key_unknown' });
  });

  it('returns confirm_normal for fresh + unlocked', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'fresh',
      completionLocked: false,
      isAdmin: false,
    });
    expect(r).toMatchObject({ kind: 'confirm', variant: 'confirm_normal', canProceed: true });
  });

  it('returns confirm_stale for stale + unlocked', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'stale',
      completionLocked: false,
      isAdmin: false,
    });
    expect(r).toMatchObject({ kind: 'confirm', variant: 'confirm_stale', canProceed: true });
  });

  it('treats unknown freshness as stale', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'unknown',
      completionLocked: false,
      isAdmin: false,
    });
    expect(r).toMatchObject({ kind: 'confirm', variant: 'confirm_stale' });
  });

  it('blocks confirm_locked for non-admin', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'fresh',
      completionLocked: true,
      isAdmin: false,
    });
    expect(r).toEqual({ kind: 'block', reason: 'locked_non_admin' });
  });

  it('allows confirm_locked for admin', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'fresh',
      completionLocked: true,
      isAdmin: true,
    });
    expect(r).toMatchObject({ kind: 'confirm', variant: 'confirm_locked', canProceed: true, requiresAdmin: true });
  });

  it('blocks confirm_stale_and_locked for non-admin', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'stale',
      completionLocked: true,
      isAdmin: false,
    });
    expect(r).toEqual({ kind: 'block', reason: 'locked_non_admin' });
  });

  it('allows confirm_stale_and_locked for admin', () => {
    const r = evaluateRestoreGate({
      envelope: okEnvelope,
      shape: okShape,
      freshness: 'stale',
      completionLocked: true,
      isAdmin: true,
    });
    expect(r).toMatchObject({ kind: 'confirm', variant: 'confirm_stale_and_locked', canProceed: true });
  });
});

describe('compareRestoreGateRestrictiveness', () => {
  const mk = (variant: 'confirm_normal' | 'confirm_stale' | 'confirm_locked' | 'confirm_stale_and_locked') => ({
    kind: 'confirm' as const,
    variant,
    canProceed: true,
    requiresAdmin: variant === 'confirm_locked' || variant === 'confirm_stale_and_locked',
    stale: variant === 'confirm_stale' || variant === 'confirm_stale_and_locked',
    locked: variant === 'confirm_locked' || variant === 'confirm_stale_and_locked',
  });

  it('orders normal < stale < locked < stale_and_locked', () => {
    expect(compareRestoreGateRestrictiveness(mk('confirm_normal'), mk('confirm_stale'))).toBeLessThan(0);
    expect(compareRestoreGateRestrictiveness(mk('confirm_stale'), mk('confirm_locked'))).toBeLessThan(0);
    expect(compareRestoreGateRestrictiveness(mk('confirm_locked'), mk('confirm_stale_and_locked'))).toBeLessThan(0);
  });

  it('returns 0 for equal variants', () => {
    expect(compareRestoreGateRestrictiveness(mk('confirm_stale'), mk('confirm_stale'))).toBe(0);
  });

  it('treats block as strictly more restrictive than any confirm', () => {
    const block = { kind: 'block' as const, reason: 'locked_non_admin' as const };
    expect(compareRestoreGateRestrictiveness(block, mk('confirm_stale_and_locked'))).toBeGreaterThan(0);
    expect(compareRestoreGateRestrictiveness(mk('confirm_normal'), block)).toBeLessThan(0);
  });
});
