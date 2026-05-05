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
