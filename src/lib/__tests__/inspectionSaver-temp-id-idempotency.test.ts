/**
 * Regression: temp-<uuid> child rows must replay to the SAME real DB id and
 * be written via upsert(onConflict:"id"), so duplicate inserts can't happen
 * when two saves race on the same React snapshot.
 *
 * Forensic context: Lonestar inspection d43ec2b1-... accumulated 166
 * duplicate inspection_equipment rows in a 24s burst because two pushes
 * each generated a fresh crypto.randomUUID() for temp-prefixed rows. After
 * this fix the embedded UUID is reused and the second push upserts onto
 * the row created by the first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { table: string; op: "insert" | "upsert" | "update"; rows: unknown; opts?: unknown };
const calls: Call[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const ok = (data: unknown = [{ id: "ins-1", synced_at: new Date().toISOString() }]) =>
    Promise.resolve({ data, error: null });
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => ok([{ id: "ins-1" }]));
    b.eq = vi.fn(() => b);
    b.update = vi.fn((rows: unknown) => { calls.push({ table, op: "update", rows }); return b; });
    b.upsert = vi.fn((rows: unknown, opts?: unknown) => {
      calls.push({ table, op: "upsert", rows, opts });
      return ok();
    });
    b.insert = vi.fn((rows: unknown) => {
      calls.push({ table, op: "insert", rows });
      return ok();
    });
    b.maybeSingle = vi.fn(() => ok({ id: "ins-1" }));
    b.then = (resolve: (v: unknown) => unknown) =>
      ok([{ id: "ins-1", synced_at: new Date().toISOString() }]).then(resolve);
    return b;
  };
  return { supabase: { from: vi.fn((t: string) => makeBuilder(t)) } };
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

import { pushInspectionToRemote, realIdFromTempId } from "@/lib/form-savers/inspectionSaver";

const INSP_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  calls.length = 0;
});

describe("realIdFromTempId", () => {
  it("reuses the embedded UUID from a temp-<uuid> id", () => {
    const uuid = "22222222-2222-4222-8222-222222222222";
    expect(realIdFromTempId(`temp-${uuid}`)).toBe(uuid);
  });
  it("falls back to a fresh UUID when the embedded value is malformed", () => {
    const out = realIdFromTempId("temp-not-a-uuid");
    expect(out).not.toBe("not-a-uuid");
    expect(out).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it("falls back to a fresh UUID when input is empty/undefined", () => {
    expect(realIdFromTempId(undefined)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(realIdFromTempId("")).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("pushInspectionToRemote — temp-id idempotency", () => {
  it("A1: replaying the same temp-<uuid> equipment row produces the same DB id and uses upsert", async () => {
    const tempEqId = "temp-33333333-3333-4333-8333-333333333333";
    const expectedRealId = "33333333-3333-4333-8333-333333333333";

    const payload = (rev: string) => ({
      id: INSP_ID,
      inspection: { id: INSP_ID, updated_at: new Date().toISOString() } as any,
      systems: [],
      ziplines: [],
      equipment: [
        { id: tempEqId, equipment_type: "harness", result: "Pass", comments: rev } as any,
      ],
      standards: [],
      summary: { id: "sum-1", inspection_id: INSP_ID } as any,
    });

    await pushInspectionToRemote(payload("first"), { updatedInspection: payload("first").inspection });
    await pushInspectionToRemote(payload("second"), { updatedInspection: payload("second").inspection });

    const equipmentWrites = calls.filter((c) => c.table === "inspection_equipment");
    expect(equipmentWrites.length).toBeGreaterThanOrEqual(2);

    // Every write to inspection_equipment for a new (temp-derived) row MUST be upsert, never insert.
    expect(equipmentWrites.every((c) => c.op === "upsert")).toBe(true);

    // Both pushes targeted the SAME deterministic id.
    for (const c of equipmentWrites) {
      const rows = c.rows as Array<{ id: string }>;
      expect(rows[0].id).toBe(expectedRealId);
      expect((c.opts as { onConflict?: string }).onConflict).toBe("id");
      // CRITICAL: must NOT use ignoreDuplicates (would drop richer replays).
      expect((c.opts as { ignoreDuplicates?: boolean }).ignoreDuplicates).not.toBe(true);
    }
  });

  it("A2: a richer replay (additional fields) still hits the same id so DB upsert can update it", async () => {
    const tempId = "temp-44444444-4444-4444-8444-444444444444";
    const realId = "44444444-4444-4444-8444-444444444444";

    const first = {
      id: INSP_ID,
      inspection: { id: INSP_ID, updated_at: new Date().toISOString() } as any,
      systems: [],
      ziplines: [],
      equipment: [{ id: tempId, equipment_type: "rope", result: "Pass" } as any],
      standards: [],
      summary: { id: "sum-1", inspection_id: INSP_ID } as any,
    };
    const second = {
      ...first,
      equipment: [
        { id: tempId, equipment_type: "rope", result: "Pass", comments: "richer", production_year: "2024" } as any,
      ],
    };

    await pushInspectionToRemote(first, { updatedInspection: first.inspection });
    await pushInspectionToRemote(second, { updatedInspection: second.inspection });

    const eqWrites = calls.filter((c) => c.table === "inspection_equipment");
    const ids = eqWrites.flatMap((c) => (c.rows as Array<{ id: string }>).map((r) => r.id));
    expect(new Set(ids)).toEqual(new Set([realId]));
    // The 2nd payload carried the richer fields — confirms upsert update-on-conflict will persist them.
    const last = eqWrites[eqWrites.length - 1].rows as Array<Record<string, unknown>>;
    expect(last[0].comments).toBe("richer");
    expect(last[0].production_year).toBe("2024");
  });

  it("A4: systems and ziplines with temp-<uuid> ids also use upsert(onConflict:'id') with deterministic ids", async () => {
    const sysTemp = "temp-55555555-5555-4555-8555-555555555555";
    const zipTemp = "temp-66666666-6666-4666-8666-666666666666";

    await pushInspectionToRemote(
      {
        id: INSP_ID,
        inspection: { id: INSP_ID, updated_at: new Date().toISOString() } as any,
        systems: [{ id: sysTemp, system_name: "Belay" } as any],
        ziplines: [{ id: zipTemp, zipline_name: "Z1" } as any],
        equipment: [],
        standards: [],
        summary: { id: "sum-1", inspection_id: INSP_ID } as any,
      },
      { updatedInspection: { id: INSP_ID, updated_at: new Date().toISOString() } as any },
    );

    const sysOp = calls.find((c) => c.table === "inspection_systems");
    const zipOp = calls.find((c) => c.table === "inspection_ziplines");
    expect(sysOp?.op).toBe("upsert");
    expect(zipOp?.op).toBe("upsert");
    expect((sysOp!.opts as any).onConflict).toBe("id");
    expect((zipOp!.opts as any).onConflict).toBe("id");
    expect((sysOp!.opts as any).ignoreDuplicates).not.toBe(true);
    expect((zipOp!.opts as any).ignoreDuplicates).not.toBe(true);

    expect((sysOp!.rows as Array<{ id: string }>)[0].id).toBe("55555555-5555-4555-8555-555555555555");
    expect((zipOp!.rows as Array<{ id: string }>)[0].id).toBe("66666666-6666-4666-8666-666666666666");
  });
});
