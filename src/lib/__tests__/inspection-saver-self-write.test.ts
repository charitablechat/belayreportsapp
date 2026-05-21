/**
 * P1 regression: pushInspectionToRemote must register a self-write for the
 * inspection id BEFORE the first server mutation, so that a same-device
 * Realtime postgres_changes event fired by our own UPDATE/UPSERT/INSERT is
 * ignored by useFormRecordRealtime.onUpdate (which would otherwise call
 * loadInspection() and overwrite a freshly-added/deleted equipment row
 * still living in local React state during the save round-trip).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  // Each call to .from(table) returns a chain that resolves to { data, error }.
  const ok = (data: unknown = [{ id: "ins-1", synced_at: new Date().toISOString() }]) =>
    Promise.resolve({ data, error: null });
  const builder = () => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => ok([{ id: "ins-1" }]));
    b.eq = vi.fn(() => b);
    b.update = vi.fn(() => b);
    b.upsert = vi.fn(() => ok());
    b.insert = vi.fn(() => ok());
    b.maybeSingle = vi.fn(() => ok({ id: "ins-1" }));
    // Make update().eq().select() resolve to a row so the verify check passes.
    b.then = (resolve: (v: unknown) => unknown) =>
      ok([{ id: "ins-1", synced_at: new Date().toISOString() }]).then(resolve);
    return b;
  };
  return { supabase: { from: vi.fn(() => builder()) } };
});

vi.mock("@/lib/offline-storage", () => ({
  saveInspectionOffline: vi.fn(async () => {}),
  saveRelatedDataOffline: vi.fn(async () => {}),
}));
vi.mock("@/lib/local-backup-ledger", () => ({ saveReportSnapshot: vi.fn(async () => {}) }));
vi.mock("@/lib/report-version-manager", () => ({ appendVersion: vi.fn(async () => {}) }));
vi.mock("@/lib/sync-reconciliation", () => ({
  reconcileAllChildTables: vi.fn(async () => ({ deletedByTable: [] })),
  restoreReconciledDeletions: vi.fn(async () => {}),
}));
vi.mock("@/lib/cached-auth", () => ({
  getUserWithCache: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/offline-readiness", () => ({ recordSaveWithoutIdentity: vi.fn() }));

import { pushInspectionToRemote } from "@/lib/form-savers/inspectionSaver";
import { isRecentSelfWrite } from "@/lib/sync-events";

describe("pushInspectionToRemote — self-write suppression", () => {
  beforeEach(() => {
    // Each test gets a fresh id so the recentSelfWriteIds map doesn't leak.
  });

  it("marks the inspection id as a recent self-write before remote writes complete", async () => {
    const id = `ins-self-write-${Date.now()}-${Math.random()}`;
    const baseRow = { id, updated_at: new Date().toISOString() } as any;
    expect(isRecentSelfWrite(id)).toBe(false);

    await pushInspectionToRemote(
      {
        id,
        inspection: baseRow,
        systems: [],
        ziplines: [],
        equipment: [],
        standards: [],
        summary: { id: "sum-1", inspection_id: id } as any,
      },
      { updatedInspection: baseRow },
    );

    expect(isRecentSelfWrite(id)).toBe(true);
  });
});
