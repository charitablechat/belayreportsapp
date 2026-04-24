/**
 * Regression locks for cross-device concurrent-edit semantics in
 * src/lib/field-merge.ts. These cover the subtler properties the audit
 * relied on but that aren't asserted in the basic field-merge.test.ts:
 *
 *   - Disjoint-field merges are commutative (A∪B == B∪A on tracked fields).
 *   - Per-field timestamp beats row-level updated_at as a tie-breaker.
 *   - Attestation fields move as an atomic block from the (earliest) signed
 *     side, regardless of who has the newer row-level updated_at.
 *   - Tombstone-vs-edit child guard boundary conditions.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeRecordFields,
  shouldKeepEditedChild,
  TRACKED_FIELDS,
} from '@/lib/field-merge';

const T = (s: string) => new Date(s).toISOString();

describe('field-merge: disjoint-field concurrent edits', () => {
  it('two devices editing different fields both keep their work (and merge is symmetric)', () => {
    const deviceA: any = {
      updated_at: T('2025-04-01T10:01:00Z'),
      organization: 'A-org',
      location: 'shared-location',
      field_timestamps: { organization: T('2025-04-01T10:01:00Z') },
    };
    const deviceB: any = {
      updated_at: T('2025-04-01T10:02:00Z'),
      organization: 'shared-org',
      location: 'B-location',
      field_timestamps: { location: T('2025-04-01T10:02:00Z') },
    };

    const ab = mergeRecordFields(deviceA, deviceB, TRACKED_FIELDS.inspection);
    const ba = mergeRecordFields(deviceB, deviceA, TRACKED_FIELDS.inspection);

    // A wrote organization later than the row-fallback for B → A wins org.
    expect(ab.organization).toBe('A-org');
    expect(ab.location).toBe('B-location');

    // Symmetric on tracked fields.
    expect(ba.organization).toBe(ab.organization);
    expect(ba.location).toBe(ab.location);

    // Both per-field timestamps survive in the unified map.
    expect(ab.field_timestamps?.organization).toBe(T('2025-04-01T10:01:00Z'));
    expect(ab.field_timestamps?.location).toBe(T('2025-04-01T10:02:00Z'));
  });
});

describe('field-merge: per-field timestamp beats row-level updated_at', () => {
  it('explicit field timestamp wins even when the other side has a newer row updated_at', () => {
    // Device A — newer row, no per-field stamp on `organization`.
    const deviceA: any = {
      updated_at: T('2025-04-01T12:00:00Z'),
      organization: 'A-late-bulk-write',
      field_timestamps: {},
    };
    // Device B — older row overall, but explicitly stamped this field LATER than A's row.
    const deviceB: any = {
      updated_at: T('2025-04-01T10:00:00Z'),
      organization: 'B-explicit-edit',
      field_timestamps: { organization: T('2025-04-01T11:00:00Z') },
    };

    const merged = mergeRecordFields(deviceA, deviceB, TRACKED_FIELDS.inspection);
    // Explicit beats fallback per tsOf().
    expect(merged.organization).toBe('B-explicit-edit');
    expect(merged.field_timestamps?.organization).toBe(T('2025-04-01T11:00:00Z'));
  });
});

describe('field-merge: attestation first-sign-wins under concurrent edits', () => {
  it('signed side supplies all attestation fields even when the other has newer updated_at', () => {
    const signed: any = {
      updated_at: T('2025-04-01T10:00:00Z'),
      attestation_signed_at: T('2025-04-01T09:55:00Z'),
      attestation_signer_id: 'user-1',
      attestation_signer_name: 'Alice',
      attestation_text: 'I attest.',
      attestation_ip: '10.0.0.1',
      attestation_user_agent: 'UA-A',
      app_version_at_completion: '1.2.3',
      organization: 'signed-side-org',
      field_timestamps: {},
    };
    const unsigned: any = {
      updated_at: T('2025-04-01T13:00:00Z'), // newer overall
      attestation_signed_at: null,
      attestation_signer_id: null,
      attestation_signer_name: 'SHOULD NOT WIN',
      attestation_text: 'tampered',
      attestation_ip: '10.0.0.99',
      attestation_user_agent: 'UA-B',
      app_version_at_completion: '9.9.9',
      organization: 'unsigned-side-org',
      field_timestamps: { organization: T('2025-04-01T13:00:00Z') },
    };

    const merged = mergeRecordFields(unsigned, signed, TRACKED_FIELDS.inspection);

    // Attestation block comes from the signed side as one unit.
    expect(merged.attestation_signed_at).toBe(T('2025-04-01T09:55:00Z'));
    expect((merged as any).attestation_signer_name).toBe('Alice');
    expect((merged as any).attestation_text).toBe('I attest.');
    expect((merged as any).attestation_ip).toBe('10.0.0.1');
    expect((merged as any).attestation_user_agent).toBe('UA-A');
    expect((merged as any).app_version_at_completion).toBe('1.2.3');

    // Non-attestation per-field merge is unaffected — unsigned device's
    // explicit organization stamp still wins for that field.
    expect(merged.organization).toBe('unsigned-side-org');
  });

  it('when both sides signed, the EARLIER signature wins as a block', () => {
    const earlier: any = {
      updated_at: T('2025-04-01T11:00:00Z'),
      attestation_signed_at: T('2025-04-01T10:00:00Z'),
      attestation_signer_name: 'First Signer',
      attestation_text: 'first',
      attestation_ip: '10.0.0.1',
      attestation_user_agent: 'UA-1',
      app_version_at_completion: '1.0.0',
      attestation_signer_id: 'u1',
      field_timestamps: {},
    };
    const later: any = {
      updated_at: T('2025-04-01T11:00:00Z'),
      attestation_signed_at: T('2025-04-01T10:30:00Z'),
      attestation_signer_name: 'Second Signer',
      attestation_text: 'second',
      attestation_ip: '10.0.0.2',
      attestation_user_agent: 'UA-2',
      app_version_at_completion: '2.0.0',
      attestation_signer_id: 'u2',
      field_timestamps: {},
    };

    const merged = mergeRecordFields(earlier, later, TRACKED_FIELDS.inspection);

    // Entire attestation block comes from `earlier` — no field-level interleaving.
    expect(merged.attestation_signed_at).toBe(T('2025-04-01T10:00:00Z'));
    expect((merged as any).attestation_signer_name).toBe('First Signer');
    expect((merged as any).attestation_text).toBe('first');
    expect((merged as any).attestation_ip).toBe('10.0.0.1');
    expect((merged as any).attestation_user_agent).toBe('UA-1');
    expect((merged as any).app_version_at_completion).toBe('1.0.0');
    expect((merged as any).attestation_signer_id).toBe('u1');
  });
});

describe('shouldKeepEditedChild — boundary contract', () => {
  it('returns true only when child.updated_at is strictly after parentLastPulledAt', () => {
    expect(
      shouldKeepEditedChild(
        { updated_at: T('2025-04-01T10:00:01Z') },
        T('2025-04-01T10:00:00Z'),
      ),
    ).toBe(true);
  });

  it('returns false when timestamps are equal (no strict-after)', () => {
    expect(
      shouldKeepEditedChild(
        { updated_at: T('2025-04-01T10:00:00Z') },
        T('2025-04-01T10:00:00Z'),
      ),
    ).toBe(false);
  });

  it('returns false when parentLastPulledAt is missing', () => {
    expect(
      shouldKeepEditedChild({ updated_at: T('2025-04-01T10:00:00Z') }, null),
    ).toBe(false);
    expect(
      shouldKeepEditedChild({ updated_at: T('2025-04-01T10:00:00Z') }, undefined),
    ).toBe(false);
  });

  it('returns false when child.updated_at is missing', () => {
    expect(shouldKeepEditedChild({}, T('2025-04-01T10:00:00Z'))).toBe(false);
    expect(shouldKeepEditedChild({ updated_at: null }, T('2025-04-01T10:00:00Z'))).toBe(false);
  });

  it('returns false when child is older than parentLastPulledAt', () => {
    expect(
      shouldKeepEditedChild(
        { updated_at: T('2025-04-01T09:00:00Z') },
        T('2025-04-01T10:00:00Z'),
      ),
    ).toBe(false);
  });
});
