/**
 * Boundary tests for the generic save-race predicates extracted into
 * `src/lib/live-state-merge.ts`.
 *
 * These tests intentionally mirror the existing
 * `training-summary-save-race.test.ts` scenarios but exercise the GENERIC
 * helpers against:
 *
 *   - Inspection summary fields (`critical_actions`, `repairs_performed`,
 *     `future_considerations`)
 *   - Daily Assessment comment fields (`environment_comments`,
 *     `structure_comments`, `systems_comments`)
 *
 * Locking the generic predicates against multiple field sets confirms
 * the algorithm is truly field-agnostic — adding a new protected field
 * in any form must NOT require any change to `live-state-merge.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  markPendingFieldTyped,
  shouldKeepDirtyAfterSave,
  summaryTypedAfter,
} from '@/lib/live-state-merge';

const SAVE_START = Date.parse('2026-06-01T12:00:00.000Z');
const BEFORE = new Date(SAVE_START - 5_000).toISOString();
const AFTER = new Date(SAVE_START + 1_500).toISOString();
const AFTER_LATER = new Date(SAVE_START + 10_000).toISOString();

const INSPECTION_FIELDS = ['critical_actions', 'repairs_performed', 'future_considerations'] as const;
const DA_FIELDS = ['environment_comments', 'structure_comments', 'systems_comments'] as const;

describe('live-state-merge — summaryTypedAfter (generic)', () => {
  it('returns false for empty / null / undefined pending maps', () => {
    expect(summaryTypedAfter({ pendingFieldTimestamps: {}, sinceMs: SAVE_START })).toBe(false);
    expect(summaryTypedAfter({ pendingFieldTimestamps: null, sinceMs: SAVE_START })).toBe(false);
    expect(summaryTypedAfter({ pendingFieldTimestamps: undefined, sinceMs: SAVE_START })).toBe(false);
  });

  it.each(INSPECTION_FIELDS)('inspection: %s typed AFTER save start → true', (field) => {
    expect(
      summaryTypedAfter({ pendingFieldTimestamps: { [field]: AFTER }, sinceMs: SAVE_START }),
    ).toBe(true);
  });

  it.each(DA_FIELDS)('daily-assessment: %s typed AFTER save start → true', (field) => {
    expect(
      summaryTypedAfter({ pendingFieldTimestamps: { [field]: AFTER }, sinceMs: SAVE_START }),
    ).toBe(true);
  });

  it('strictly-greater comparison: a stamp exactly equal to sinceMs is NOT typed-after', () => {
    const sameInstant = new Date(SAVE_START).toISOString();
    expect(
      summaryTypedAfter({ pendingFieldTimestamps: { critical_actions: sameInstant }, sinceMs: SAVE_START }),
    ).toBe(false);
  });

  it('mixed pending: one newer field is enough to return true', () => {
    expect(
      summaryTypedAfter({
        pendingFieldTimestamps: {
          structure_comments: BEFORE,
          environment_comments: AFTER_LATER,
          systems_comments: BEFORE,
        },
        sinceMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('ignores malformed / empty stamps', () => {
    expect(
      summaryTypedAfter({
        pendingFieldTimestamps: {
          critical_actions: '',
          repairs_performed: 'not-a-date',
          future_considerations: undefined as unknown as string,
        },
        sinceMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('NaN sinceMs returns false (no save in flight)', () => {
    expect(
      summaryTypedAfter({ pendingFieldTimestamps: { critical_actions: AFTER }, sinceMs: NaN }),
    ).toBe(false);
  });
});

describe('live-state-merge — shouldKeepDirtyAfterSave (generic)', () => {
  it('clears dirty when nothing pending and no recent row update', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it.each(INSPECTION_FIELDS)('inspection: keeps dirty when %s typed after save start', (field) => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { [field]: AFTER },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it.each(DA_FIELDS)('daily-assessment: keeps dirty when %s typed after save start', (field) => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { [field]: AFTER_LATER },
        summaryUpdatedAt: null,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('keeps dirty when row updated_at moved forward AFTER save start (live edit during save)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: AFTER,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('does NOT keep dirty when all stamps are strictly older than save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {
          critical_actions: BEFORE,
          environment_comments: BEFORE,
        },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('returns false when saveStartedAtMs is invalid (treat as no save in flight)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { critical_actions: AFTER },
        summaryUpdatedAt: AFTER,
        saveStartedAtMs: NaN,
      }),
    ).toBe(false);
  });
});

describe('live-state-merge — markPendingFieldTyped', () => {
  it('stamps the field with the supplied ISO timestamp', () => {
    const pending: Record<string, string> = {};
    markPendingFieldTyped(pending, 'critical_actions', AFTER);
    expect(pending).toEqual({ critical_actions: AFTER });
  });

  it('overwrites prior stamps for the same field (latest write wins)', () => {
    const pending: Record<string, string> = { critical_actions: BEFORE };
    markPendingFieldTyped(pending, 'critical_actions', AFTER);
    expect(pending.critical_actions).toBe(AFTER);
  });

  it('defaults to Date.now() ISO when no timestamp supplied', () => {
    const pending: Record<string, string> = {};
    const before = Date.now();
    markPendingFieldTyped(pending, 'environment_comments');
    const stampMs = Date.parse(pending.environment_comments);
    const after = Date.now();
    expect(stampMs).toBeGreaterThanOrEqual(before);
    expect(stampMs).toBeLessThanOrEqual(after);
  });

  it('preserves stamps for unrelated fields', () => {
    const pending: Record<string, string> = {
      critical_actions: BEFORE,
      environment_comments: AFTER_LATER,
    };
    markPendingFieldTyped(pending, 'repairs_performed', AFTER);
    expect(pending).toEqual({
      critical_actions: BEFORE,
      environment_comments: AFTER_LATER,
      repairs_performed: AFTER,
    });
  });
});
