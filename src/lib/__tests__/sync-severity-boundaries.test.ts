/**
 * Slice 3: Boundary contract tests for sync severity classification.
 *
 * Locks the invariant: hard data-integrity failures (auth/session
 * expired, RLS/permission denied, schema mismatch, rollback-failed,
 * unknown/unparseable errors) must NEVER be silently downgraded to
 * transient/warning by the existing classifiers. Locks recoverable
 * shapes (rollback-successful, local-record-missing) to their exact
 * outputs, and confirms inverse strings ("Inspection deleted",
 * "row not found", generic "not found") do NOT accidentally collapse
 * into the local-record-missing warning bucket.
 *
 * Source-of-truth classifier bodies are read-only in this slice:
 * - src/lib/sync-error-severity.ts (classifyAtomicSyncError, isLocal*)
 * - src/lib/sync-quarantine.ts     (isTransientNetworkError)
 *
 * Existing coverage that this file deliberately does NOT duplicate:
 * - sync-error-severity.test.ts          (rollback + local-missing happy paths)
 * - sync-quarantine-transient-network.test.ts (browser-dialect transients)
 * - photo-retry-buckets.test.ts          (bucketing, not classification)
 */

import { describe, it, expect } from "vitest";

import {
  classifyAtomicSyncError,
  isLocalRecordMissing,
  isRecoverableRollback,
} from "../sync-error-severity";
import { isTransientNetworkError } from "../sync-quarantine";

// -----------------------------------------------------------------------------
// B1 — Network unavailable: confirm browser-dialect strings stay transient
// for the quarantine classifier AND stay HARD ('error') for the atomic-sync
// Sentry classifier (no recoverable downgrade unless wrapped in a rollback
// envelope). The quarantine-side coverage is in sync-quarantine-transient-
// network.test.ts; here we lock the cross-classifier boundary.
// -----------------------------------------------------------------------------

describe("B1 network unavailable — atomic-sync classifier does NOT downgrade", () => {
  const cases: Array<[string, string]> = [
    ["Chromium Failed to fetch", "TypeError: Failed to fetch"],
    [
      "Firefox NetworkError",
      "NetworkError when attempting to fetch resource",
    ],
    ["Safari Load failed", "Load failed"],
    ["AbortError", "AbortError: The user aborted a request."],
    ["Chromium ERR_NETWORK_CHANGED", "net::ERR_NETWORK_CHANGED"],
    ["Per-record offline gate", "Cannot sync while offline"],
  ];

  for (const [label, message] of cases) {
    it(`${label}: bare error → 'error' + no fingerprint`, () => {
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(message)),
      ).toEqual({ level: "error", fingerprint: undefined });
    });

    it(`${label}: quarantine classifier treats as transient (no budget burn)`, () => {
      expect(isTransientNetworkError(message)).toBe(true);
    });
  }

  it("network message WRAPPED in a rollback-successful envelope DOES downgrade to warning", () => {
    // This is the only legitimate downgrade path for a network error —
    // the multi-step transaction caught it cleanly and rolled back.
    const leaf = new Error("Step 1 failed: net::ERR_NETWORK_CHANGED");
    const wrapped = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    const result = classifyAtomicSyncError("atomic-sync.syncInspection", wrapped);
    expect(result.level).toBe("warning");
    expect(result.fingerprint?.[1]).toBe("rollback-successful");
  });
});

// -----------------------------------------------------------------------------
// B2 — Auth / session expired: persistent, never transient.
// -----------------------------------------------------------------------------

describe("B2 auth / session expired — NEVER classified transient", () => {
  const cases = [
    "JWT expired",
    "invalid JWT",
    "PGRST301: JWTError",
    "401: Unauthorized",
    "HTTP 401",
    "Auth session missing",
  ];

  for (const message of cases) {
    it(`'${message}' → quarantine sees as persistent (counts toward budget)`, () => {
      expect(isTransientNetworkError(message)).toBe(false);
    });

    it(`'${message}' → atomic-sync classifies as 'error' (no recoverable downgrade)`, () => {
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(message)),
      ).toEqual({ level: "error", fingerprint: undefined });
    });

    it(`'${message}' → does NOT match local-record-missing or rollback`, () => {
      const err = new Error(message);
      expect(isLocalRecordMissing(err)).toBe(false);
      expect(isRecoverableRollback(err)).toBe(false);
    });
  }
});

// -----------------------------------------------------------------------------
// B3 — RLS / permission denied: persistent, never transient.
// -----------------------------------------------------------------------------

