import { describe, it, expect } from 'vitest';
import { sanitizeTrainingSummaryForRemote } from '@/lib/form-savers/trainingSaver';

describe('sanitizeTrainingSummaryForRemote', () => {
  it('keeps only DB columns of training_summary', () => {
    const out = sanitizeTrainingSummaryForRemote({
      id: 'sid',
      training_id: 'tid',
      observations: 'obs',
      recommendations: 'rec',
      person_submitting: 'p',
      submission_date: '2026-01-02',
      created_at: '2026-01-01T00:00:00Z',
      // client-only fields — must be stripped
      updated_at: '2026-01-02T00:00:00Z',
      field_timestamps: { observations: '2026-01-02T00:00:00Z' },
      last_modified_by: 'u',
      dirty: true,
      synced_at: '2026-01-02T00:00:00Z',
      random_extra: 'x',
    });
    expect(out).toEqual({
      id: 'sid',
      training_id: 'tid',
      observations: 'obs',
      recommendations: 'rec',
      person_submitting: 'p',
      submission_date: '2026-01-02',
      created_at: '2026-01-01T00:00:00Z',
    });
  });

  it('does not invent missing columns', () => {
    const out = sanitizeTrainingSummaryForRemote({
      training_id: 'tid',
      observations: 'only obs',
    });
    expect(out).toEqual({ training_id: 'tid', observations: 'only obs' });
    expect('recommendations' in out).toBe(false);
  });

  it('strips updated_at and field_timestamps so PostgREST never sees unknown columns', () => {
    const out = sanitizeTrainingSummaryForRemote({
      id: 's',
      training_id: 't',
      observations: 'o',
      updated_at: 'X',
      field_timestamps: { observations: 'X' },
    });
    expect('updated_at' in out).toBe(false);
    expect('field_timestamps' in out).toBe(false);
  });
});
