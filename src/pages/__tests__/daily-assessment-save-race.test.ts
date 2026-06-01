/**
 * Daily Assessment save-race scenarios.
 *
 * Same shape as `inspection-save-race.test.ts` but for the three
 * protected Daily Assessment comment fields:
 *
 *   - `environment_comments`
 *   - `structure_comments`
 *   - `systems_comments`
 *
 * Daily Assessment stores these fields directly on the `daily_assessments`
 * parent row (NOT a separate summary child table), so the load-merge
 * portion is handled by `mergeRecordFields` with
 * `TRACKED_FIELDS.daily_assessment`. We verify here that the generic
 * `shouldKeepDirtyAfterSave` / `summaryTypedAfter` predicates apply
 * cleanly to that field set.
 */
import { describe, it, expect } from 'vitest';
import { shouldKeepDirtyAfterSave, summaryTypedAfter } from '@/lib/live-state-merge';
import { mergeRecordFields, TRACKED_FIELDS } from '@/lib/field-merge';

const SAVE_START = Date.parse('2026-06-01T12:00:00.000Z');
const BEFORE = new Date(SAVE_START - 5_000).toISOString();
const DURING = new Date(SAVE_START + 1_500).toISOString();
const AFTER = new Date(SAVE_START + 8_000).toISOString();

const DA_PROTECTED = ['environment_comments', 'structure_comments', 'systems_comments'] as const;

describe('DailyAssessmentForm save-race — save-finally dirty guard', () => {
  it.each(DA_PROTECTED)('keeps dirty when %s typed after save start', (field) => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { [field]: DURING },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('clears dirty when all pending stamps are older than save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {
          environment_comments: BEFORE,
          structure_comments: BEFORE,
          systems_comments: BEFORE,
        },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('keeps dirty when assessment.updated_at advanced AFTER save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: AFTER,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('mixed pending: one newer protected field is enough to keep dirty', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {
          environment_comments: BEFORE,
          structure_comments: AFTER,
          systems_comments: BEFORE,
        },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('the three protected fields are all in TRACKED_FIELDS.daily_assessment', () => {
    const tracked = new Set(TRACKED_FIELDS.daily_assessment);
    for (const f of DA_PROTECTED) {
      expect(tracked.has(f)).toBe(true);
    }
  });
});

describe('DailyAssessmentForm save-race — stale save-echo stale-confirm guard', () => {
  it.each(DA_PROTECTED)('older save echo CANNOT confirm pending %s typed after older save start', (field) => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { [field]: DURING },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(true);
  });

  it('echo can confirm when every pending stamp is strictly older than save start', () => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: {
        environment_comments: BEFORE,
        systems_comments: BEFORE,
      },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(false);
  });

  it('strictly-greater: stamp equal to save start is NOT typed-after', () => {
    const sameInstant = new Date(SAVE_START).toISOString();
    expect(
      summaryTypedAfter({
        pendingFieldTimestamps: { structure_comments: sameInstant },
        sinceMs: SAVE_START,
      }),
    ).toBe(false);
  });
});

describe('DailyAssessmentForm save-race — intentional clear vs stale incoming', () => {
  it('user clears structure_comments locally with explicit per-field stamp; older populated incoming cannot resurrect', () => {
    // Reproduces the protected-field-on-parent-row case using the same
    // per-field LWW merge the form runs in `loadAssessment` (line 741).
    const userClearAt = DURING;
    const local = {
      id: 'a',
      organization: 'Acme',
      structure_comments: '', // user just cleared it
      updated_at: userClearAt,
      field_timestamps: { structure_comments: userClearAt },
    };
    const incoming = {
      id: 'a',
      organization: 'Acme',
      structure_comments: 'old populated text from another device',
      updated_at: BEFORE,
      field_timestamps: { structure_comments: BEFORE },
    };
    const merged = mergeRecordFields(
      local as never,
      incoming as never,
      [...TRACKED_FIELDS.daily_assessment],
    );
    // Local empty wins because its per-field stamp is strictly newer.
    expect((merged as Record<string, unknown>).structure_comments).toBe('');
  });

  it('cross-device newer populated value wins over local empty when its per-field stamp is newer', () => {
    // The opposite direction: another device typed `systems_comments`
    // AFTER our local clear. Per-field LWW with strictly-newer stamp
    // accepts the cross-device update.
    const local = {
      id: 'a',
      organization: 'Acme',
      systems_comments: '',
      updated_at: BEFORE,
      field_timestamps: { systems_comments: BEFORE },
    };
    const incoming = {
      id: 'a',
      organization: 'Acme',
      systems_comments: 'newer cross-device note',
      updated_at: AFTER,
      field_timestamps: { systems_comments: AFTER },
    };
    const merged = mergeRecordFields(
      local as never,
      incoming as never,
      [...TRACKED_FIELDS.daily_assessment],
    );
    expect((merged as Record<string, unknown>).systems_comments).toBe('newer cross-device note');
  });
});
