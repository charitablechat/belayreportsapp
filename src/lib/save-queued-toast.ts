/**
 * Throttled "Save queued" / "Already saved (finishing background sync)" toast.
 *
 * Background: the manual `saveProgress()` wrapper in InspectionForm,
 * TrainingForm, and DailyAssessmentForm shows a small info/success toast when
 * the user invokes a manual save while a previous `performSave` is still
 * draining its remote-sync tail (`anySaveInProgressRef.current === true`).
 *
 * The toast is correct once per "I tried again during a tail" event, but on
 * iPad users often tap Save (or hit Cmd+S) several times in quick succession,
 * which produced a visually noisy stack of identical toasts. This helper
 * throttles those two specific toasts to at most one per 30s window per
 * variant, using a stable sonner toast id so concurrent emissions update in
 * place instead of stacking.
 *
 * IMPORTANT scope boundaries (do NOT widen):
 *  - This file only governs the "Save queued" and "Already saved — Finishing
 *    background sync." messages from the manual-save early-return branch.
 *  - It does NOT change save ordering, queue handling, `performSave`,
 *    `autoSaveProgress`, `triggerImmediateSave`, or `useAutoSync`.
 *  - It does NOT suppress save errors — error paths still call setSaveError
 *    and surface destructive toasts as before.
 */

import { toast } from "sonner";

export type SaveQueuedVariant = "queued" | "already-saved";

const THROTTLE_WINDOW_MS = 30_000;
const TOAST_ID = "save-queued-toast";

// Module-level last-shown timestamps, one per variant so a "queued" and
// "already-saved" event don't suppress each other.
const lastShownAt: Record<SaveQueuedVariant, number> = {
  queued: 0,
  "already-saved": 0,
};

/**
 * For tests only — reset the throttle state between cases.
 */
export function __resetSaveQueuedToastForTests(): void {
  lastShownAt.queued = 0;
  lastShownAt["already-saved"] = 0;
}

/**
 * Show the throttled "Save queued" / "Already saved" toast.
 * Returns true if the toast was emitted, false if suppressed by the throttle.
 */
export function showSaveQueuedToast(variant: SaveQueuedVariant): boolean {
  const now = Date.now();
  if (now - lastShownAt[variant] < THROTTLE_WINDOW_MS) {
    return false;
  }
  lastShownAt[variant] = now;

  if (variant === "queued") {
    toast.info("Save queued", {
      id: TOAST_ID,
      description: "Finishing previous sync — your latest changes will save next.",
      duration: 2500,
    });
  } else {
    toast.success("Already saved", {
      id: TOAST_ID,
      description: "Finishing background sync.",
      duration: 2000,
    });
  }
  return true;
}
