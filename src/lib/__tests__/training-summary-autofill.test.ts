import { describe, it, expect } from 'vitest';
import { computeSummaryAutofill } from '../training-summary-autofill';

const TODAY = '2026-05-22';

describe('computeSummaryAutofill', () => {
  it('fills both fields when summary is blank', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: '', submission_date: null },
      currentUser: { email: 'alice@example.com' },
      currentUserProfile: { first_name: 'Alice', last_name: 'Anderson' },
      today: TODAY,
    });
    expect(out).toEqual({ person_submitting: 'Alice Anderson', submission_date: TODAY });
  });

  it('preserves existing person_submitting', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: 'Bob Manual', submission_date: null },
      currentUser: { email: 'alice@example.com' },
      currentUserProfile: { first_name: 'Alice', last_name: 'Anderson' },
      today: TODAY,
    });
    expect(out).toEqual({ submission_date: TODAY });
  });

  it('preserves existing submission_date (no overwrite from report-created date logic)', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: '', submission_date: '2026-05-19' },
      currentUser: { email: 'alice@example.com' },
      currentUserProfile: { first_name: 'Alice', last_name: 'Anderson' },
      today: TODAY,
    });
    expect(out).toEqual({ person_submitting: 'Alice Anderson' });
  });

  it('returns empty when both fields already set', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: 'Bob', submission_date: '2026-05-19' },
      currentUser: { email: 'alice@example.com' },
      currentUserProfile: { first_name: 'Alice', last_name: 'Anderson' },
      today: TODAY,
    });
    expect(out).toEqual({});
  });

  it('falls back to email prefix when profile name missing', () => {
    const out = computeSummaryAutofill({
      summary: null,
      currentUser: { email: 'charlie@example.com' },
      currentUserProfile: { first_name: null, last_name: null },
      today: TODAY,
    });
    expect(out).toEqual({ person_submitting: 'charlie', submission_date: TODAY });
  });

  it('skips name when no profile and no email; still fills date', () => {
    const out = computeSummaryAutofill({
      summary: null,
      currentUser: null,
      currentUserProfile: null,
      today: TODAY,
    });
    expect(out).toEqual({ submission_date: TODAY });
  });

  it('uses the provided today verbatim and not a report-created date', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: 'X', submission_date: null },
      currentUser: { email: 'a@b.c' },
      currentUserProfile: { first_name: 'A', last_name: 'B' },
      today: '2030-01-15',
    });
    expect(out.submission_date).toBe('2030-01-15');
  });

  it('treats whitespace-only person_submitting as empty', () => {
    const out = computeSummaryAutofill({
      summary: { person_submitting: '   ', submission_date: '2026-05-19' },
      currentUser: { email: 'a@b.c' },
      currentUserProfile: { first_name: 'A', last_name: 'B' },
      today: TODAY,
    });
    expect(out).toEqual({ person_submitting: 'A B' });
  });
});
