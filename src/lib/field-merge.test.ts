import { describe, it, expect } from 'vitest';
import { mergeRecordFields, setFieldWithTimestamp, TRACKED_FIELDS } from './field-merge';

const T = (s: string) => new Date(s).toISOString();

describe('mergeRecordFields', () => {
  it('merges non-overlapping field edits from two devices', () => {
    const local: any = {
      updated_at: T('2025-01-01T10:01:00Z'),
      organization: 'Acme',
      location: 'LOCAL location',
      field_timestamps: { location: T('2025-01-01T10:01:00Z') } as Record<string, string>,
    };
    const remote: any = {
      updated_at: T('2025-01-01T10:02:00Z'),
      organization: 'REMOTE org',
      location: 'old',
      field_timestamps: { organization: T('2025-01-01T10:02:00Z') } as Record<string, string>,
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('REMOTE org');
    expect(merged.location).toBe('LOCAL location');
  });

  it('keeps newer field on conflict', () => {
    const local: any = {
      updated_at: T('2025-01-01T10:00:00Z'),
      organization: 'OLD',
      field_timestamps: { organization: T('2025-01-01T10:00:00Z') } as Record<string, string>,
    };
    const remote: any = {
      updated_at: T('2025-01-01T10:05:00Z'),
      organization: 'NEW',
      field_timestamps: { organization: T('2025-01-01T10:05:00Z') } as Record<string, string>,
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('NEW');
  });

  it('first signature wins for attestation', () => {
    const local: any = {
      updated_at: T('2025-01-01T11:00:00Z'),
      attestation_signed_at: T('2025-01-01T10:00:00Z'),
      attestation_signer_name: 'First Signer',
      field_timestamps: {} as Record<string, string>,
    };
    const remote: any = {
      updated_at: T('2025-01-01T11:00:00Z'),
      attestation_signed_at: T('2025-01-01T10:30:00Z'),
      attestation_signer_name: 'Second Signer',
      field_timestamps: {} as Record<string, string>,
    };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.attestation_signer_name).toBe('First Signer');
    expect(merged.attestation_signed_at).toBe(T('2025-01-01T10:00:00Z'));
  });

  it('falls back to updated_at when field timestamp missing', () => {
    const local: any = { updated_at: T('2025-01-01T10:00:00Z'), organization: 'A', field_timestamps: {} };
    const remote: any = { updated_at: T('2025-01-01T11:00:00Z'), organization: 'B', field_timestamps: {} };
    const merged = mergeRecordFields(local, remote, TRACKED_FIELDS.inspection);
    expect(merged.organization).toBe('B');
  });

  it('unifies field_timestamps map', () => {
    const local: any = { updated_at: T('2025-01-01T10:00:00Z'), field_timestamps: { a: T('2025-01-01T10:00:00Z') } as Record<string, string> };
    const remote: any = { updated_at: T('2025-01-01T10:00:00Z'), field_timestamps: { b: T('2025-01-01T10:01:00Z') } as Record<string, string> };
    const merged = mergeRecordFields(local, remote, ['a', 'b']);
    expect(merged.field_timestamps?.a).toBe(T('2025-01-01T10:00:00Z'));
    expect(merged.field_timestamps?.b).toBe(T('2025-01-01T10:01:00Z'));
  });

  it('old client without field_timestamps does not overwrite new client field-timestamped value', () => {
    // Old client (pre-field-merge schema) writes with no field_timestamps map
    // at an OLDER updated_at than the new client's field-stamped edit.
    const oldClientLocal: any = {
      updated_at: T('2025-01-01T09:00:00Z'),
      organization: 'OLD CLIENT VALUE',
      field_timestamps: {},
    };
    // New client edited the same field LATER with a field_timestamps entry.
    const newClientRemote: any = {
      updated_at: T('2025-01-01T10:00:00Z'),
      organization: 'NEW CLIENT VALUE',
      field_timestamps: { organization: T('2025-01-01T10:00:00Z') } as Record<string, string>,
    };
    const merged = mergeRecordFields(oldClientLocal, newClientRemote, TRACKED_FIELDS.inspection);
    // Newer wins — old client's value must NOT overwrite the field-stamped edit.
    expect(merged.organization).toBe('NEW CLIENT VALUE');
  });
});

describe('setFieldWithTimestamp', () => {
  it('stamps the modified field', () => {
    const before: any = { organization: 'old', field_timestamps: {} as Record<string, string> };
    const after = setFieldWithTimestamp(before, 'organization', 'new');
    expect((after as any).organization).toBe('new');
    expect(after.field_timestamps?.organization).toBeDefined();
  });
  it('preserves other timestamps', () => {
    const before: any = { field_timestamps: { location: T('2025-01-01T00:00:00Z') } as Record<string, string> };
    const after = setFieldWithTimestamp(before, 'organization', 'x');
    expect(after.field_timestamps?.location).toBe(T('2025-01-01T00:00:00Z'));
  });
});
