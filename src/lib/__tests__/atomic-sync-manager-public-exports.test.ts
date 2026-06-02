/**
 * Slice 4 — Public-exports boundary test for `src/lib/atomic-sync-manager.ts`.
 *
 * This is a shape-level contract test only. It does NOT exercise sync,
 * retry, quarantine, IDB, Realtime, Supabase, recovery, or diagnostics
 * behavior. Its sole purpose is to lock the public export surface of the
 * large atomic-sync-manager module so that future refactors cannot
 * silently remove, rename, drift the signature of, or accidentally
 * introduce a default export for any function/constant that production
 * code (useAutoSync, SyncDiagnosticsSheet) and the existing test suite
 * depend on.
 *
 * Approved scope conditions (per Slice 4 approval):
 *   - Pure module import only; the single allowed runtime call is the
 *     side-effect-free `getAdaptiveBatchSize()` read.
 *   - `.length` assertions stay broad (`>= N`) and intentional; we do
 *     NOT lock `syncAll*Atomic.length === 0` because future default
 *     parameters or wrappers could legitimately change it without
 *     breaking callers.
 *   - No behavior-level assertions for sync/refetch/safePostSyncSave.
 *   - Adjacent modules are intentionally out of scope.
 */

import { describe, it, expect } from "vitest";
import * as mod from "@/lib/atomic-sync-manager";

const PRODUCTION_FUNCTION_EXPORTS = [
  "joinErrorCauseChain",
  "assertRealSessionForSync",
  "safePostSyncSave",
  "rewriteChildForeignKeys",
  "noteBatchOutcome",
  "getAdaptiveBatchSize",
  "syncInspectionAtomic",
  "syncAllInspectionsAtomic",
  "syncTrainingAtomic",
  "syncAllTrainingsAtomic",
  "syncDailyAssessmentAtomic",
  "syncAllDailyAssessmentsAtomic",
  "refetchInspectionPackage",
  "refetchTrainingPackage",
  "refetchAssessmentPackage",
] as const;

const TEST_ONLY_FUNCTION_EXPORTS = [
  "__test_only__stripLocalOnlyFields",
  "__test_only__stripLocalOnlyFieldsArray",
  "__test_only__selectAtomicSyncFetchOuterTimeout",
] as const;

const TEST_ONLY_NUMERIC_EXPORTS = [
  "__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_MS",
  "__test_only__ATOMIC_SYNC_FETCH_OUTER_TIMEOUT_GRACE_MS",
] as const;

describe("atomic-sync-manager public-exports contract", () => {
  describe("production function exports", () => {
    for (const name of PRODUCTION_FUNCTION_EXPORTS) {
      it(`exports \`${name}\` as a function`, () => {
        const value = (mod as Record<string, unknown>)[name];
        expect(value, `export "${name}" must exist`).toBeDefined();
        expect(typeof value).toBe("function");
      });
    }
  });

  describe("production constant exports", () => {
    it("exports `MAX_REGRESSION_SKIPS` as the numeric product constant 3", () => {
      // SyncDiagnosticsSheet consumes this constant for user-facing copy;
      // changing it is a product decision, not a silent refactor.
      expect(typeof mod.MAX_REGRESSION_SKIPS).toBe("number");
      expect(mod.MAX_REGRESSION_SKIPS).toBe(3);
    });
  });

  describe("test-only exports remain present", () => {
    // These are intentionally exported with the `__test_only__` prefix so
    // sibling test files (strip-local-only-upsert-fields,
    // atomic-sync-fetch-outer-timeout, atomic-sync-ledger-catch-fallback)
    // can pin internal invariants. If any of these disappear, those
    // tests would silently no-op instead of failing — this test prevents
    // that regression.
    for (const name of TEST_ONLY_FUNCTION_EXPORTS) {
      it(`exports \`${name}\` as a function`, () => {
        const value = (mod as Record<string, unknown>)[name];
        expect(value, `test-only export "${name}" must exist`).toBeDefined();
        expect(typeof value).toBe("function");
      });
    }

    for (const name of TEST_ONLY_NUMERIC_EXPORTS) {
      it(`exports \`${name}\` as a finite number`, () => {
        const value = (mod as Record<string, unknown>)[name];
        expect(value, `test-only export "${name}" must exist`).toBeDefined();
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value as number)).toBe(true);
      });
    }

    it("exports `__test_only__ledgerFallbackRows` as a function", () => {
      // It's the ledger-fallback helper itself (async function), not the
      // resulting rows. Sibling tests invoke it with mocked imports.
      const value = (mod as Record<string, unknown>)["__test_only__ledgerFallbackRows"];
      expect(value).toBeDefined();
      expect(typeof value).toBe("function");
    });
  });

  describe("module shape", () => {
    it("has no default export (module is named-only)", () => {
      expect((mod as { default?: unknown }).default).toBeUndefined();
    });

    it("`getAdaptiveBatchSize()` returns a finite positive integer (pure read, no side effects)", () => {
      const size = mod.getAdaptiveBatchSize();
      expect(typeof size).toBe("number");
      expect(Number.isFinite(size)).toBe(true);
      expect(Number.isInteger(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe("broad arity assertions (shape, not overfitted)", () => {
    // `.length` reflects required (non-default, non-rest) parameters.
    // We assert lower bounds only so optional/default parameters can be
    // added without breaking this contract test.

    it("`syncInspectionAtomic` requires at least the id arg", () => {
      expect(mod.syncInspectionAtomic.length).toBeGreaterThanOrEqual(1);
    });

    it("`syncTrainingAtomic` requires at least the id arg", () => {
      expect(mod.syncTrainingAtomic.length).toBeGreaterThanOrEqual(1);
    });

    it("`syncDailyAssessmentAtomic` requires at least the id arg", () => {
      expect(mod.syncDailyAssessmentAtomic.length).toBeGreaterThanOrEqual(1);
    });

    // syncAll*Atomic intentionally NOT pinned to length === 0 per Slice 4
    // tightening conditions — future default parameters or wrappers could
    // legitimately change `.length` without breaking callers.
    it("`syncAllInspectionsAtomic` is callable as a function", () => {
      expect(typeof mod.syncAllInspectionsAtomic).toBe("function");
    });
    it("`syncAllTrainingsAtomic` is callable as a function", () => {
      expect(typeof mod.syncAllTrainingsAtomic).toBe("function");
    });
    it("`syncAllDailyAssessmentsAtomic` is callable as a function", () => {
      expect(typeof mod.syncAllDailyAssessmentsAtomic).toBe("function");
    });

    it("`refetchInspectionPackage` requires at least the id arg", () => {
      expect(mod.refetchInspectionPackage.length).toBeGreaterThanOrEqual(1);
    });
    it("`refetchTrainingPackage` requires at least the id arg", () => {
      expect(mod.refetchTrainingPackage.length).toBeGreaterThanOrEqual(1);
    });
    it("`refetchAssessmentPackage` requires at least the id arg", () => {
      expect(mod.refetchAssessmentPackage.length).toBeGreaterThanOrEqual(1);
    });

    it("`rewriteChildForeignKeys` accepts at least 4 required args (rows, oldId, newId, fkField/label)", () => {
      expect(mod.rewriteChildForeignKeys.length).toBeGreaterThanOrEqual(4);
    });

    it("`safePostSyncSave` accepts at least 2 required args", () => {
      expect(mod.safePostSyncSave.length).toBeGreaterThanOrEqual(2);
    });
  });
});
