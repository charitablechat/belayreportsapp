/**
 * Mode 13: Helpers for classifying sync-error Sentry severity.
 *
 * Background — production Sentry alerts of the shape
 *
 *   Error: Transaction failed after 2/7 steps. Rollback: successful
 *     ↳ caused by: Error: Step timeout: upsert:inspection_ziplines
 *
 * are *recoverable*: the multi-step transaction aborted cleanly, the
 * rollback succeeded, the dirty record stays queued in IDB, and the
 * next periodic autosync tick (30-60s away) will retry it. The
 * inspector loses nothing. These should NOT trigger high-priority
 * alerts in the user's inbox alongside genuinely unrecoverable
 * failures (RLS blocks, schema mismatches, persistent 5xx, etc.).
 *
 * This module centralises that classification so all three atomic-sync
 * catch sites (`syncInspection`, `syncTraining`, `syncDailyAssessment`)
 * forward the same severity + fingerprint to Sentry.
 */

/**
 * Local cause-chain walker. Mirrors `joinErrorCauseChain` in
 * `atomic-sync-manager.ts` but lives here so this module doesn't form
 * a circular import (atomic-sync imports this helper for severity
 * classification at its catch sites).
 */
function joinErrorCauseChain(err: unknown, depthLimit: number = 5): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  for (let i = 0; i <= depthLimit; i++) {
    if (cursor == null) break;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    if (cursor instanceof Error) {
      if (cursor.message) parts.push(cursor.message);
      cursor = (cursor as Error & { cause?: unknown }).cause;
    } else if (typeof cursor === "string") {
      parts.push(cursor);
      break;
    } else {
      parts.push(String(cursor));
      break;
    }
  }
  return parts.join(" | ");
}

/** Match the wrapper string built in `atomic-sync-manager.ts`. */
const ROLLBACK_SUCCESSFUL_RE =
  /Transaction failed after \d+\/\d+ steps\. Rollback: successful/i;

/** Match the per-step timeout / abort surfaces built in `transaction-manager.ts`. */
const STEP_FAILURE_RE = /Step (?:timeout|aborted): ([a-z]+:[a-z0-9_]+)/i;

const STEP_NUMBER_FAILURE_RE =
  /Step (\d+) (?:failed|\([a-z]+:[a-z0-9_]+\) (?:partial write|affected 0 rows))/i;

/**
 * Returns true when the error is a wrapped-and-rolled-back transaction
 * failure that the system has already recovered from. The inspector's
 * data is intact; the next sync tick retries the record.
 */
export function isRecoverableRollback(err: unknown): boolean {
  const message = joinErrorCauseChain(err);
  if (!message) return false;
  return (
    ROLLBACK_SUCCESSFUL_RE.test(message) &&
    // Defensive — if the inner message says rollback failed too, treat
    // as a real error so we don't accidentally downgrade a hard
    // inconsistency.
    !/Rollback: failed/i.test(message)
  );
}

/**
 * Extract a stable token to use as the leaf of a Sentry fingerprint
 * array. Prefers the table:operation pair (highest-signal) and falls
 * back to a generic `'rollback-successful'` token so issues still group
 * sensibly when the cause chain doesn't surface a step name.
 */
export function rollbackFingerprintLeaf(err: unknown): string {
  const message = joinErrorCauseChain(err);
  if (!message) return "rollback-successful";

  const stepFailure = message.match(STEP_FAILURE_RE);
  if (stepFailure?.[1]) return stepFailure[1].toLowerCase();

  const stepNumber = message.match(STEP_NUMBER_FAILURE_RE);
  if (stepNumber?.[1]) return `step-${stepNumber[1]}`;

  return "rollback-successful";
}

/**
 * Build the Sentry fingerprint array for a recoverable rollback error.
 * The trailing `'{{default}}'` token tells the SDK to keep
 * stack-trace-based de-duplication alongside our manual grouping, so
 * unrelated rollbacks at distinct call sites still split into
 * different issues even when they share a step name.
 */
export function rollbackFingerprint(scope: string, err: unknown): string[] {
  return [scope, "rollback-successful", rollbackFingerprintLeaf(err), "{{default}}"];
}

/**
 * Match the pre-flight read failure thrown at the top of each
 * atomic-sync function when `getOfflineInspection` /
 * `getOfflineTraining` / `getOfflineDailyAssessment` returns null:
 *
 *   throw new Error("Inspection not found in local storage");
 *   throw new Error("Training not found in local storage");
 *   throw new Error("Daily assessment not found in local storage");
 *
 * Captures the record-type token so the fingerprint can split issues
 * by record kind.
 */
const LOCAL_RECORD_MISSING_RE =
  /(Inspection|Training|Daily assessment) not found in local storage/i;

/**
 * Returns true when the error is a "record disappeared from IDB before
 * sync could read it" — most often the record was soft-deleted /
 * quarantined / cleared between when the periodic-sync loop enumerated
 * dirty records and when the per-record sync function actually ran.
 *
 * The next periodic-sync tick won't see this record (because it's
 * gone), so there's nothing actionable for the inspector. Mirror the
 * Mode 13D treatment of recoverable rollbacks: classify as warning,
 * fingerprint-group so all occurrences collapse into one Sentry issue
 * per record kind that you can review weekly instead of N alerts per
 * occurrence.
 */
export function isLocalRecordMissing(err: unknown): boolean {
  const message = joinErrorCauseChain(err);
  if (!message) return false;
  return LOCAL_RECORD_MISSING_RE.test(message);
}

/**
 * Extract the record-type token (e.g. `'inspection'`,
 * `'training'`, `'daily-assessment'`) from a local-record-missing
 * error. Used as the leaf of a stable fingerprint so issues split by
 * record kind without splitting per record id.
 */
export function localRecordMissingLeaf(err: unknown): string {
  const message = joinErrorCauseChain(err);
  const match = message.match(LOCAL_RECORD_MISSING_RE);
  if (!match?.[1]) return "unknown-record";
  return match[1].toLowerCase().replace(/\s+/g, "-");
}

/**
 * Build the Sentry fingerprint array for a local-record-missing error.
 * Mirrors `rollbackFingerprint` shape with a distinct discriminator
 * token (`'local-record-missing'`) so it never collides with rollback
 * fingerprints even at the same scope.
 */
export function localRecordMissingFingerprint(scope: string, err: unknown): string[] {
  return [scope, "local-record-missing", localRecordMissingLeaf(err), "{{default}}"];
}

/**
 * Convenience: whichever recoverable class matches, build the right
 * fingerprint. Returns `undefined` when the error doesn't fit any of
 * the known recoverable shapes (caller should log as `error` with no
 * manual fingerprint).
 *
 * Atomic-sync catch sites use this so they don't have to branch on
 * which classifier matched — pass any caught error and get back the
 * `(level, fingerprint)` pair to forward to Sentry.
 */
export function classifyAtomicSyncError(
  scope: string,
  err: unknown,
): { level: "warning" | "error"; fingerprint: string[] | undefined } {
  if (isRecoverableRollback(err)) {
    return { level: "warning", fingerprint: rollbackFingerprint(scope, err) };
  }
  if (isLocalRecordMissing(err)) {
    return {
      level: "warning",
      fingerprint: localRecordMissingFingerprint(scope, err),
    };
  }
  return { level: "error", fingerprint: undefined };
}