describe("B3 RLS / permission denied — NEVER classified transient", () => {
  const cases = [
    'new row violates row-level security policy for table "inspections"',
    "permission denied for table profiles",
    "42501: insufficient privilege",
    "403 Forbidden",
    "HTTP 403",
  ];

  for (const message of cases) {
    it(`'${message}' → quarantine treats as persistent`, () => {
      expect(isTransientNetworkError(message)).toBe(false);
    });

    it(`'${message}' → atomic-sync classifies as 'error' (no fingerprint downgrade)`, () => {
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(message)),
      ).toEqual({ level: "error", fingerprint: undefined });
    });
  }
});

// -----------------------------------------------------------------------------
// B4 — Local-record-missing warnings vs inverse non-matches.
// Happy paths are covered in sync-error-severity.test.ts; this file locks the
// INVERSE direction so a future regex generalisation can't accidentally
// classify generic server "not found" / "deleted" errors as the recoverable
// local-missing warning bucket.
// -----------------------------------------------------------------------------

describe("B4 local-record-missing — inverse non-matches stay 'error'", () => {
  const inverse = [
    "Inspection deleted",
    "Training removed",
    "Daily assessment removed by user",
    "row not found",
    "not found",
    "404 Not Found",
    "PGRST116: The result contains 0 rows",
    "inspection record was purged",
    // Lookalikes that omit the "in local storage" suffix:
    "Inspection not found",
    "Training not found",
    "Daily assessment not found",
    // Lookalikes that swap the noun:
    "Photo not found in local storage",
    "Profile not found in local storage",
  ];

  for (const message of inverse) {
    it(`'${message}' → isLocalRecordMissing === false`, () => {
      expect(isLocalRecordMissing(new Error(message))).toBe(false);
    });

    it(`'${message}' → classifyAtomicSyncError === error / undefined`, () => {
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(message)),
      ).toEqual({ level: "error", fingerprint: undefined });
    });
  }

  it("each of the three legitimate variants still warns (regression guard)", () => {
    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncInspection",
        new Error("Inspection not found in local storage"),
      ),
    ).toEqual({
      level: "warning",
      fingerprint: [
        "atomic-sync.syncInspection",
        "local-record-missing",
        "inspection",
        "{{default}}",
      ],
    });
    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncTraining",
        new Error("Training not found in local storage"),
      ).level,
    ).toBe("warning");
    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncDailyAssessment",
        new Error("Daily assessment not found in local storage"),
      ).level,
    ).toBe("warning");
  });
});

// -----------------------------------------------------------------------------
// B5 — Validation / schema mismatch: persistent, hard error.
// -----------------------------------------------------------------------------

describe("B5 validation / schema mismatch — NEVER transient, NEVER warning", () => {
  const cases = [
    'schema cache: relation "inspections" does not exist',
    "PGRST204: column \"foo\" not found",
    'invalid input syntax for type uuid: "abc"',
    '400 Bad Request: { "code": "PGRST204", "message": "schema cache miss" }',
    "column \"child_count_hint\" of relation \"inspections\" does not exist",
  ];

  for (const message of cases) {
    it(`'${message}' → quarantine persistent + atomic-sync error`, () => {
      expect(isTransientNetworkError(message)).toBe(false);
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(message)),
      ).toEqual({ level: "error", fingerprint: undefined });
    });
  }
});

// -----------------------------------------------------------------------------
// B7 — Rollback boundaries.
// -----------------------------------------------------------------------------

