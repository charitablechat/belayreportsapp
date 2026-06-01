/**
 * Generalised live-state save-race guard.
 *
 * Slice 1 — Race-guard parity for Inspection + Daily Assessment.
 *
 * This module extracts the **field-agnostic** save-race predicates that
 * `TrainingForm` already uses (via `training-summary-merge.ts`) so the
 * Inspection form and the Daily Assessment form can opt-in to the same
 * "newer typed text wins over older save echo" semantics without
 * duplicating the algorithm.
 *
 * Scope of this module:
 *
 *   - `summaryTypedAfter(...)`         — has any tracked field been typed
 *                                        after a given wall-clock moment?
 *   - `shouldKeepDirtyAfterSave(...)`  — should `hasUnsavedRef` stay set
 *                                        after a successful save completes?
 *
 * Both helpers are pure functions over `{ field: ISO timestamp string }`
 * maps; they make NO assumption about which fields are protected, which
 * row shape backs them, or which form type they belong to. The form
 * itself decides what counts as a "protected field" by only stamping
 * those fields into the pending map (via `useSaveRaceGuard.markFieldTyped`
 * or an equivalent inline stamper).
 *
 * Training behaviour is preserved verbatim — `training-summary-merge.ts`
 * keeps its own copies of these predicates (with identical semantics) so
 * existing Training tests do not move and the Training save path does not
 * change. New callers (Inspection, Daily Assessment) import directly from
 * this module.
 *
 * IMPORTANT non-goals:
 *   - This module does NOT replace `applyIncomingSummary` / the
 *     `mergeInspectionSummaryPreservingPopulated` load-merge guard. Those
 *     remain the source of truth for "is this incoming row allowed to
 *     overwrite this protected field". This module only governs the
 *     **save-finally dirty flag** and the **save-sequence stale-confirm**
 *     decisions that sit on top of the merge.
 *   - This module does NOT touch React state — callers consume the
 *     predicates from their own save handlers.
 */

export interface TypedAfterInput {
  /**
   * The form's pending-fields map — `{ fieldName: ISO timestamp string }`.
   * Each entry represents "the user typed (or cleared) this protected
   * field at the given wall-clock time". `null`/`undefined` are treated
   * as an empty map.
   *
   * Callers MUST stamp this map ONLY from real user-driven edits
   * (`onChange`/`onBlur` originating from a user gesture). Mount-time
   * hydration, controlled-prop resets, programmatic refetch application,
   * and similar transient blanks must NOT touch this map — otherwise the
   * "typed after save started" check below would falsely keep the form
   * dirty forever and (worse) block legitimate clears.
   */
  pendingFieldTimestamps: Record<string, string> | null | undefined;
  /** Reference wall-clock moment in ms since epoch (e.g. saveStartedAt). */
  sinceMs: number;
}

/**
 * Returns true when at least one entry in `pendingFieldTimestamps`
 * carries an ISO timestamp **strictly newer** than `sinceMs`.
 *
 * Used by the save-sequence stale-confirm guard: when an older save's
 * Realtime echo / refetch arrives after the user has kept typing, the
 * form must refuse to clear `pendingSummaryFieldsRef` and must skip any
 * "confirm pending field" logic — otherwise the older save's echo would
 * authorise an empty/short value to clobber the newer typed text.
 *
 * Defensive behaviour:
 *   - Non-finite `sinceMs` → returns false (no save in flight).
 *   - Non-string / empty entries → ignored.
 *   - Unparseable ISO strings → ignored.
 *   - Strict `>` (not `>=`): a stamp exactly equal to `sinceMs` is NOT
 *     considered "after"; that edge handles the same-instant case where
 *     the user typed at the exact moment the save started.
 */
export function summaryTypedAfter({ pendingFieldTimestamps, sinceMs }: TypedAfterInput): boolean {
  if (!Number.isFinite(sinceMs)) return false;
  const pending = pendingFieldTimestamps ?? {};
  for (const v of Object.values(pending)) {
    if (typeof v !== 'string' || !v) continue;
    const ms = new Date(v).getTime();
    if (Number.isFinite(ms) && ms > sinceMs) return true;
  }
  return false;
}

export interface ShouldKeepDirtyInput {
  /** The form's pending-fields map at the moment the save finished. */
  pendingFieldTimestamps: Record<string, string> | null | undefined;
  /**
   * The row-level `updated_at` of the summary/assessment row at the moment
   * the save finished. A value strictly newer than `saveStartedAtMs`
   * indicates the row was updated in-place after this save began (e.g.
   * a child-table mutation that bumped `updated_at` mid-flight).
   */
  summaryUpdatedAt: string | null | undefined;
  /** Wall-clock ms captured when THIS save invocation started. */
  saveStartedAtMs: number;
}

/**
 * Save-finally dirty-state guard.
 *
 * Returns `true` when the form's `hasUnsavedRef` / `hasUnsavedChanges`
 * MUST remain set after a successful save completes, because either:
 *
 *   (a) the user typed (or cleared) a protected field after this save
 *       started — captured via `pendingFieldTimestamps`; OR
 *   (b) the live row was updated in-place after save start — captured
 *       via `summaryUpdatedAt`.
 *
 * Returning `false` means it is safe to mark the form clean.
 *
 * IMPORTANT: this guard ONLY governs the "protected summary field"
 * portion of the dirty flag. Callers must still respect their existing
 * non-summary dirty conditions (equipment edits, photos, header changes,
 * etc.) — typically by `&&`-ing this result with the form's own
 * "should still be dirty" check, or by treating this as a veto on
 * clearing rather than a single source of truth.
 *
 * Defensive: non-finite `saveStartedAtMs` returns `false` (no in-flight
 * save means nothing to guard against).
 */
export function shouldKeepDirtyAfterSave({
  pendingFieldTimestamps,
  summaryUpdatedAt,
  saveStartedAtMs,
}: ShouldKeepDirtyInput): boolean {
  if (!Number.isFinite(saveStartedAtMs)) return false;
  if (summaryTypedAfter({ pendingFieldTimestamps, sinceMs: saveStartedAtMs })) return true;
  if (typeof summaryUpdatedAt === 'string' && summaryUpdatedAt) {
    const ms = new Date(summaryUpdatedAt).getTime();
    if (Number.isFinite(ms) && ms > saveStartedAtMs) return true;
  }
  return false;
}

/**
 * In-place mutator for a pending-fields map: stamps `field` with the
 * current (or supplied) ISO timestamp. Centralised here so every caller
 * uses the same `Date.now()`-based stamp and the same key shape.
 *
 * Callers (Inspection / Daily Assessment form handlers) should call this
 * ONLY from real user-driven edit handlers — never from hydration,
 * refetch application, or programmatic resets.
 */
export function markPendingFieldTyped(
  pending: Record<string, string>,
  field: string,
  nowIso: string = new Date().toISOString(),
): void {
  pending[field] = nowIso;
}
