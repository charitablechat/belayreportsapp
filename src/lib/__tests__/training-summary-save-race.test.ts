import { describe, it, expect } from 'vitest';
import { shouldKeepDirtyAfterSave, summaryTypedAfter } from '@/lib/training-summary-merge';

// Wall-clock anchors for the test scenarios. `saveStart` is the moment a
// hard save / autosave begins; "before" / "after" timestamps simulate user
// typing or summary row mutations relative to that anchor.
const SAVE_START = Date.parse('2026-05-01T12:00:00.000Z');
const BEFORE = new Date(SAVE_START - 5_000).toISOString();
const AFTER = new Date(SAVE_START + 1_500).toISOString();
const AFTER_LATER = new Date(SAVE_START + 10_000).toISOString();

describe('shouldKeepDirtyAfterSave — save-finally guard', () => {
  it('clears dirty when no pending fields and no recent summary update', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('keeps dirty when a protected field was typed AFTER save start (observations)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { observations: AFTER },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('keeps dirty when recommendations typed after save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { recommendations: AFTER_LATER },
        summaryUpdatedAt: null,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('does NOT keep dirty when pending stamps are strictly older than save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { observations: BEFORE, recommendations: BEFORE },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('keeps dirty when summary.updated_at moved forward AFTER save start (live edit during save)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: AFTER,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('treats malformed pending timestamps as not-typed-after (defensive)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { observations: 'not-a-date' },
        summaryUpdatedAt: null,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('returns false when saveStartedAtMs is invalid (no save-in-flight)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { observations: AFTER },
        summaryUpdatedAt: AFTER,
        saveStartedAtMs: NaN,
      }),
    ).toBe(false);
  });

  it('keeps dirty even if only one of several pending fields was typed after save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {
          observations: BEFORE,
          recommendations: AFTER, // newer
          person_submitting: BEFORE,
        },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });
});

describe('summaryTypedAfter — save-sequence stale-confirm guard', () => {
  it('returns false when there are no pending fields', () => {
    expect(summaryTypedAfter({ pendingFieldTimestamps: {}, sinceMs: SAVE_START })).toBe(false);
    expect(summaryTypedAfter({ pendingFieldTimestamps: null, sinceMs: SAVE_START })).toBe(false);
  });

  it('older save echo CANNOT confirm pending field typed after save start', () => {
    // Simulates: save#1 starts at SAVE_START, user types `observations` at
    // AFTER, then save#1's refetch echo arrives. typedAfterSaveStart must
    // be true → the refetch branch keeps pendingSummaryFieldsRef intact.
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { observations: AFTER },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(true);
  });

  it('allows confirmation when every pending field is strictly older than save start', () => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { observations: BEFORE, recommendations: BEFORE },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(false);
  });

  it('mixed pending: one newer field is enough to block confirmation', () => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { observations: BEFORE, recommendations: AFTER_LATER },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(true);
  });

  it('ignores invalid/empty timestamps (cannot confirm typing-after on garbage)', () => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { observations: '', recommendations: 'bad-ts' as string },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(false);
  });

  it('strictly-greater comparison: a stamp exactly equal to sinceMs is NOT typed-after', () => {
    const sameInstant = new Date(SAVE_START).toISOString();
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { observations: sameInstant },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(false);
  });
});
