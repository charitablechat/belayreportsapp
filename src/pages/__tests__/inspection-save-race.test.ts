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
  it('user clears critical_actions locally; save-race guard keeps form dirty until save persists the clear', () => {
    // A locally-typed clear is NOT protected at the merge layer (the merge
    // restores incoming when local is empty + incoming is populated — by
    // design, so cross-device populated data can hydrate a blank local row).
    // The user's clear is instead protected at the SAVE-RACE GUARD layer:
    // the form stamps `pendingFieldsRef[field]` on the clear edit, and any
    // older save-echo / refetch arriving after that stamp is treated as
    // stale via `summaryTypedAfter`. The form therefore refuses to mark
    // itself clean — the save handler then persists the empty value.
    const userClearAt = Date.parse(DURING); // user cleared during save
    const typedAfter = summaryTypedAfter({
      pendingFieldTimestamps: { critical_actions: new Date(userClearAt).toISOString() },
      sinceMs: SAVE_START,
    });
    expect(typedAfter).toBe(true);

    const keepDirty = shouldKeepDirtyAfterSave({
      pendingFieldTimestamps: { critical_actions: new Date(userClearAt).toISOString() },
      summaryUpdatedAt: BEFORE,
      saveStartedAtMs: SAVE_START,
    });
    expect(keepDirty).toBe(true);
  });

  it('mount-time empty placeholder cannot wipe a populated local row (merge keeps local via per-field LWW)', () => {
    // Per-field LWW already wins here because local has explicit stamps
    // and incoming has none — an explicit stamp always beats a row-level
    // fallback (see field-merge.ts). No entries flow into `preserved[]`
    // because `mergeRecordFields` never picked incoming; the contract we
    // assert is the resulting merged values.
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
      updated_at: AFTER,
    };
    const { merged } = mergeInspectionSummaryPreservingPopulated(
      local as never,
      incomingPlaceholder as never,
    );
    expect((merged as Record<string, unknown>).critical_actions).toBe('user typed text');
    expect((merged as Record<string, unknown>).repairs_performed).toBe('user typed repairs');
  });

  it('empty-preservation bug-fix path: incoming wins LWW with a blank value → merge restores populated local', () => {
    // Local has NO explicit per-field timestamps so LWW falls back to
    // row-level updated_at; incoming has a newer updated_at AND blank
    // values AND no explicit per-field clear stamp. mergeRecordFields
    // picks incoming (blank); the post-pass MUST restore populated local
    // and record `preserved`.
    const local = {
      id: 's',
      inspection_id: 'i',
      critical_actions: 'user typed text',
      repairs_performed: 'user typed repairs',
      updated_at: BEFORE,
    };
    const incomingBlank = {
      id: 's',
      inspection_id: 'i',
      critical_actions: null,
      repairs_performed: '',
      updated_at: AFTER,
    };
    const { merged, preserved, honouredClears } = mergeInspectionSummaryPreservingPopulated(
      local as never,
      incomingBlank as never,
    );
    expect((merged as Record<string, unknown>).critical_actions).toBe('user typed text');
    expect((merged as Record<string, unknown>).repairs_performed).toBe('user typed repairs');
    expect(preserved.map((p) => p.field).sort()).toEqual(['critical_actions', 'repairs_performed']);
    expect(honouredClears).toEqual([]);
  });

  it('honours an EXPLICIT cross-device clear (incoming has newer per-field stamp + blank value)', () => {
    const local = {
      id: 's',
      inspection_id: 'i',
      critical_actions: 'stale local text',
      updated_at: BEFORE,
      field_timestamps: { critical_actions: BEFORE },
    };
    const incomingExplicitClear = {
      id: 's',
      inspection_id: 'i',
      critical_actions: '',
      updated_at: AFTER,
      field_timestamps: { critical_actions: AFTER },
    };
    const { merged, honouredClears, preserved } = mergeInspectionSummaryPreservingPopulated(
      local as never,
      incomingExplicitClear as never,
    );
    expect((merged as Record<string, unknown>).critical_actions).toBe('');
    expect(honouredClears.map((p) => p.field)).toEqual(['critical_actions']);
    expect(preserved).toEqual([]);
  });
});
