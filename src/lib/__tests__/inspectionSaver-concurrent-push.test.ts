/**
 * Phase B regression: concurrent remote pushes of the same inspection (with
 * temp-<uuid> child rows still in the React snapshot) must NOT produce
 * sibling DB rows. This is the exact failure shape the Lonestar inspection
 * exhibited (166 duplicate inspection_equipment rows in a 24s burst).
 *
 * What this proves end-to-end:
 *   1. realIdFromTempId is deterministic — every concurrent push maps the
 *      same temp-<uuid> to the SAME real DB UUID.
 *   2. The new-child code path uses upsert(onConflict:"id"), never insert(),
 *      so the second arrival updates the first row instead of inserting a sibling.
 *   3. ignoreDuplicates is never set (would silently drop richer replays).
 *   4. withInspectionPushLock serializes pushes for the same inspection id
 *      (no overlap) and does not block pushes for different inspections.
 *
 * The test is focused on the saver + mutex; it does not exercise the live
 * Supabase client (mocked) or the IndexedDB layer (mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = {
  table: string;
  op: "insert" | "upsert" | "update";
  rows: unknown;
  opts?: unknown;
  startedAt: number;
  finishedAt?: number;
};
const calls: Call[] = [];

// Slow the upserts so two concurrent pushes overlap on the wall clock when
// the mutex is not in play. We use real microtasks + a small setTimeout to
// approximate network latency.
const SLOW_MS = 20;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

vi.mock("@/integrations/supabase/client", () => {
  const ok = (data: unknown = [{ id: "ins-1", synced_at: new Date().toISOString() }]) =>
    Promise.resolve({ data, error: null });

  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => ok([{ id: "ins-1" }]));
    b.eq = vi.fn(() => b);
    b.update = vi.fn((rows: unknown) => {
      calls.push({ table, op: "update", rows, startedAt: Date.now() });
      return b;
    });
    b.upsert = vi.fn(async (rows: unknown, opts?: unknown) => {
      const entry: Call = { table, op: "upsert", rows, opts, startedAt: Date.now() };
      calls.push(entry);
      await sleep(SLOW_MS);
      entry.finishedAt = Date.now();
      return { data: null, error: null };
    });
    b.insert = vi.fn(async (rows: unknown) => {
      const entry: Call = { table, op: "insert", rows, startedAt: Date.now() };
      calls.push(entry);
      await sleep(SLOW_MS);
      entry.finishedAt = Date.now();
      return { data: null, error: null };
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
vi.mock("@/lib/sync-events", () => ({ registerSelfWrite: vi.fn() }));

import { pushInspectionToRemote } from "@/lib/form-savers/inspectionSaver";
import type { DbRow } from "@/lib/offline-storage";
import {
  withInspectionPushLock,
  __resetInspectionPushLocksForTests,
} from "@/lib/form-savers/inspection-push-mutex";

const INSP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INSP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  calls.length = 0;
  __resetInspectionPushLocksForTests();
});

const makePayload = (inspectionId: string, tempEqIds: string[], rev = "v1") => ({
  id: inspectionId,
  inspection: { id: inspectionId, updated_at: new Date().toISOString() } as DbRow,
  systems: [],
  ziplines: [],
  equipment: tempEqIds.map((tid, i) => ({
    id: tid,
    equipment_category: "harnesses",
    equipment_type: `Item ${i}`,
    result: "Pass",
    comments: rev,
  })) satisfies DbRow[],
  standards: [],
  summary: { id: "sum-1", inspection_id: inspectionId } as DbRow,
});

describe("pushInspectionToRemote — concurrent-push regression (Lonestar shape)", () => {
  it(
    "B1: two concurrent pushes of the SAME temp-<uuid> equipment rows produce one DB id per logical row, all via upsert(onConflict:'id')",
    async () => {
      const tempIds = [
        "temp-11111111-1111-4111-8111-111111111111",
        "temp-22222222-2222-4222-8222-222222222222",
        "temp-33333333-3333-4333-8333-333333333333",
      ];
      const expectedRealIds = tempIds.map((t) => t.slice("temp-".length));

      const p1 = pushInspectionToRemote(makePayload(INSP_A, tempIds, "race-1"), {
        updatedInspection: makePayload(INSP_A, tempIds, "race-1").inspection,
      });
      const p2 = pushInspectionToRemote(makePayload(INSP_A, tempIds, "race-2"), {
        updatedInspection: makePayload(INSP_A, tempIds, "race-2").inspection,
      });
      await Promise.all([p1, p2]);

      const equipmentWrites = calls.filter((c) => c.table === "inspection_equipment");

      // Both pushes must have written to inspection_equipment.
      expect(equipmentWrites.length).toBeGreaterThanOrEqual(2);

      // No insert() siblings — every write is an idempotent upsert.
      expect(equipmentWrites.every((c) => c.op === "upsert")).toBe(true);

      // Every write targets ONLY the deterministic ids derived from the temp prefixes.
      const seenIds = new Set<string>();
      for (const c of equipmentWrites) {
        const rows = c.rows as Array<{ id: string }>;
        for (const r of rows) seenIds.add(r.id);
        expect((c.opts as { onConflict?: string }).onConflict).toBe("id");
        expect((c.opts as { ignoreDuplicates?: boolean }).ignoreDuplicates).not.toBe(true);
      }
      expect(seenIds).toEqual(new Set(expectedRealIds));
      expect(seenIds.size).toBe(tempIds.length); // exactly N logical rows, never 2N
    },
    10_000,
  );

  it("B2: mutex serializes overlapping pushes for the SAME inspection (no upsert windows overlap)", async () => {
    const tempIds = ["temp-44444444-4444-4444-8444-444444444444"];

    const run = (rev: string) =>
      withInspectionPushLock(INSP_A, () =>
        pushInspectionToRemote(makePayload(INSP_A, tempIds, rev), {
          updatedInspection: makePayload(INSP_A, tempIds, rev).inspection,
        }),
      );

    await Promise.all([run("m1"), run("m2")]);

    const upserts = calls
      .filter((c) => c.table === "inspection_equipment" && c.op === "upsert")
      .sort((a, b) => a.startedAt - b.startedAt);

    expect(upserts.length).toBeGreaterThanOrEqual(2);

    // Each subsequent upsert must start at or after the previous one finished.
    for (let i = 1; i < upserts.length; i++) {
      const prev = upserts[i - 1];
      const curr = upserts[i];
      expect(prev.finishedAt).toBeDefined();
      expect(curr.startedAt).toBeGreaterThanOrEqual(prev.finishedAt!);
    }
  });

  it("B3: mutex does NOT block pushes for DIFFERENT inspections (they overlap)", async () => {
    const tempA = ["temp-55555555-5555-4555-8555-555555555555"];
    const tempB = ["temp-66666666-6666-4666-8666-666666666666"];

    const start = Date.now();
    await Promise.all([
      withInspectionPushLock(INSP_A, () =>
        pushInspectionToRemote(makePayload(INSP_A, tempA), {
          updatedInspection: makePayload(INSP_A, tempA).inspection,
        }),
      ),
      withInspectionPushLock(INSP_B, () =>
        pushInspectionToRemote(makePayload(INSP_B, tempB), {
          updatedInspection: makePayload(INSP_B, tempB).inspection,
        }),
      ),
    ]);
    const elapsed = Date.now() - start;

    // If the lock were global, two ~SLOW_MS upserts plus the parent-inspection
    // upsert would serialize to ~4×SLOW_MS. Independent locks should keep
    // wall time well under serialized worst-case.
    expect(elapsed).toBeLessThan(SLOW_MS * 6);

    // Sanity: each inspection got its own equipment upsert with its own id.
    const equipmentWrites = calls.filter((c) => c.table === "inspection_equipment");
    const ids = equipmentWrites.flatMap((c) =>
      (c.rows as Array<{ id: string }>).map((r) => r.id),
    );
    expect(new Set(ids)).toEqual(
      new Set([
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
      ]),
    );
  });
});
