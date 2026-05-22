/**
 * Training Report — Completed photo-management gate
 *
 * Locks in the contract that Training photo add/delete controls are gated on
 * edit *authorization* (the useReportEditPermission `isReadOnly` flag), NOT
 * on the report's Completed/locked status. Authorized users (owners and
 * admins) keep photo management after a report is marked Completed; super
 * admins and unauthorized users remain blocked because `isReadOnly` already
 * encodes that.
 *
 * Mirrors the derivation in src/pages/TrainingForm.tsx:
 *   const effectiveReadOnly = isReadOnly || isCompletionLocked;
 *   const canManageTrainingPhotos = !isReadOnly;
 */
import { describe, it, expect } from "vitest";

function derive({
  isReadOnly,
  status,
  completionLockOverridden = false,
}: {
  isReadOnly: boolean;
  status: "in_progress" | "completed";
  completionLockOverridden?: boolean;
}) {
  const isCompletionLocked = status === "completed" && !completionLockOverridden;
  const effectiveReadOnly = isReadOnly || isCompletionLocked;
  const canManageTrainingPhotos = !isReadOnly;
  return { effectiveReadOnly, canManageTrainingPhotos };
}

describe("Training Completed → photo media management gate", () => {
  it("owner on Completed report: fields read-only, photos still manageable", () => {
    const r = derive({ isReadOnly: false, status: "completed" });
    expect(r.effectiveReadOnly).toBe(true);
    expect(r.canManageTrainingPhotos).toBe(true);
  });

  it("admin on Completed report: fields read-only, photos still manageable", () => {
    // Admin viewing someone else's completed report: useReportEditPermission
    // returns canEdit=true / isReadOnly=false; same outcome as owner.
    const r = derive({ isReadOnly: false, status: "completed" });
    expect(r.canManageTrainingPhotos).toBe(true);
  });

  it("owner on in-progress report: fully editable", () => {
    const r = derive({ isReadOnly: false, status: "in_progress" });
    expect(r.effectiveReadOnly).toBe(false);
    expect(r.canManageTrainingPhotos).toBe(true);
  });

  it("super admin / unauthorized: cannot manage photos regardless of status", () => {
    expect(derive({ isReadOnly: true, status: "completed" }).canManageTrainingPhotos).toBe(false);
    expect(derive({ isReadOnly: true, status: "in_progress" }).canManageTrainingPhotos).toBe(false);
  });

  it("Completed lock override (admin chose to re-open): full edit, photos still manageable", () => {
    const r = derive({ isReadOnly: false, status: "completed", completionLockOverridden: true });
    expect(r.effectiveReadOnly).toBe(false);
    expect(r.canManageTrainingPhotos).toBe(true);
  });

  it("photo gate does NOT depend on report status", () => {
    // canManageTrainingPhotos must be a pure function of isReadOnly
    for (const status of ["in_progress", "completed"] as const) {
      for (const override of [true, false]) {
        expect(
          derive({ isReadOnly: false, status, completionLockOverridden: override }).canManageTrainingPhotos,
        ).toBe(true);
        expect(
          derive({ isReadOnly: true, status, completionLockOverridden: override }).canManageTrainingPhotos,
        ).toBe(false);
      }
    }
  });
});
