/**
 * Inspection save-race scenarios.
 *
 * These tests exercise the shared `live-state-merge` + `useSaveRaceGuard`
 * primitives in the exact way `InspectionForm.tsx` consumes them. They
 * are pure-function scenario tests (no React render) — fast, deterministic,
 * and cover the three specific failure shapes Luke hit in Training but
 * adapted to the Inspection-summary fields:
 *
 *   1. Stale save echo cannot clear `pendingFieldsRef` when the user kept
 *      typing after the older save started.
 *   2. The save-finally dirty-state guard keeps `hasUnsavedRef` set when
 *      the user typed any protected field after this save began.
 *   3. A user-intentional clear (typing then deleting) survives because
 *      the pending stamp is still newer than the incoming row's stamps —
 *      the merge layer (`mergeInspectionSummaryPreservingPopulated`) is
 *      what physically preserves the cleared value; we verify here that
 *      our guard does not interfere with that.
 *
 * Protected Inspection summary fields:
 *   - `critical_actions`
 *   - `repairs_performed`
 *   - `future_considerations`
 */
import { describe, it, expect } from 'vitest';
import { shouldKeepDirtyAfterSave, summaryTypedAfter } from '@/lib/live-state-merge';
import {
  INSPECTION_SUMMARY_FIELDS,
  mergeInspectionSummaryPreservingPopulated,
} from '@/lib/inspection-summary-merge';

const SAVE_START = Date.parse('2026-06-01T12:00:00.000Z');
const BEFORE = new Date(SAVE_START - 5_000).toISOString();
const DURING = new Date(SAVE_START + 1_500).toISOString();
const AFTER = new Date(SAVE_START + 8_000).toISOString();

describe('InspectionForm save-race — save-finally dirty guard', () => {
  it('keeps dirty when user typed critical_actions after save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { critical_actions: DURING },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('keeps dirty when user typed repairs_performed after save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { repairs_performed: AFTER },
        summaryUpdatedAt: null,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('keeps dirty when user typed future_considerations after save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: { future_considerations: DURING },
        summaryUpdatedAt: null,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('clears dirty when all pending stamps are older than save start', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {
          critical_actions: BEFORE,
          repairs_performed: BEFORE,
          future_considerations: BEFORE,
        },
        summaryUpdatedAt: BEFORE,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(false);
  });

  it('keeps dirty when the summary row updated_at advanced AFTER save start (live edit window)', () => {
    expect(
      shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: {},
        summaryUpdatedAt: DURING,
        saveStartedAtMs: SAVE_START,
      }),
    ).toBe(true);
  });

  it('handles all three protected Inspection fields uniformly', () => {
    for (const field of ['critical_actions', 'repairs_performed', 'future_considerations']) {
      expect(
        shouldKeepDirtyAfterSave({
          pendingFieldTimestamps: { [field]: DURING },
          summaryUpdatedAt: BEFORE,
          saveStartedAtMs: SAVE_START,
        }),
      ).toBe(true);
    }
  });

  it('protected fields are a subset of INSPECTION_SUMMARY_FIELDS', () => {
    const protectedSet = new Set(INSPECTION_SUMMARY_FIELDS as readonly string[]);
    expect(protectedSet.has('critical_actions')).toBe(true);
    expect(protectedSet.has('repairs_performed')).toBe(true);
    expect(protectedSet.has('future_considerations')).toBe(true);
  });
});

describe('InspectionForm save-race — stale save-echo stale-confirm guard', () => {
  it('older save echo CANNOT confirm pending critical_actions typed after older save start', () => {
    // Simulates: save#1 starts at SAVE_START, user types `critical_actions`
    // at DURING, then save#1's Realtime echo / refetch arrives.
    // `summaryTypedAfter(pending, sinceMs=SAVE_START)` must be true so the
    // refetch branch refuses to clear `pendingFieldsRef`.
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: { critical_actions: DURING },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(true);
  });

  it('an echo arriving AFTER everything was typed-before-save → safe to confirm', () => {
    const typed = summaryTypedAfter({
      pendingFieldTimestamps: {
        critical_actions: BEFORE,
        repairs_performed: BEFORE,
      },
      sinceMs: SAVE_START,
    });
    expect(typed).toBe(false);
  });
});

describe('InspectionForm save-race — intentional user clear still works', () => {
  it('user clears critical_actions; subsequent stale incoming with old populated value cannot resurrect it', () => {
    // The merge layer (`mergeInspectionSummaryPreservingPopulated`) is what
    // physically protects the cleared value. We pass an empty local row
    // that carries an explicit per-field timestamp (the user-clear stamp)
    // and an older populated incoming row. The local empty must win.
    const userClearAt = DURING;
    const local = {
      id: 's',
      inspection_id: 'i',
      critical_actions: '', // user just cleared it
      updated_at: userClearAt,
      field_timestamps: { critical_actions: userClearAt },
    };
    const incoming = {
      id: 's',
      inspection_id: 'i',
      critical_actions: 'old populated text from another device',
      updated_at: BEFORE,
      field_timestamps: { critical_actions: BEFORE },
    };
    const { merged, preserved, honouredClears } = mergeInspectionSummaryPreservingPopulated(
      local as never,
      incoming as never,
    );
    // The clear wins because user's explicit per-field stamp is strictly newer.
    expect((merged as Record<string, unknown>).critical_actions).toBe('');
    // The user's own clear is not the "stale incoming blank vs populated local"
    // case the preservation list tracks. It also isn't recorded as an
    // honouredClear here (that path describes incoming-side explicit clears
    // beating populated local). Both lists may be empty; what matters is the
    // merged value.
    expect(preserved).toEqual([]);
    expect(honouredClears).toEqual([]);
  });

  it('mount-time empty placeholder cannot wipe a populated local row', () => {
    // Simulates: form just mounted, summary state still has user's
    // populated text, a background refetch returns a fresh "empty
    // placeholder" row with no field_timestamps and a newer row-level
    // updated_at. The merge MUST preserve local.
    const local = {
      id: 's',
      inspection_id: 'i',
      critical_actions: 'user typed text',
      repairs_performed: 'user typed repairs',
      updated_at: BEFORE,
      field_timestamps: { critical_actions: BEFORE, repairs_performed: BEFORE },
    };
    const incomingPlaceholder = {
      id: 's',
      inspection_id: 'i',
      critical_actions: null,
      repairs_performed: '',
      // newer row-level updated_at but NO explicit per-field stamps
      updated_at: AFTER,
    };
    const { merged, preserved } = mergeInspectionSummaryPreservingPopulated(
      local as never,
      incomingPlaceholder as never,
    );
    expect((merged as Record<string, unknown>).critical_actions).toBe('user typed text');
    expect((merged as Record<string, unknown>).repairs_performed).toBe('user typed repairs');
    expect(preserved.map((p) => p.field).sort()).toEqual(['critical_actions', 'repairs_performed']);
  });
});
