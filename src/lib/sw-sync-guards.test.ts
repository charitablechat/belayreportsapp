import { describe, it, expect } from 'vitest';
import {
  validateInspectionData,
  shouldSkipUpsert,
  assertNoTempIds,
  assertNoTempIdsInArray,
} from './sw-sync-validators';

describe('validateInspectionData', () => {
  it('returns invalid when inspection missing required fields', () => {
    const result = validateInspectionData(
      { id: null, organization: '', location: '' },
      [], [], [], [], null
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Inspection missing required fields');
  });

  it('returns valid with complete data', () => {
    const result = validateInspectionData(
      { id: 'abc-123', organization: 'Acme Corp', location: 'Site A' },
      [{ system_name: 'Belay', result: 'Pass' }],
      [{ zipline_name: 'Zip 1', result: 'Pass' }],
      [{ equipment_type: 'Harness', equipment_category: 'PPE', result: 'Pass' }],
      [{ standard_name: 'ACCT', has_documentation: true }],
      { observations: 'All good' }
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid for systems missing required fields', () => {
    const result = validateInspectionData(
      { id: 'abc-123', organization: 'Acme Corp', location: 'Site A' },
      [{ system_name: '', result: 'Pass' }],
      [], [], [], null
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('System 1 missing required fields');
  });

  it('returns invalid for equipment missing required fields', () => {
    const result = validateInspectionData(
      { id: 'abc-123', organization: 'Acme Corp', location: 'Site A' },
      [],
      [],
      [{ equipment_type: 'Harness', equipment_category: '', result: 'Pass' }],
      [],
      null
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Equipment 1 missing required fields');
  });

  it('returns valid with empty child arrays (nothing to validate)', () => {
    const result = validateInspectionData(
      { id: 'abc-123', organization: 'Acme Corp', location: 'Site A' },
      [], [], [], [], null
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('shouldSkipUpsert (empty-array guard)', () => {
  it('returns true when data is null', () => {
    expect(shouldSkipUpsert(null)).toBe(true);
  });

  it('returns true when data is empty array', () => {
    expect(shouldSkipUpsert([])).toBe(true);
  });

  it('returns false when data has items', () => {
    expect(shouldSkipUpsert([{ id: '1', name: 'test' }])).toBe(false);
  });
});
