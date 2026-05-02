/**
 * Coverage for Mode 5 — desktop autosync retry budget + classifier-gated retry
 * in `atomic-sync-manager.ts`.
 *
 * Background: PR #94 added `isTransientNetworkError(message)` to exempt
 * transient network errors from the H5 3-strike quarantine counter, and
 * PR #101 (Mode 4) added `joinErrorCauseChain` so the classifier can
 * see leaf errors that the `executeAtomicTransaction` wrapper hides.
 *
 * Mode 5 closes the final gap: even with the classifier seeing the leaf,
 * desktop autosync had `maxRetries = capabilities.isMobile ? 2 : 1`, so
 * a single transient blip on a drain pass exhausted the per-record budget
 * after one attempt. With the spec's 30 s drain cadence and 120 s poll
 * window, only 4 single-shot attempts were possible — sustained Supabase
 * REST flake during cell-tower handoffs ate them all and the record sat
 * unsynced for the entire window.
 *
 * The Mode 5 fix at all three sync sites (inspection, training,
 * daily-assessment) in `atomic-sync-manager.ts`:
 *
 *   1. Replace the single `maxRetries` knob with a split budget:
 *        const persistentMaxRetries = capabilities.isMobile ? 2 : 1;
 *        const transientMaxRetries = 3;
 *        const maxRetries = Math.max(persistentMaxRetries, transientMaxRetries);
 *      `maxRetries` still bounds the outer `while` loop so the structure
 *      is preserved.
 *
 *   2. In the catch block, classify the joined cause-chain message and
 *      pick the right budget:
 *        const transient = isTransientNetworkError(message);
 *        const budget = transient ? transientMaxRetries : persistentMaxRetries;
 *        if (retryCount < budget && !signal?.aborted) { …retry… }
 *        else { …recordSyncFailure + break… }
 *
 *   3. The `break;` on the terminal else branch matters because
 *      `maxRetries` is now `3`, so without an explicit break the outer
 *      `while` would re-enter the loop after a persistent error fails
 *      out of `budget=1`, calling `recordSyncFailure` repeatedly and
 *      breaking the H5 3-strike accounting.
 *
 * These tests pin both the source-level shape of all three fix sites and
 * the end-to-end classification contract so a future refactor can't
 * silently revert the desktop budget or drop the break.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { joinErrorCauseChain } from "../atomic-sync-manager";
import { isTransientNetworkError } from "../sync-quarantine";

const ATOMIC_SYNC_PATH = resolve(__dirname, "../atomic-sync-manager.ts");
const ATOMIC_SYNC_SRC = readFileSync(ATOMIC_SYNC_PATH, "utf-8");

/**
 * Counts non-overlapping occurrences of `needle` in `haystack`.
 * Used so the source-shape assertions are tolerant of cosmetic
 * formatting changes around the snippet but still demand exactly
 * three call sites (inspection, training, daily-assessment).
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

describe("Mode 5 — desktop retry budget bumped to 3 at all three sync sites", () => {
  it("declares persistentMaxRetries with the original isMobile ? 2 : 1 fast-fail budget at all 3 sites", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "const persistentMaxRetries = capabilities.isMobile ? 2 : 1"
    );
    expect(occurrences).toBe(3);
  });

  it("declares transientMaxRetries = 3 at all 3 sites (parity across inspection / training / assessment)", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "const transientMaxRetries = 3"
    );
    expect(occurrences).toBe(3);
  });

  it("computes maxRetries via Math.max so the outer while loop has headroom for the wider transient budget", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "const maxRetries = Math.max(persistentMaxRetries, transientMaxRetries)"
    );
    expect(occurrences).toBe(3);
  });

  it("does NOT contain the old single-knob `const maxRetries = capabilities.isMobile ? 2 : 1;` form anywhere", () => {
    // The old form is what shipped pre-Mode-5; keeping any of the three
    // sites on the old single-knob would silently re-introduce the
    // single-attempt desktop bottleneck for transient flake.
    expect(ATOMIC_SYNC_SRC).not.toMatch(
      /const maxRetries = capabilities\.isMobile \? 2 : 1/
    );
  });
});

describe("Mode 5 — classifier-gated retry on the joined cause chain", () => {
  it("computes `transient = isTransientNetworkError(message)` at all 3 catch sites", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "const transient = isTransientNetworkError(message)"
    );
    expect(occurrences).toBe(3);
  });

  it("picks the budget based on the classifier result at all 3 catch sites", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "const budget = transient ? transientMaxRetries : persistentMaxRetries"
    );
    expect(occurrences).toBe(3);
  });

  it("gates the retry decision on `retryCount < budget` (not the old `maxRetries`) at all 3 catch sites", () => {
    const occurrences = countOccurrences(
      ATOMIC_SYNC_SRC,
      "if (retryCount < budget && !signal?.aborted)"
    );
    expect(occurrences).toBe(3);
  });

  it("breaks out of the retry loop on terminal failure at all 3 catch sites (so persistent errors don't re-enter under the wider while-loop bound)", () => {
    // The break appears once per else branch; without it, maxRetries=3
    // would re-enter the loop after a persistent error's budget=1
    // expired, calling recordSyncFailure repeatedly and over-counting
    // H5 strikes.
    const breakRegex =
      /break; \/\/ Mode 5: terminal failure — exit retry loop/g;
    const matches = ATOMIC_SYNC_SRC.match(breakRegex) ?? [];
    expect(matches.length).toBe(3);
  });
});

describe("Mode 5 — classifier + cause-walk integration (pins the gate's decision boundary)", () => {
  // These integration tests assert the actual decision the catch block
  // makes for a representative set of wrapped errors. They use the same
  // helpers (`joinErrorCauseChain` + `isTransientNetworkError`) the
  // catch block invokes, so a regression in either helper would surface
  // here without having to drive a full sync.

  function classify(error: unknown): boolean {
    return isTransientNetworkError(joinErrorCauseChain(error));
  }

  it("classifies a wrapped `Failed to fetch` leaf as transient (the dominant Mode 5 case)", () => {
    const leaf = new TypeError(
      "Failed to fetch (https://ssgzcgvygnsrqalisshx.supabase.co/rest/v1/inspections)"
    );
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(true);
  });

  it("classifies a wrapped `NetworkError` leaf as transient (Firefox / Safari variant)", () => {
    const leaf = new Error("NetworkError when attempting to fetch resource.");
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(true);
  });

  it("classifies a wrapped `Load failed` leaf as transient (Safari fetch variant)", () => {
    const leaf = new Error("Load failed");
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(true);
  });

  it("classifies a wrapped `net::ERR_NETWORK_CHANGED` leaf as transient (Chromium handoff variant)", () => {
    const leaf = new Error(
      "Failed to load resource: net::ERR_NETWORK_CHANGED"
    );
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(true);
  });

  it("classifies a wrapped `AbortError` leaf as transient (signal-cancellation variant)", () => {
    const leaf = new DOMException("The operation was aborted.", "AbortError");
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(true);
  });

  it("classifies a wrapped RLS policy error as PERSISTENT (must respect persistentMaxRetries fail-fast)", () => {
    const leaf = new Error(
      "new row violates row-level security policy for table \"inspections\""
    );
    const wrapper = new Error(
      "Step 1 (upsert:inspections) failed: see cause"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(false);
  });

  it("classifies a wrapped 0-rows error from a non-whitelisted table as PERSISTENT", () => {
    // PR #98 only exempts the four trigger-protected child tables; any
    // other table reporting `data.length === 0` is a real failure and
    // must NOT consume the wider transient budget.
    const leaf = new Error(
      "Step 2 (upsert:training_summary) affected 0 rows — possible RLS block or expired session"
    );
    const wrapper = new Error(
      "Transaction failed after 1/3 steps. Rollback: successful"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(false);
  });

  it("classifies a wrapped schema-cache mismatch as PERSISTENT (PostgREST PGRST204)", () => {
    const leaf = new Error(
      "Could not find the 'foo' column of 'inspections' in the schema cache"
    );
    const wrapper = new Error(
      "Step 1 (upsert:inspections) failed: see cause"
    );
    (wrapper as Error & { cause?: unknown }).cause = leaf;
    expect(classify(wrapper)).toBe(false);
  });

  it("classifies a bare wrapper with NO cause and NO transient leaf string as PERSISTENT", () => {
    // If the leaf was never stamped (e.g. a future regression in the
    // throw-site cause assignment), the wrapper string alone is what
    // the classifier sees. That string contains "Transaction failed
    // after N/M steps. Rollback: …" — none of the 16 transient regexes
    // match it, so the gate correctly falls back to fast-fail.
    const wrapper = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful"
    );
    expect(classify(wrapper)).toBe(false);
  });

  it("classifies a multi-level wrapped chain (transient leaf, mid-step wrapper, outer wrapper) as transient", () => {
    const leaf = new TypeError("Failed to fetch");
    const mid = new Error(
      "Step 2 (upsert:inspection_systems) failed: see cause"
    );
    (mid as Error & { cause?: unknown }).cause = leaf;
    const outer = new Error(
      "Transaction failed after 1/3 steps. Rollback: successful"
    );
    (outer as Error & { cause?: unknown }).cause = mid;
    expect(classify(outer)).toBe(true);
  });
});

describe("Mode 5 — retry-loop semantics derived from the budget gate", () => {
  // These tests don't drive the actual sync; they document the
  // arithmetic of the gate so the contract is reviewable in one place.

  /**
   * Mirrors the gate logic in each catch site: given the platform
   * (mobile vs desktop) and the error class (transient vs persistent),
   * how many retries does the loop allow?
   */
  function attemptsAllowed(
    isMobile: boolean,
    isTransient: boolean
  ): number {
    const persistentMaxRetries = isMobile ? 2 : 1;
    const transientMaxRetries = 3;
    const budget = isTransient ? transientMaxRetries : persistentMaxRetries;
    // 1 initial attempt + (budget - 1) retries before the gate exits.
    return budget;
  }

  it("desktop transient: 3 attempts (was 1 pre-Mode-5)", () => {
    expect(attemptsAllowed(false, true)).toBe(3);
  });

  it("desktop persistent: 1 attempt (preserves fail-fast for hard failures)", () => {
    expect(attemptsAllowed(false, false)).toBe(1);
  });

  it("mobile transient: 3 attempts (was 2 pre-Mode-5)", () => {
    expect(attemptsAllowed(true, true)).toBe(3);
  });

  it("mobile persistent: 2 attempts (preserves the original mobile budget)", () => {
    expect(attemptsAllowed(true, false)).toBe(2);
  });
});
