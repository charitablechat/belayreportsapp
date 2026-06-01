import { useCallback, useRef } from "react";
import {
  markPendingFieldTyped,
  shouldKeepDirtyAfterSave,
  summaryTypedAfter,
} from "@/lib/live-state-merge";

/**
 * Shared save-race guard for form pages with protected text fields.
 *
 * Encapsulates the three refs (save sequence number, save-started
 * wall-clock, pending-fields stamp map) plus the small helpers the
 * Training fix introduced. Used by Inspection (`InspectionForm.tsx`)
 * and Daily Assessment (`DailyAssessmentForm.tsx`) to bring their
 * live save/refetch race protection up to the same standard as
 * Training.
 *
 * What it provides:
 *
 *   - `saveSeqRef` / `saveStartedAtMsRef` — refs the save handler bumps
 *     at the top of each invocation. Used by the form's refetch /
 *     Realtime-echo branches to detect "older save's echo arrived after
 *     I started typing again".
 *   - `pendingFieldsRef` — `{ fieldName: ISO timestamp string }` map
 *     populated by `markFieldTyped`. Each entry represents one
 *     user-driven edit/clear of a protected field.
 *   - `beginSave()`        → bumps the save sequence + captures wall-clock.
 *                            Returns `{ seq, startedAtMs }` so the save
 *                            body can pin them for stale-detection.
 *   - `markFieldTyped(f)`  → call from a user-driven `onChange`/`onBlur`
 *                            for a protected field. Stamps the pending
 *                            map. MUST NOT be called from hydration,
 *                            controlled-prop resets, refetch handlers,
 *                            programmatic placeholder seeds, or anywhere
 *                            else a non-user transient blank can flow.
 *   - `clearPendingField(f)` / `clearAllPending()` → for after a
 *                            successful save when nothing was typed
 *                            after `saveStartedAtMs`.
 *   - `shouldKeepDirty(...)` → wraps `shouldKeepDirtyAfterSave` with the
 *                              guard's own refs already bound.
 *   - `typedAfter(sinceMs)` → wraps `summaryTypedAfter` with the guard's
 *                             own pending map already bound.
 *
 * Cross-platform: pure React refs + setState-free helpers. No platform
 * branches; identical behaviour on desktop browser, installed PWA,
 * iPad/Safari, and mobile web.
 */
export interface SaveRaceGuard {
  saveSeqRef: React.MutableRefObject<number>;
  saveStartedAtMsRef: React.MutableRefObject<number>;
  pendingFieldsRef: React.MutableRefObject<Record<string, string>>;
  beginSave: () => { seq: number; startedAtMs: number };
  markFieldTyped: (field: string, nowIso?: string) => void;
  clearPendingField: (field: string) => void;
  clearAllPending: () => void;
  typedAfter: (sinceMs: number) => boolean;
  shouldKeepDirty: (summaryUpdatedAt: string | null | undefined, saveStartedAtMs?: number) => boolean;
}

export function useSaveRaceGuard(): SaveRaceGuard {
  const saveSeqRef = useRef(0);
  const saveStartedAtMsRef = useRef(0);
  const pendingFieldsRef = useRef<Record<string, string>>({});

  const beginSave = useCallback(() => {
    saveSeqRef.current += 1;
    saveStartedAtMsRef.current = Date.now();
    return { seq: saveSeqRef.current, startedAtMs: saveStartedAtMsRef.current };
  }, []);

  const markFieldTyped = useCallback((field: string, nowIso?: string) => {
    markPendingFieldTyped(pendingFieldsRef.current, field, nowIso);
  }, []);

  const clearPendingField = useCallback((field: string) => {
    if (field in pendingFieldsRef.current) {
      delete pendingFieldsRef.current[field];
    }
  }, []);

  const clearAllPending = useCallback(() => {
    pendingFieldsRef.current = {};
  }, []);

  const typedAfter = useCallback((sinceMs: number) => {
    return summaryTypedAfter({
      pendingFieldTimestamps: pendingFieldsRef.current,
      sinceMs,
    });
  }, []);

  const shouldKeepDirty = useCallback(
    (summaryUpdatedAt: string | null | undefined, saveStartedAtMs?: number) => {
      return shouldKeepDirtyAfterSave({
        pendingFieldTimestamps: pendingFieldsRef.current,
        summaryUpdatedAt,
        saveStartedAtMs: typeof saveStartedAtMs === "number" ? saveStartedAtMs : saveStartedAtMsRef.current,
      });
    },
    [],
  );

  return {
    saveSeqRef,
    saveStartedAtMsRef,
    pendingFieldsRef,
    beginSave,
    markFieldTyped,
    clearPendingField,
    clearAllPending,
    typedAfter,
    shouldKeepDirty,
  };
}
