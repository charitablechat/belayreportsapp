/**
 * Mode 13: Contract tests for sync-error severity classification.
 *
 * The atomic-sync catch sites use these helpers to decide whether a
 * caught error should be forwarded to Sentry as `warning` (handled,
 * recoverable rollback) or `error` (real inconsistency the inspector
 * may need to act on).
 */

import { describe, it, expect } from "vitest";

import {
  isRecoverableRollback,
  rollbackFingerprintLeaf,
  rollbackFingerprint,
  isLocalRecordMissing,
  localRecordMissingLeaf,
  localRecordMissingFingerprint,
  classifyAtomicSyncError,
} from "../sync-error-severity";

describe("isRecoverableRollback", () => {
  it("returns true for the production wrapped-rollback shape we care about", () => {
    const leaf = new Error("Step timeout: upsert:inspection_ziplines");
    const wrapped = new Error(
      "Transaction failed after 2/7 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(isRecoverableRollback(wrapped)).toBe(true);
  });

  it("returns true even when the wrapper does not carry a cause chain", () => {
    expect(
      isRecoverableRollback(
        new Error("Transaction failed after 0/2 steps. Rollback: successful"),
      ),
    ).toBe(true);
  });

  it("returns false when the rollback itself failed (real inconsistency)", () => {
    const leaf = new Error("Step timeout: upsert:inspections");
    const wrapped = new Error(
      "Transaction failed after 1/4 steps. Rollback: failed",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(isRecoverableRollback(wrapped)).toBe(false);
  });

  it("returns false for unrelated errors (RLS / schema / 4xx)", () => {
    expect(
      isRecoverableRollback(
        new Error("new row violates row-level security policy"),
      ),
    ).toBe(false);
    expect(
      isRecoverableRollback(new Error("schema cache: relation not found")),
    ).toBe(false);
    expect(isRecoverableRollback(null)).toBe(false);
    expect(isRecoverableRollback(undefined)).toBe(false);
  });
});

describe("rollbackFingerprintLeaf", () => {
  it("extracts the table:operation pair from a Step timeout cause", () => {
    const leaf = new Error("Step timeout: upsert:inspection_ziplines");
    const wrapped = new Error(
      "Transaction failed after 2/7 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(rollbackFingerprintLeaf(wrapped)).toBe("upsert:inspection_ziplines");
  });

  it("extracts the table:operation pair from a Step aborted cause (Mode 13B race)", () => {
    const leaf = new Error("Step aborted: update:inspections");
    const wrapped = new Error(
      "Transaction failed after 0/3 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(rollbackFingerprintLeaf(wrapped)).toBe("update:inspections");
  });

  it("falls back to step-N when only a step number is available", () => {
    const wrapped = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful | Step 1 failed: net::ERR_NETWORK_CHANGED",
    );
    expect(rollbackFingerprintLeaf(wrapped)).toBe("step-1");
  });

  it("falls back to a generic token when no step info is available", () => {
    expect(
      rollbackFingerprintLeaf(
        new Error("Transaction failed after 0/2 steps. Rollback: successful"),
      ),
    ).toBe("rollback-successful");
  });
});

describe("rollbackFingerprint", () => {
  it("groups by [scope, 'rollback-successful', step, '{{default}}']", () => {
    const leaf = new Error("Step timeout: upsert:inspection_ziplines");
    const wrapped = new Error(
      "Transaction failed after 2/7 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(rollbackFingerprint("atomic-sync.syncInspection", wrapped)).toEqual([
      "atomic-sync.syncInspection",
      "rollback-successful",
      "upsert:inspection_ziplines",
      "{{default}}",
    ]);
  });

  it("produces distinct fingerprints for distinct step names so issues don't collapse incorrectly", () => {
    const a = new Error("Transaction failed after 0/2 steps. Rollback: successful");
    (a as Error & { cause?: unknown }).cause = new Error(
      "Step timeout: upsert:inspection_ziplines",
    );
    const b = new Error("Transaction failed after 0/2 steps. Rollback: successful");
    (b as Error & { cause?: unknown }).cause = new Error(
      "Step timeout: update:inspections",
    );
    expect(rollbackFingerprint("atomic-sync.syncInspection", a)).not.toEqual(
      rollbackFingerprint("atomic-sync.syncInspection", b),
    );
  });
});

describe("isLocalRecordMissing", () => {
  it("returns true for the inspection pre-flight read failure", () => {
    expect(
      isLocalRecordMissing(new Error("Inspection not found in local storage")),
    ).toBe(true);
  });

  it("returns true for the training pre-flight read failure", () => {
    expect(
      isLocalRecordMissing(new Error("Training not found in local storage")),
    ).toBe(true);
  });

  it("returns true for the daily-assessment pre-flight read failure", () => {
    expect(
      isLocalRecordMissing(
        new Error("Daily assessment not found in local storage"),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isLocalRecordMissing(new Error("schema cache: relation not found"))).toBe(
      false,
    );
    expect(isLocalRecordMissing(null)).toBe(false);
    expect(isLocalRecordMissing(undefined)).toBe(false);
    expect(isLocalRecordMissing(new Error("Inspection deleted"))).toBe(false);
  });

  it("walks the cause chain so wrapped local-missing errors still classify", () => {
    const leaf = new Error("Inspection not found in local storage");
    const wrapped = new Error("[atomic-sync] pre-flight read failure");
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(isLocalRecordMissing(wrapped)).toBe(true);
  });
});

describe("localRecordMissingLeaf", () => {
  it("extracts 'inspection' for the inspection variant", () => {
    expect(
      localRecordMissingLeaf(new Error("Inspection not found in local storage")),
    ).toBe("inspection");
  });

  it("extracts 'training' for the training variant", () => {
    expect(
      localRecordMissingLeaf(new Error("Training not found in local storage")),
    ).toBe("training");
  });

  it("normalises 'Daily assessment' → 'daily-assessment' (kebab-cased)", () => {
    expect(
      localRecordMissingLeaf(
        new Error("Daily assessment not found in local storage"),
      ),
    ).toBe("daily-assessment");
  });

  it("falls back to 'unknown-record' when no record-type token is present", () => {
    expect(localRecordMissingLeaf(new Error("totally different error"))).toBe(
      "unknown-record",
    );
  });
});

describe("localRecordMissingFingerprint", () => {
  it("groups by [scope, 'local-record-missing', record-type, '{{default}}']", () => {
    expect(
      localRecordMissingFingerprint(
        "atomic-sync.syncInspection",
        new Error("Inspection not found in local storage"),
      ),
    ).toEqual([
      "atomic-sync.syncInspection",
      "local-record-missing",
      "inspection",
      "{{default}}",
    ]);
  });

  it("produces distinct fingerprints per record kind so issues don't collapse incorrectly", () => {
    const a = localRecordMissingFingerprint(
      "atomic-sync.syncInspection",
      new Error("Inspection not found in local storage"),
    );
    const b = localRecordMissingFingerprint(
      "atomic-sync.syncTraining",
      new Error("Training not found in local storage"),
    );
    expect(a).not.toEqual(b);
  });

  it("never collides with rollbackFingerprint at the same scope (different discriminator token)", () => {
    const rollback = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful",
    );
    const missing = new Error("Inspection not found in local storage");
    const rollbackFp = rollbackFingerprint("atomic-sync.syncInspection", rollback);
    const missingFp = localRecordMissingFingerprint(
      "atomic-sync.syncInspection",
      missing,
    );
    expect(rollbackFp).not.toEqual(missingFp);
    // Discriminator is at index 1
    expect(rollbackFp[1]).toBe("rollback-successful");
    expect(missingFp[1]).toBe("local-record-missing");
  });
});

describe("classifyAtomicSyncError", () => {
  it("returns warning + rollback fingerprint for recoverable rollbacks", () => {
    const leaf = new Error("Step timeout: upsert:inspection_ziplines");
    const wrapped = new Error(
      "Transaction failed after 2/7 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    expect(
      classifyAtomicSyncError("atomic-sync.syncInspection", wrapped),
    ).toEqual({
      level: "warning",
      fingerprint: [
        "atomic-sync.syncInspection",
        "rollback-successful",
        "upsert:inspection_ziplines",
        "{{default}}",
      ],
    });
  });

  it("returns warning + local-record-missing fingerprint for missing-record errors", () => {
    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncTraining",
        new Error("Training not found in local storage"),
      ),
    ).toEqual({
      level: "warning",
      fingerprint: [
        "atomic-sync.syncTraining",
        "local-record-missing",
        "training",
        "{{default}}",
      ],
    });
  });

  it("returns error + undefined fingerprint for hard failures (let Sentry stack-group)", () => {
    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncInspection",
        new Error("new row violates row-level security policy"),
      ),
    ).toEqual({ level: "error", fingerprint: undefined });

    expect(
      classifyAtomicSyncError(
        "atomic-sync.syncInspection",
        new Error("Transaction failed after 1/4 steps. Rollback: failed"),
      ),
    ).toEqual({ level: "error", fingerprint: undefined });
  });

  it("rollback classifier wins when both shapes coexist (defensive determinism)", () => {
    // A rollback wrapper whose inner cause happens to mention "Inspection not
    // found in local storage" — the rollback path is still the more
    // actionable signal; classify as rollback.
    const leaf = new Error("Inspection not found in local storage");
    const wrapped = new Error(
      "Transaction failed after 0/2 steps. Rollback: successful",
    );
    (wrapped as Error & { cause?: unknown }).cause = leaf;
    const result = classifyAtomicSyncError(
      "atomic-sync.syncInspection",
      wrapped,
    );
    expect(result.level).toBe("warning");
    expect(result.fingerprint?.[1]).toBe("rollback-successful");
  });
});
