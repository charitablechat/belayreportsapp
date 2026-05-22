/**
 * Regression: training_summary upsert must
 *   1) use onConflict: 'training_id' (unique index added in migration), and
 *   2) only send columns that exist on public.training_summary.
 *
 * Previously the saver shipped `updated_at` and `field_timestamps` plus a
 * missing unique index, so PostgREST 400'd every summary upsert and the
 * Observations / Recommendations text only appeared after Generate Report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertCalls: Array<{ table: string; row: Record<string, unknown>; opts?: { onConflict?: string } }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const ok = (data: unknown = [{ id: "t-1", synced_at: new Date().toISOString() }]) =>
    Promise.resolve({ data, error: null });
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => ok([{ id: "t-1" }]));
    b.eq = vi.fn(() => b);
    b.update = vi.fn(() => b);
    b.upsert = vi.fn((row: Record<string, unknown>, opts?: { onConflict?: string }) => {
      upsertCalls.push({ table, row, opts });
      return ok();
    });
    b.insert = vi.fn(() => ok());
    b.maybeSingle = vi.fn(() => ok({ id: "t-1" }));
    b.then = (resolve: (v: unknown) => unknown) =>
      ok([{ id: "t-1", synced_at: new Date().toISOString() }]).then(resolve);
    return b;
  };
  return { supabase: { from: vi.fn((table: string) => makeBuilder(table)) } };
});

vi.mock("@/lib/offline-storage", () => ({
  saveTrainingOffline: vi.fn(async () => {}),
  saveTrainingDataOffline: vi.fn(async () => {}),
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
vi.mock("@/lib/clear-intent", () => ({
  reconcileClearIntent: (row: Record<string, unknown>) => row,
}));

import { pushTrainingToRemote } from "@/lib/form-savers/trainingSaver";

describe("pushTrainingToRemote — training_summary upsert shape", () => {
  beforeEach(() => {
    upsertCalls.length = 0;
  });

  it("uses onConflict='training_id' and strips client-only columns", async () => {
    const id = "training-abc";
    const dirtySummary = {
      id: "sum-1",
      training_id: id,
      observations: "field obs",
      recommendations: "field rec",
      person_submitting: "Trainer T",
      submission_date: "2026-01-02",
      // client-only metadata that does NOT exist on the table
      updated_at: "2026-01-02T00:00:00Z",
      field_timestamps: { observations: "2026-01-02T00:00:00Z" },
      last_modified_by: "admin-1",
      dirty: true,
    } as any;

    await pushTrainingToRemote(
      {
        id,
        training: { id, inspector_id: "user-1", updated_at: "2026-01-02T00:00:00Z" } as any,
        deliveryApproaches: [],
        operatingSystems: [],
        immediateAttention: [],
        verifiableItems: [],
        systemsInPlace: [],
        summary: dirtySummary,
      },
      { updatedTraining: { id, inspector_id: "user-1" } as any },
    );

    const summaryCall = upsertCalls.find(c => c.table === "training_summary");
    expect(summaryCall, "summary upsert should have been issued").toBeTruthy();
    expect(summaryCall!.opts?.onConflict).toBe("training_id");
    // Observations/recommendations must survive…
    expect(summaryCall!.row.observations).toBe("field obs");
    expect(summaryCall!.row.recommendations).toBe("field rec");
    // …but client-only columns must be stripped.
    expect("updated_at" in summaryCall!.row).toBe(false);
    expect("field_timestamps" in summaryCall!.row).toBe(false);
    expect("last_modified_by" in summaryCall!.row).toBe(false);
    expect("dirty" in summaryCall!.row).toBe(false);
  });
});
