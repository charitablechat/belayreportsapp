import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * H4 — zero-overlap reconcile guard.
 *
 * Verifies that `reconcileChildTable` refuses to perform a destructive
 * orphan-delete sweep when local and server are both non-empty but share
 * zero id overlap on a guarded child table. The guard fires BEFORE the
 * 70% tripwire so callers passing `expectedNonEmpty=true` (which opts out
 * of the tripwire via `bulk:true`) cannot bypass it.
 *
 * Excluded tables (e.g. `inspection_summary`) legitimately rotate their
 * single id on temp→server upsert and must remain unguarded.
 */

type Row = { id: string };

type Row = { id: string };

vi.mock("@/integrations/supabase/client", () => {
  const state: { countByTable: Record<string, number> } = { countByTable: {} };
  const deleteSpy = vi.fn().mockResolvedValue({ error: null });
  const insertSpy = vi.fn().mockResolvedValue({ error: null });
  (globalThis as any).__overlapGuardState = state;
  (globalThis as any).__deleteSpy = deleteSpy;
  (globalThis as any).__insertSpy = insertSpy;

  const from = (table: string) => ({
    select: (_cols: string, _opts?: { count?: string; head?: boolean }) => ({
      eq: async (_col: string, _val: string) => ({
        data: null,
        count: state.countByTable[table] ?? 0,
        error: null,
      }),
    }),
    delete: () => ({
      in: (_col: string, ids: string[]) => deleteSpy(table, ids),
    }),
    insert: (rows: unknown[]) => insertSpy(table, rows),
  });

  return { supabase: { from } };
});


import { reconcileChildTable } from "../sync-reconciliation";

const setServerCount = (table: string, count: number) => {
  (globalThis as any).__overlapGuardState.countByTable[table] = count;
};

const callReconcile = (opts: {
  childTable: string;
  localItems: Row[];
  serverRows: Row[];
  expectedNonEmpty?: boolean;
}) =>
  reconcileChildTable({
    childTable: opts.childTable,
    parentIdColumn: "inspection_id",
    parentId: "report-xyz-0001",
    localItems: opts.localItems,
    reportType: "inspection",
    userId: "user-1",
    prefetchedServerRows: opts.serverRows,
    expectedNonEmpty: opts.expectedNonEmpty,
  });

describe("H4 zero-overlap guard — reconcileChildTable", () => {
  beforeEach(() => {
    (globalThis as any).__overlapGuardState.countByTable = {};
    deleteSpy.mockClear();
    insertSpy.mockClear();
  });

  it("(1) overlap=3, full match → allowed, no deletes", async () => {
    const rows = [{ id: "A" }, { id: "B" }, { id: "C" }];
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: rows,
      serverRows: rows,
    });
    expect(result.blocked).toBe(false);
    expect(result.deletedCount).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("(2) guarded table, overlap=0 → blocked no_local_server_overlap", async () => {
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: [{ id: "X" }, { id: "Y" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("no_local_server_overlap");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("(3) expectedNonEmpty=true / bulk:true cannot bypass the guard", async () => {
    setServerCount("inspection_systems", 3);
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: [{ id: "X" }, { id: "Y" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("no_local_server_overlap");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("(4) guarded small table (ziplines), server=2 overlap=0 → blocked", async () => {
    const result = await callReconcile({
      childTable: "inspection_ziplines",
      localItems: [{ id: "X" }, { id: "Y" }],
      serverRows: [{ id: "A" }, { id: "B" }],
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("no_local_server_overlap");
  });

  it("(5) excluded summary table, server=1 local=1 overlap=0 → allowed (id rotation OK)", async () => {
    setServerCount("inspection_summary", 1);
    const result = await callReconcile({
      childTable: "inspection_summary",
      localItems: [{ id: "X" }],
      serverRows: [{ id: "A" }],
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.deletedCount).toBe(1);
    expect(deleteSpy).toHaveBeenCalledWith("inspection_summary", ["A"]);
  });

  it("(6) legitimate partial delete, overlap=2 → allowed, deletes 1", async () => {
    setServerCount("inspection_systems", 3);
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: [{ id: "A" }, { id: "B" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.deletedCount).toBe(1);
    expect(deleteSpy).toHaveBeenCalledWith("inspection_systems", ["C"]);
  });

  it("(7) overlap=1, server=3 local=1 → 66% delete passes tripwire (under 70%)", async () => {
    setServerCount("inspection_systems", 3);
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: [{ id: "A" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.deletedCount).toBe(2);
    expect(deleteSpy).toHaveBeenCalledWith("inspection_systems", ["B", "C"]);
  });

  it("(8) legitimate user delete contract: server [A,B,C], local [A,B] (C removed) → deletes C", async () => {
    // Real-world: user deleted row C in the UI. A tombstone exists in
    // localStorage for C, but the React state / IDB localItems no longer
    // contains C. Reconcile correctly deletes C from the server.
    // (This test confirms the withdrawn Fix C did not regress this path.)
    setServerCount("inspection_systems", 3);
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems: [{ id: "A" }, { id: "B" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedRows.map((r) => (r as Row).id)).toEqual(["C"]);
    expect(deleteSpy).toHaveBeenCalledWith("inspection_systems", ["C"]);
  });

  it("(9) Luke/Lakeview churn shape: 7 server rows, 3 stale local rows, overlap=0 → blocked, no deletes, no ledger inserts from this call", async () => {
    const serverRows = ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id }));
    const localItems = [{ id: "X" }, { id: "Y" }, { id: "Z" }];
    const result = await callReconcile({
      childTable: "inspection_systems",
      localItems,
      serverRows,
      expectedNonEmpty: true,
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("no_local_server_overlap");
    expect(result.deletedCount).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
    // Ledger MUST NOT grow from a blocked sweep on the guarded path.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("(10) non-guarded unknown table, overlap=0 → guard is no-op (falls through to tripwire)", async () => {
    // Sanity: tables not in ZERO_OVERLAP_GUARDED_TABLES are unaffected.
    setServerCount("some_other_table", 3);
    const result = await callReconcile({
      childTable: "some_other_table",
      localItems: [{ id: "X" }],
      serverRows: [{ id: "A" }, { id: "B" }, { id: "C" }],
      expectedNonEmpty: true,
    });
    // No overlap-guard block; tripwire allows under bulk:true.
    expect(result.blockReason).not.toBe("no_local_server_overlap");
  });
});
