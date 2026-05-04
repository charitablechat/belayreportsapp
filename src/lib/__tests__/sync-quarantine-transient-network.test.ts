/**
 * Coverage for H5-T (transient-network classifier in `sync-quarantine.ts`).
 *
 * Background: `recordSyncFailure` previously incremented its 3-strike
 * counter on every error, so a 15-30 s offline blip during three
 * consecutive adaptive-sync cycles was enough to quarantine a record
 * until end-of-day. The record then disappeared from `getNextBatch` /
 * `unsyncedCount` and a real user on a flaky cell signal could lose
 * visibility on an in-flight edit until midnight UTC. Same race
 * deterministically broke the `offline-edit-reconcile.spec.ts` e2e gate
 * across 14+ PRs.
 *
 * H5-T classifies messages so transient network / timeout failures
 * (`Failed to fetch`, `NetworkError`, `Load failed`, `ERR_*`,
 * `AbortError`, `TimeoutError`, `Operation timed out`, …) short-circuit
 * out of `recordSyncFailure` before incrementing the map. Persistent
 * errors (4xx/5xx schema mismatches, RLS denials, deserialization
 * failures, …) still quarantine after 3 strikes as before.
 *
 * These tests pin the contract so a future refactor can't accidentally
 * re-introduce the regression — and so the e2e gate stays meaningful.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  isTransientNetworkError,
  recordSyncFailure,
  isQuarantined,
} from "../sync-quarantine";

const STORAGE_KEY = "sync-quarantine-v1";

function resetSessionStorage() {
  sessionStorage.clear();
}

describe("H5-T — isTransientNetworkError classifier", () => {
  it("matches Chromium offline error", () => {
    expect(
      isTransientNetworkError(
        "TypeError: Failed to fetch (ssgzcgvygnsrqalisshx.supabase.co)",
      ),
    ).toBe(true);
    expect(isTransientNetworkError("Failed to fetch")).toBe(true);
  });

  it("matches Firefox offline error", () => {
    expect(
      isTransientNetworkError(
        "NetworkError when attempting to fetch resource",
      ),
    ).toBe(true);
    expect(isTransientNetworkError("NetworkError")).toBe(true);
  });

  it("matches Safari pre-iOS-17 fetch failure", () => {
    expect(isTransientNetworkError("Load failed")).toBe(true);
  });

  it("matches Chromium net-stack error codes", () => {
    expect(
      isTransientNetworkError(
        "Failed to load resource: net::ERR_INTERNET_DISCONNECTED",
      ),
    ).toBe(true);
    expect(isTransientNetworkError("net::ERR_NETWORK_CHANGED")).toBe(true);
    expect(isTransientNetworkError("net::ERR_NAME_NOT_RESOLVED")).toBe(true);
    expect(isTransientNetworkError("net::ERR_CONNECTION_RESET")).toBe(true);
    expect(isTransientNetworkError("net::ERR_CONNECTION_TIMED_OUT")).toBe(true);
  });

  it("matches abort + timeout signals", () => {
    expect(isTransientNetworkError("AbortError")).toBe(true);
    expect(
      isTransientNetworkError(
        "AbortError: The user aborted a request.",
      ),
    ).toBe(true);
    expect(isTransientNetworkError("The operation was aborted")).toBe(true);
    expect(isTransientNetworkError("TimeoutError")).toBe(true);
    expect(
      isTransientNetworkError(
        "[Offline Storage] Operation timed out after 5000ms",
      ),
    ).toBe(true);
    expect(
      isTransientNetworkError(
        "[InspectionForm] Supabase query timed out after 8000 ms",
      ),
    ).toBe(true);
  });

  // Mode 12 — `Error("Cannot sync while offline")` is what
  // `syncInspectionAtomic` / `syncTrainingAtomic` /
  // `syncDailyAssessmentAtomic` historically threw from the per-record
  // `if (!navigator.onLine)` gate. When `navigator.onLine` briefly flaps to
  // false during a retry — e.g. Chromium's NetworkChangeNotifier reacting
  // to a transient Supabase REST flake — the retry loop catches this
  // freshly-thrown Error (no cause chain), classifies it persistent, and
  // collapses the retry budget to `persistentMaxRetries=1`, terminal-failing
  // the record after one attempt. PR #119 (run 25297495407) showed this
  // happening deterministically in CI: the per-record sync hit the gate
  // 880 ms after the first attempt and exited the retry loop instantly,
  // even though `navigator.onLine` flipped back to true 4 s later.
  it("Mode 12: matches per-record offline gate string", () => {
    expect(isTransientNetworkError("Cannot sync while offline")).toBe(true);
    expect(
      isTransientNetworkError("Error: Cannot sync while offline"),
    ).toBe(true);
    // Case-insensitivity — defensive, in case copy ever drifts.
    expect(isTransientNetworkError("cannot sync while offline")).toBe(true);
  });

  it("does NOT match persistent server / schema errors", () => {
    expect(
      isTransientNetworkError(
        'duplicate key value violates unique constraint "inspections_pkey"',
      ),
    ).toBe(false);
    expect(
      isTransientNetworkError(
        'column "child_count_hint" of relation "inspections" does not exist',
      ),
    ).toBe(false);
    expect(
      isTransientNetworkError(
        "new row violates row-level security policy for table \"inspections\"",
      ),
    ).toBe(false);
    expect(isTransientNetworkError("Bad Request")).toBe(false);
    expect(isTransientNetworkError("Internal Server Error")).toBe(false);
    expect(isTransientNetworkError("403 Forbidden")).toBe(false);
    expect(isTransientNetworkError("PostgREST schema cache miss")).toBe(false);
    expect(isTransientNetworkError("unknown")).toBe(false);
    expect(isTransientNetworkError("")).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});

describe("H5-T — recordSyncFailure short-circuits on transient errors", () => {
  beforeEach(() => {
    resetSessionStorage();
  });

  it("100 consecutive Failed-to-fetch failures never quarantine", () => {
    for (let i = 0; i < 100; i++) {
      const result = recordSyncFailure(
        "rec-network",
        "TypeError: Failed to fetch",
      );
      expect(result).toBe(false);
    }
    expect(isQuarantined("rec-network")).toBe(false);
    // The map should still be empty — transient errors don't even create
    // an entry, so a later persistent error starts from zero.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("100 consecutive NetworkError failures never quarantine", () => {
    for (let i = 0; i < 100; i++) {
      expect(
        recordSyncFailure("rec-firefox", "NetworkError"),
      ).toBe(false);
    }
    expect(isQuarantined("rec-firefox")).toBe(false);
  });

  it("3 persistent 'Bad Request' failures DO quarantine", () => {
    expect(recordSyncFailure("rec-bad", "Bad Request")).toBe(false);
    expect(recordSyncFailure("rec-bad", "Bad Request")).toBe(false);
    expect(recordSyncFailure("rec-bad", "Bad Request")).toBe(true);
    expect(isQuarantined("rec-bad")).toBe(true);
  });

  it("transient failures never count, even when interleaved with persistent ones", () => {
    // 2x transient → 0 count
    expect(recordSyncFailure("rec-mixed", "Failed to fetch")).toBe(false);
    expect(recordSyncFailure("rec-mixed", "TimeoutError")).toBe(false);
    expect(isQuarantined("rec-mixed")).toBe(false);

    // 1x persistent → count = 1
    expect(recordSyncFailure("rec-mixed", "Bad Request")).toBe(false);

    // 2 more transient → count still 1
    expect(recordSyncFailure("rec-mixed", "Failed to fetch")).toBe(false);
    expect(
      recordSyncFailure(
        "rec-mixed",
        "net::ERR_INTERNET_DISCONNECTED",
      ),
    ).toBe(false);
    expect(isQuarantined("rec-mixed")).toBe(false);

    // 2 more persistent → count = 3 → quarantined
    expect(recordSyncFailure("rec-mixed", "schema cache miss")).toBe(false);
    expect(recordSyncFailure("rec-mixed", "RLS denial")).toBe(true);
    expect(isQuarantined("rec-mixed")).toBe(true);
  });

  it("the offline-edit-reconcile flake scenario no longer quarantines", () => {
    // Reproduces the exact log sequence from the failing CI run:
    //   1) atomic sync mid-flight when context.setOffline(true) fires
    //   2) Step 1 fails with `TypeError: Failed to fetch (...supabase.co)`
    //   3) atomic-sync's maxRetries=1 burns through; recordSyncFailure called
    //   4) adaptive interval fires next cycle; still offline; same error
    //   5) third cycle; still offline; same error
    // Pre-fix: 3 increments → quarantined → record dropped from drain →
    //          120s waitForInspectionLocationInCloud timeout.
    // Post-fix: every increment short-circuits → record stays in queue →
    //           drain succeeds the moment connectivity returns.
    const networkErr =
      "Transaction failed after 0/2 steps. Rollback: successful";
    // ^ This is what actually surfaces — it's NOT a transient string.
    // Verify it DOES still count (it's the inner step's wrapper, the
    // underlying network failure is what we want classified).
    expect(isTransientNetworkError(networkErr)).toBe(false);

    // The actual atomic-sync error message that bubbles through to
    // recordSyncFailure starts with "TypeError: Failed to fetch …"
    // (see atomic-sync-manager.ts:1505: `error instanceof Error ?
    // error.message : String(error)`). Pin THAT contract:
    const realMsg =
      "TypeError: Failed to fetch (ssgzcgvygnsrqalisshx.supabase.co)";
    for (let cycle = 1; cycle <= 5; cycle++) {
      expect(recordSyncFailure("rec-flake", realMsg)).toBe(false);
    }
    expect(isQuarantined("rec-flake")).toBe(false);
  });
});