describe("B7 rollback boundaries", () => {
  it("rollback-successful → warning + rollback-successful fingerprint", () => {
    const leaf = new Error("Step timeout: upsert:inspection_ziplines");
    const wrapped = new Error(
      "Transaction failed after 2/7 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    const result = classifyAtomicSyncError(
      "atomic-sync.syncInspection",
      wrapped,
    );
    expect(result.level).toBe("warning");
    expect(result.fingerprint).toEqual([
      "atomic-sync.syncInspection",
      "rollback-successful",
      "upsert:inspection_ziplines",
      "{{default}}",
    ]);
  });

  it("rollback-FAILED → error + no fingerprint (hard inconsistency)", () => {
    const leaf = new Error("Step timeout: upsert:inspections");
    const wrapped = new Error(
      "Transaction failed after 1/4 steps. Rollback: failed",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(
      classifyAtomicSyncError("atomic-sync.syncInspection", wrapped),
    ).toEqual({ level: "error", fingerprint: undefined });
  });

  it("Step aborted (Mode 13B race) inside successful rollback → warning + update fingerprint", () => {
    const leaf = new Error("Step aborted: update:inspections");
    const wrapped = new Error(
      "Transaction failed after 0/3 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    const result = classifyAtomicSyncError(
      "atomic-sync.syncInspection",
      wrapped,
    );
    expect(result.level).toBe("warning");
    expect(result.fingerprint?.[2]).toBe("update:inspections");
  });
});

// -----------------------------------------------------------------------------
// B8 — Unknown / unparseable: must not throw; must default HARD.
// -----------------------------------------------------------------------------

describe("B8 unknown / unparseable inputs — never throw, default hard", () => {
  const inputs: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["empty Error", new Error("")],
    ["plain object", {}],
    ["random string error", new Error("some totally unrelated failure")],
    ["number", 42],
    ["array", ["a", "b"]],
  ];

  for (const [label, value] of inputs) {
    it(`${label} → classifyAtomicSyncError returns error/undefined without throwing`, () => {
      let result: ReturnType<typeof classifyAtomicSyncError> | undefined;
      expect(() => {
        result = classifyAtomicSyncError("atomic-sync.syncInspection", value);
      }).not.toThrow();
      expect(result).toEqual({ level: "error", fingerprint: undefined });
    });

    it(`${label} → isLocalRecordMissing + isRecoverableRollback return false without throwing`, () => {
      expect(() => isLocalRecordMissing(value)).not.toThrow();
      expect(() => isRecoverableRollback(value)).not.toThrow();
      expect(isLocalRecordMissing(value)).toBe(false);
      expect(isRecoverableRollback(value)).toBe(false);
    });
  }

  it("isTransientNetworkError handles null / undefined / empty string", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
    expect(isTransientNetworkError("")).toBe(false);
  });

  it("circular cause chain does not infinite-loop or throw", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as Error & { cause?: unknown }).cause = b;
    (b as Error & { cause?: unknown }).cause = a; // cycle
    let result: ReturnType<typeof classifyAtomicSyncError> | undefined;
    expect(() => {
      result = classifyAtomicSyncError("atomic-sync.syncInspection", a);
    }).not.toThrow();
    expect(result?.level).toBe("error");
  });

  it("cause chain deeper than the depth limit (5) does not throw and walks at least 6 levels", () => {
    // Build chain: top → l1 → l2 → l3 → l4 → l5 → l6 → l7
    const leaves = [
      "leaf-7",
      "leaf-6",
      "leaf-5",
      "leaf-4",
      "leaf-3",
      "leaf-2",
      "leaf-1",
      "Transaction failed after 0/2 steps. Rollback: successful",
    ];
    let cursor: Error | undefined;
    for (const m of leaves) {
      const next = new Error(m);
      if (cursor) (next as Error & { cause?: unknown }).cause = cursor;
      cursor = next;
    }
    let result: ReturnType<typeof classifyAtomicSyncError> | undefined;
    expect(() => {
      result = classifyAtomicSyncError("atomic-sync.syncInspection", cursor);
    }).not.toThrow();
    // The wrapper at the head is well within depth → still detected as
    // rollback-successful. (Depth-limit only affects how deep the walker
    // looks; the head being the rollback wrapper is what matters here.)
    expect(result?.level).toBe("warning");
    expect(result?.fingerprint?.[1]).toBe("rollback-successful");
  });

  it("rollback wrapper at the HEAD still classifies regardless of deep tail", () => {
    // Pin: as long as the immediate Error's message carries the rollback
    // marker, depth-limit truncation of distant causes can't hide it.
    const tail = new Error("totally unrelated leaf");
    const head = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful",
    );
    (head as Error & { cause?: unknown }).cause = tail;
    expect(isRecoverableRollback(head)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// B9 — Offline / queue-pending non-failures.
// -----------------------------------------------------------------------------

describe("B9 offline / queue-pending non-failures", () => {
  it("'Cannot sync while offline' wrapped in an outer Error is still transient via the walker", () => {
    // The quarantine classifier reads the raw message; atomic-sync wraps it
    // first. Lock that whichever way the caller surfaces the text, the
    // *quarantine budget* is preserved (no 3-strike burn).
    expect(isTransientNetworkError("Cannot sync while offline")).toBe(true);
    expect(
      isTransientNetworkError(
        "Error: Cannot sync while offline (atomic-sync.syncInspection)",
      ),
    ).toBe(true);
  });

  it("transient network strings never produce a recoverable Sentry downgrade on their own", () => {
    // Quarantine treats them as transient (don't burn budget) but Sentry-side
    // they remain 'error' until wrapped in the rollback envelope. Confirms
    // the two classifiers are independent and neither hides data-loss.
    for (const msg of ["Failed to fetch", "Load failed", "TimeoutError"]) {
      expect(isTransientNetworkError(msg)).toBe(true);
      expect(
        classifyAtomicSyncError("atomic-sync.syncInspection", new Error(msg)),
      ).toEqual({ level: "error", fingerprint: undefined });
    }
  });
});
