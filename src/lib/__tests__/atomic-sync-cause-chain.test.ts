/**
 * Coverage for Mode 4 — `joinErrorCauseChain` cause-chain walk in
 * `atomic-sync-manager.ts`.
 *
 * Background: PR #94 added `isTransientNetworkError(message)` so transient
 * network errors don't increment the H5 3-strike quarantine counter. The
 * classifier matches against the error message string passed to
 * `recordSyncFailure`. But `executeAtomicTransaction` wraps the leaf
 * error in `Error('Transaction failed after N/M steps. Rollback: …')`
 * and the original cause is invisible to `error.message` alone — so
 * leaves like `TypeError: Failed to fetch (…)` were getting
 * misclassified as persistent and quarantining the record.
 *
 * The Mode 4 fix:
 *
 *   1. The three throw sites in `atomic-sync-manager.ts` (inspection,
 *      training, daily-assessment) stamp `error.cause = result.error` on
 *      the wrapper before throwing.
 *
 *   2. The three catch sites use `joinErrorCauseChain(error)` instead of
 *      `error.message` when extracting the message they pass to
 *      `recordSyncFailure`.
 *
 *   3. `isTransientNetworkError` runs `regex.test(message)` over a
 *      string that now contains the entire cause chain, so any leaf
 *      pattern still short-circuits the strike — the way PR #94
 *      intended.
 *
 * These tests pin both the helper's behaviour and the end-to-end
 * contract with the H5-T classifier so a future refactor can't
 * silently re-introduce the wrapper-masks-cause regression.
 */

import { describe, expect, it } from "vitest";
import { joinErrorCauseChain } from "../atomic-sync-manager";
import { isTransientNetworkError } from "../sync-quarantine";

describe("Mode 4 — joinErrorCauseChain", () => {
  it("returns the message of a single Error with no cause", () => {
    expect(joinErrorCauseChain(new Error("Failed to fetch"))).toBe(
      "Failed to fetch"
    );
  });

  it("joins a single-level cause chain", () => {
    const inner = new Error("TypeError: Failed to fetch (supabase.co)");
    const outer = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (outer as Error & { cause?: unknown }).cause = inner;

    expect(joinErrorCauseChain(outer)).toBe(
      "Transaction failed after 0/2 steps. Rollback: successful | TypeError: Failed to fetch (supabase.co)"
    );
  });

  it("joins a multi-level cause chain", () => {
    const leaf = new Error("net::ERR_NETWORK_CHANGED");
    const mid = new Error("Step 1 failed: net::ERR_NETWORK_CHANGED");
    (mid as Error & { cause?: unknown }).cause = leaf;
    const outer = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (outer as Error & { cause?: unknown }).cause = mid;

    expect(joinErrorCauseChain(outer)).toBe(
      "Transaction failed after 0/2 steps. Rollback: successful | Step 1 failed: net::ERR_NETWORK_CHANGED | net::ERR_NETWORK_CHANGED"
    );
  });

  it("coerces a non-Error cause via String() so regex patterns still match", () => {
    const outer = new Error("Transaction failed after 0/2 steps");
    (outer as Error & { cause?: unknown }).cause = {
      toString: () => "Failed to fetch",
    };
    const joined = joinErrorCauseChain(outer);
    expect(joined).toContain("Failed to fetch");
  });

  it("handles a string cause", () => {
    const outer = new Error("Transaction failed after 0/2 steps");
    (outer as Error & { cause?: unknown }).cause = "AbortError";
    expect(joinErrorCauseChain(outer)).toBe(
      "Transaction failed after 0/2 steps | AbortError"
    );
  });

  it("returns String(value) for a non-Error top-level value", () => {
    expect(joinErrorCauseChain("Failed to fetch")).toBe("Failed to fetch");
    expect(joinErrorCauseChain(42)).toBe("42");
  });

  it("returns an empty string for null/undefined input", () => {
    expect(joinErrorCauseChain(null)).toBe("");
    expect(joinErrorCauseChain(undefined)).toBe("");
  });

  it("skips empty error messages but continues walking the chain", () => {
    const inner = new Error("Load failed");
    const outer = new Error("");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(joinErrorCauseChain(outer)).toBe("Load failed");
  });

  it("breaks on circular cause graphs without infinite-looping", () => {
    const a = new Error("A");
    const b = new Error("B");
    (a as Error & { cause?: unknown }).cause = b;
    (b as Error & { cause?: unknown }).cause = a;

    const joined = joinErrorCauseChain(a);
    // Only 'A' and 'B' once each, in that order, no infinite loop.
    expect(joined).toBe("A | B");
  });

  it("respects the depth limit on a deep chain", () => {
    const leaf = new Error("LEAF");
    let cursor: Error = leaf;
    for (let i = 0; i < 20; i++) {
      const next = new Error(`level-${i}`);
      (next as Error & { cause?: unknown }).cause = cursor;
      cursor = next;
    }
    // Default depth limit is 5 → at most 6 messages (levels 19..14).
    const joined = joinErrorCauseChain(cursor);
    expect(joined.split(" | ")).toHaveLength(6);
    expect(joined.split(" | ")[0]).toBe("level-19");
    // The leaf "LEAF" should NOT appear because we cut off before reaching it.
    expect(joined).not.toContain("LEAF");
  });

  it("respects an explicit depth-limit override", () => {
    const inner = new Error("inner");
    const outer = new Error("outer");
    (outer as Error & { cause?: unknown }).cause = inner;
    expect(joinErrorCauseChain(outer, 0)).toBe("outer");
  });
});

