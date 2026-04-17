import { describe, it, expect } from 'vitest';
import { mergeRecordFields, setFieldWithTimestamp, TRACKED_FIELDS } from './field-merge';

const T = (s: string) => new Date(s).toISOString();

describe('mergeRecordFields', () => {
  it('merges non-overlapping field edits from two devices', () => {
    const local = {
      updated_at: T('2025-01-01T10:01:00Z'),
      organization: 'Acme',
      location: 'LOCAL location',
      field_timestamps: { location: T('2025-01-01T10:01:00Z') },
    };
    const remote = {
      updated_at: T('2025-01-01T10:02:00Z'),
      organization: 'REMOTE org',
      location: 'old',
      field_timestamps: { organization: T('2025-01-01T10:02:00Z') },
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('REMOTE org');
    expect(merged.location).toBe('LOCAL location');
  });

  it('keeps newer field on conflict', () => {
    const local = {
      updated_at: T('2025-01-01T10:00:00Z'),
      organization: 'OLD',
      field_timestamps: { organization: T('2025-01-01T10:00:00Z') },
    };
    const remote = {
      updated_at: T('2025-01-01T10:05:00Z'),
      organization: 'NEW',
      field_timestamps: { organization: T('2025-01-01T10:05:00Z') },
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('NEW');
  });

  it('first signature wins for attestation', () => {
    const local = {
      updated_at: T('2025-01-01T11:00:00Z'),
      attestation_signed_at: T('2025-01-01T10:00:00Z'),
      attestation_signer_name: 'First Signer',
      field_timestamps: {},
    };
    const remote = {
      updated_at: T('2025-01-01T11:00:00Z'),
      attestation_signed_at: T('2025-01-01T10:30:00Z'),
      attestation_signer_name: 'Second Signer',
      field_timestamps: {},
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.attestation_signer_name).toBe('First Signer');
    expect(merged.attestation_signed_at).toBe(T('2025-01-01T10:00:00Z'));
  });

  it('falls back to updated_at when field timestamp missing', () => {
    const local = { updated_at: T('2025-01-01T10:00:00Z'), organization: 'A', field_timestamps: {} };
    const remote = { updated_at: T('2025-01-01T11:00:00Z'), organization: 'B', field_timestamps: {} };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('B');
  });

  it('unifies field_timestamps map', () => {
    const local = { updated_at: T('2025-01-01T10:00:00Z'), field_timestamps: { a: T('2025-01-01T10:00:00Z') } };
    const remote = { updated_at: T('2025-01-01T10:00:00Z'), field_timestamps: { b: T('2025-01-01T10:01:00Z') } };
    const merged = mergeRecordFields(local, remote, ['a', 'b']);
    expect(merged.field_timestamps?.a).toBe(T('2025-01-01T10:00:00Z'));
    expect(merged.field_timestamps?.b).toBe(T('2025-01-01T10:01:00Z'));
  });
});

describe('setFieldWithTimestamp', () => {
  it('stamps the modified field', () => {
    const before = { organization: 'old', field_timestamps: {} };
    const after = setFieldWithTimestamp(before, 'organization', 'new');
    expect(after.organization).toBe('new');
    expect(after.field_timestamps?.organization).toBeDefined();
  });
  it('preserves other timestamps', () => {
    const before = { field_timestamps: { location: T('2025-01-01T00:00:00Z') } };
    const after = setFieldWithTimestamp(before, 'organization', 'x');
    expect(after.field_timestamps?.location).toBe(T('2025-01-01T00:00:00Z'));
  });
});
