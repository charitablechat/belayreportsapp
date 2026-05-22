import { describe, it, expect } from 'vitest';
import { isEmptyPlaceholderSummary, summaryFieldTimestampMs } from '@/lib/training-summary-merge';

describe('isEmptyPlaceholderSummary', () => {
  it('treats null/undefined and the fresh {id, training_id} placeholder as empty', () => {
    expect(isEmptyPlaceholderSummary(null)).toBe(true);
    expect(isEmptyPlaceholderSummary(undefined)).toBe(true);
    expect(isEmptyPlaceholderSummary({ id: 's', training_id: 't' })).toBe(true);
  });

  it('treats a row with any user content as non-empty (server data wins via merge, not via overwrite)', () => {
    expect(isEmptyPlaceholderSummary({ id: 's', training_id: 't', observations: 'x' })).toBe(false);
    expect(isEmptyPlaceholderSummary({ id: 's', training_id: 't', recommendations: 'y' })).toBe(false);
    expect(isEmptyPlaceholderSummary({ id: 's', training_id: 't', person_submitting: 'p' })).toBe(false);
    expect(isEmptyPlaceholderSummary({ id: 's', training_id: 't', submission_date: '2026-01-02' })).toBe(false);
  });

  it('treats whitespace-only strings as empty', () => {
    expect(isEmptyPlaceholderSummary({ observations: '   ', recommendations: '\n\t' })).toBe(true);
  });

  it('treats a row with field_timestamps as non-empty (user has touched the form)', () => {
    expect(isEmptyPlaceholderSummary({
      id: 's', training_id: 't',
      field_timestamps: { observations: '2026-01-02T00:00:00Z' },
    })).toBe(false);
  });
});

describe('summaryFieldTimestampMs', () => {
  it('prefers explicit field_timestamps over updated_at', () => {
    const ms = summaryFieldTimestampMs({
      updated_at: '2026-01-01T00:00:00Z',
      field_timestamps: { observations: '2026-02-01T00:00:00Z' },
    }, 'observations');
    expect(ms).toBe(new Date('2026-02-01T00:00:00Z').getTime());
  });

  it('falls back to updated_at when no per-field timestamp is set', () => {
    const ms = summaryFieldTimestampMs({ updated_at: '2026-01-01T00:00:00Z' }, 'observations');
    expect(ms).toBe(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('returns 0 for null/empty rows', () => {
    expect(summaryFieldTimestampMs(null, 'observations')).toBe(0);
    expect(summaryFieldTimestampMs({}, 'observations')).toBe(0);
  });
});
