import { describe, it, expect } from 'vitest';
import {
  mergeSummaryPreservingPopulated,
  isEmptyPlaceholderSummary,
} from '@/lib/training-summary-merge';

/**
 * Regression coverage for the Android-reported bug where editing one
 * Training Summary field would clear sibling fields on the next reload.
 *
 * The four user-editable training_summary columns are exercised:
 *   - observations            (rich-text)
 *   - recommendations         (rich-text)
 *   - person_submitting       (plain text)
 *   - submission_date         (yyyy-MM-dd)
 *
 * The other three columns (id, training_id, created_at) are not
 * user-editable content so they do not participate in field-merge.
 */

const T1 = '2026-05-28T10:40:00.000Z';
const T2 = '2026-05-28T10:42:00.000Z';
const T3 = '2026-05-28T10:55:00.000Z';

type Row = Record<string, unknown> & {
  updated_at?: string | null;
  field_timestamps?: Record<string, string> | null;
};

describe('mergeSummaryPreservingPopulated', () => {
  it('editing Observations does NOT clear Recommendations', () => {
    const local: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '<p>Adriano Miller did not pass.</p>',
      recommendations: '<p>You have many new facilitators.</p>',
      person_submitting: 'Bob Gantt',
      submission_date: '2026-05-28',
      updated_at: T2,
      field_timestamps: {
        observations: T2,
        recommendations: T2,
        person_submitting: T2,
        submission_date: T2,
      },
    };
    // Stale IDB / server row that only knows about a younger observations
    // edit — recommendations / person / date are empty (never seen by this
    // side yet).
    const incoming: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '<p>Adriano Miller did not pass.</p>',
      recommendations: '',
      person_submitting: null,
      submission_date: null,
      updated_at: T1,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.recommendations).toBe('<p>You have many new facilitators.</p>');
    expect(merged.person_submitting).toBe('Bob Gantt');
    expect(merged.submission_date).toBe('2026-05-28');
    expect(merged.observations).toBe('<p>Adriano Miller did not pass.</p>');
  });

  it('editing Recommendations does NOT clear Observations', () => {
    const local: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '<p>Observed</p>',
      recommendations: '<p>Recommended</p>',
      updated_at: T2,
      field_timestamps: { observations: T2, recommendations: T2 },
    };
    const incoming: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '',
      recommendations: '<p>Recommended</p>',
      updated_at: T1,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.observations).toBe('<p>Observed</p>');
    expect(merged.recommendations).toBe('<p>Recommended</p>');
  });

  it('rich-text edit does NOT clear Person Submitting Form or Submission Date', () => {
    const local: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '<p>obs</p>',
      person_submitting: 'Bob Gantt',
      submission_date: '2026-05-28',
      updated_at: T2,
      field_timestamps: { person_submitting: T1, submission_date: T1, observations: T2 },
    };
    const incoming: Row = {
      id: 'sid',
      training_id: 'tid',
      observations: '<p>obs</p>',
      person_submitting: '',
      submission_date: null,
      updated_at: T1,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.person_submitting).toBe('Bob Gantt');
    expect(merged.submission_date).toBe('2026-05-28');
  });

  it('empty incoming never beats populated local, even when row-level updated_at is newer', () => {
    // Worst-case server-refetch race: server's sanitized row arrives with
    // a fresh sync `updated_at` but no per-field timestamps, while local
    // has a populated field with an explicit field_timestamp that is older
    // than the row-level updated_at. Without the guard, mergeRecordFields
    // would prefer the older empty-string side because the explicit local
    // stamp is older than the explicit incoming stamp would have been —
    // here the incoming side is *not* explicit, so local must win.
    const local: Row = {
      observations: '<p>locally typed</p>',
      updated_at: T1,
      field_timestamps: { observations: T2 },
    };
    const incoming: Row = {
      observations: '',
      updated_at: T3, // newer row-level
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.observations).toBe('<p>locally typed</p>');
  });

  it('TipTap empty paragraph "<p></p>" is treated as empty for the guard', () => {
    const local: Row = {
      recommendations: '<p>kept</p>',
      field_timestamps: { recommendations: T2 },
      updated_at: T2,
    };
    const incoming: Row = {
      recommendations: '<p></p>',
      field_timestamps: { recommendations: T1 },
      updated_at: T1,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.recommendations).toBe('<p>kept</p>');
  });

  it('genuinely newer clear from the other device IS honoured', () => {
    // If the OTHER device explicitly cleared the field after our local
    // edit (incoming field_timestamp > local field_timestamp), the empty
    // value must win — collaborative clears should propagate.
    const local: Row = {
      recommendations: '<p>old text</p>',
      field_timestamps: { recommendations: T1 },
      updated_at: T1,
    };
    const incoming: Row = {
      recommendations: '',
      field_timestamps: { recommendations: T3 },
      updated_at: T3,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.recommendations).toBe('');
  });

  it('merged row carries field_timestamps for every tracked field that either side had', () => {
    const local: Row = {
      observations: '<p>o</p>',
      recommendations: '<p>r</p>',
      field_timestamps: { observations: T2, recommendations: T2 },
      updated_at: T2,
    };
    const incoming: Row = {
      person_submitting: 'Bob',
      submission_date: '2026-05-28',
      field_timestamps: { person_submitting: T3, submission_date: T3 },
      updated_at: T3,
    };
    const merged = mergeSummaryPreservingPopulated(local, incoming);
    expect(merged.field_timestamps?.observations).toBe(T2);
    expect(merged.field_timestamps?.recommendations).toBe(T2);
    expect(merged.field_timestamps?.person_submitting).toBe(T3);
    expect(merged.field_timestamps?.submission_date).toBe(T3);
  });

  it('empty placeholder local is detected so caller can short-circuit to incoming', () => {
    expect(isEmptyPlaceholderSummary({ id: 'x', training_id: 'y' })).toBe(true);
    expect(isEmptyPlaceholderSummary({ id: 'x', training_id: 'y', observations: '<p>x</p>' })).toBe(false);
    expect(isEmptyPlaceholderSummary(null)).toBe(true);
  });
});