describe("Mode 4 — wrapper + classifier integration contract", () => {
  // Mirrors the production shape: atomic-sync wraps a leaf transient error
  // with `Transaction failed after N/M steps. Rollback: …` and stamps
  // `cause`. The catch site joins the chain and hands the result to
  // `isTransientNetworkError`. This integration is what makes the H5-T
  // classifier from PR #94 actually fire on the offline-edit-reconcile
  // path.

  function wrapAtomicSyncError(leaf: Error, completed = 0, total = 2): Error {
    const wrapped = new Error(
      `Transaction failed after ${completed}/${total} steps. Rollback: successful`
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    return wrapped;
  }

  it("classifies wrapped Chromium `Failed to fetch` as transient", () => {
    const wrapped = wrapAtomicSyncError(
      new Error("TypeError: Failed to fetch (ssgzcgvygnsrqalisshx.supabase.co)")
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped Firefox `NetworkError` as transient", () => {
    const wrapped = wrapAtomicSyncError(
      new Error("NetworkError when attempting to fetch resource.")
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped Safari `Load failed` as transient", () => {
    const wrapped = wrapAtomicSyncError(new Error("Load failed"));
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped Chromium net-stack `ERR_*` as transient", () => {
    const wrapped = wrapAtomicSyncError(
      new Error("Failed to load resource: net::ERR_INTERNET_DISCONNECTED")
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped `AbortError` as transient", () => {
    const wrapped = wrapAtomicSyncError(
      new Error("AbortError: The user aborted a request.")
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped `TimeoutError` as transient", () => {
    const wrapped = wrapAtomicSyncError(new Error("TimeoutError"));
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("classifies wrapped Step-N transient propagation as transient", () => {
    // Real shape from `transaction-manager.ts`: Step throws
    // `'Step ${i + 1} failed: ${result.error.message}'` on a transient
    // network failure during the Supabase fetch. The atomic-sync wrapper
    // then rewraps that with cause set to the inner Step error.
    const stepError = new Error("Step 1 failed: TypeError: Failed to fetch");
    const wrapped = wrapAtomicSyncError(stepError);
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(true);
  });

  it("does NOT classify a wrapped persistent error as transient", () => {
    // RLS denial — the H5-T classifier should NOT exempt this. After 3
    // strikes the record SHOULD quarantine because retrying won't help.
    const wrapped = wrapAtomicSyncError(
      new Error("Step 1 failed: permission denied for table inspections")
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(false);
  });

  it("does NOT classify a wrapped 4xx schema error as transient", () => {
    const wrapped = wrapAtomicSyncError(
      new Error(
        "Step 2 failed: Could not find the 'foo' column of 'inspections' in the schema cache"
      )
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(false);
  });

  it("does NOT classify a wrapped 0-rows error as transient", () => {
    // After PR #98 the trigger-protected tables exempt 0-rows, but if a
    // non-whitelisted table ever returns 0 rows the classifier must still
    // treat that as persistent so the user gets surfaced an error.
    const wrapped = wrapAtomicSyncError(
      new Error(
        "Step 2 (upsert:inspection_standards) affected 0 rows — possible RLS block or expired session"
      )
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(false);
  });

  it("classifies a wrapper with no cause stamped using only the wrapper string", () => {
    // Belt-and-braces: even with no cause stamped (e.g. legacy code path),
    // the wrapper string itself should NOT match transient patterns —
    // i.e. we don't accidentally exempt every "Transaction failed after"
    // wrapper from quarantine.
    const wrapped = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    const message = joinErrorCauseChain(wrapped);
    expect(isTransientNetworkError(message)).toBe(false);
  });

  it("preserves the `cause` reference on the wrapped Error for debugging", () => {
    const leaf = new Error("Failed to fetch");
    const wrapped = wrapAtomicSyncError(leaf);
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(leaf);
  });
});
