/**
 * Tombstone reconciliation — re-add recovery without duplicates.
 *
 * On load, if a tombstone's businessKey matches a row whose `created_at`
 * is strictly later than the tombstone's `deletedAt`, the row is an
 * intentional re-add. Only the matching businessKey suppression is
 * retired; any old server-id tombstone is preserved so previously
 * deleted rows stay deleted.
 *
 * Covers Luke's Lakeview shape: existing server row
 * `c48ddfd0-...` (created 12:13:01) becomes visible on reload despite a
 * stale `climbing wall|automated safety` businessKey tombstone from an
 * earlier delete, with no duplicate row required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addChildTombstone,
  isChildTombstoned,
  listChildTombstones,
  reconcileChildTombstones,
  __test_only__clearAllChildTombstones,
} from "../child-row-tombstones";
import { applySystemsTombstone } from "../form-loaders/inspectionLoader";

const ENT = "inspection_operating_system" as const;
const RID = "c575d3d9-68a4-43f4-a6e5-e4268338e465";
const BK = (r: Record<string, unknown>): string | null =>
  [(r?.name ?? "").trim().toLowerCase(), (r?.system_name ?? "").trim().toLowerCase()]
    .filter(Boolean)
    .join("|") || null;
const CA = (r: Record<string, unknown>) => r.created_at ?? null;

describe("reconcileChildTombstones (re-add recovery)", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("retires businessKey tombstone when a newer row with same key is loaded", () => {
    // Tombstone written at T0
    addChildTombstone(ENT, RID, { businessKey: "climbing wall|automated safety" });
    const rows = [
      // Row created strictly after tombstone deletedAt
      { id: "c48ddfd0", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    const reconciled = reconcileChildTombstones(ENT, RID, rows, BK, CA);
    expect(reconciled).toBe(1);
    expect(isChildTombstoned(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(false);
  });

  it("keeps row hidden when row was created BEFORE the tombstone", () => {
    addChildTombstone(ENT, RID, { businessKey: "climbing wall|automated safety" });
    const rows = [
      { id: "old-server-id", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() - 60_000).toISOString() },
    ];
    const reconciled = reconcileChildTombstones(ENT, RID, rows, BK, CA);
    expect(reconciled).toBe(0);
    expect(isChildTombstoned(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(true);
  });

  it("preserves id tombstone when reconciling businessKey on the same entry", () => {
    // Tombstone for an OLD server row that also carried the same businessKey.
    addChildTombstone(ENT, RID, {
      id: "b01634b2-bb95-429c-9558-c8dadeb70060",
      businessKey: "climbing wall|automated safety",
    });
    const rows = [
      // New row, different id, created after the tombstone.
      { id: "c48ddfd0-85e2-44bd-8857-847ad22e61b1",
        name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    reconcileChildTombstones(ENT, RID, rows, BK, CA);
    // businessKey suppression lifted...
    expect(isChildTombstoned(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(false);
    // ...but the old server-id tombstone remains.
    expect(isChildTombstoned(ENT, RID, {
      id: "b01634b2-bb95-429c-9558-c8dadeb70060",
    })).toBe(true);
  });

  it("does NOT reconcile when the matching row IS the tombstoned id (same row resurrecting)", () => {
    addChildTombstone(ENT, RID, {
      id: "same-id",
      businessKey: "climbing wall|automated safety",
    });
    const rows = [
      { id: "same-id", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    const reconciled = reconcileChildTombstones(ENT, RID, rows, BK, CA);
    expect(reconciled).toBe(0);
    expect(isChildTombstoned(ENT, RID, { id: "same-id" })).toBe(true);
  });

  it("ignores rows without a reliable created_at", () => {
    addChildTombstone(ENT, RID, { businessKey: "climbing wall|automated safety" });
    const rows = [
      { id: "temp-1", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: null },
      { id: "temp-2", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: "not-a-date" },
    ];
    const reconciled = reconcileChildTombstones(ENT, RID, rows, BK, CA);
    expect(reconciled).toBe(0);
    expect(isChildTombstoned(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(true);
  });

  it("does NOT touch unrelated tombstones", () => {
    addChildTombstone(ENT, RID, { businessKey: "climbing wall|automated safety" });
    addChildTombstone(ENT, RID, { id: "unrelated-id" });
    addChildTombstone(ENT, RID, { businessKey: "totally|other" });
    const rows = [
      { id: "new", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    reconcileChildTombstones(ENT, RID, rows, BK, CA);
    const remaining = listChildTombstones(ENT, RID);
    expect(remaining.some((t) => t.id === "unrelated-id")).toBe(true);
    expect(remaining.some((t) => t.businessKey === "totally|other")).toBe(true);
    expect(remaining.some((t) => t.businessKey === "climbing wall|automated safety")).toBe(false);
  });
});

describe("applySystemsTombstone — Luke Lakeview shape", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("loads the existing c48ddfd0 row visible without a duplicate", () => {
    // Earlier delete left a businessKey tombstone.
    addChildTombstone(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    });
    // Server returns the one currently-saved row, created AFTER the delete.
    const serverRows = [
      {
        id: "c48ddfd0-85e2-44bd-8857-847ad22e61b1",
        name: "Climbing Wall",
        system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        id: "other-system",
        name: "Wet Willie Waterslide",
        system_name: "Water Slide",
        created_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ];
    const visible = applySystemsTombstone(RID, serverRows);
    expect(visible.map((r) => r.id)).toEqual([
      "c48ddfd0-85e2-44bd-8857-847ad22e61b1",
      "other-system",
    ]);
    // And the businessKey tombstone is gone, so subsequent loads stay clean.
    expect(isChildTombstoned(ENT, RID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(false);
  });

  it("still hides a deleted row that was created BEFORE the tombstone (completed/revision mode)", () => {
    // Simulate completed/revision-mode reload: the tombstone is the
    // authoritative user intent; an older row must NOT come back.
    addChildTombstone(ENT, RID, {
      businessKey: "crate stacking|top rope",
    });
    const rows = [
      { id: "old-row", name: "Crate Stacking", system_name: "Top Rope",
        created_at: new Date(Date.now() - 60_000).toISOString() },
      { id: "keep", name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date().toISOString() },
    ];
    const visible = applySystemsTombstone(RID, rows);
    expect(visible.map((r) => r.id)).toEqual(["keep"]);
  });

  it("preserves old id tombstone after reconciliation (historical row stays hidden)", () => {
    addChildTombstone(ENT, RID, {
      id: "b01634b2-bb95-429c-9558-c8dadeb70060",
      businessKey: "climbing wall|automated safety",
    });
    // New row with new id triggers reconciliation.
    const serverRows = [
      { id: "c48ddfd0-85e2-44bd-8857-847ad22e61b1",
        name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() + 60_000).toISOString() },
    ];
    applySystemsTombstone(RID, serverRows);
    // If the historical b01634b2 row ever reappears, it must still be hidden.
    const withHistorical = applySystemsTombstone(RID, [
      ...serverRows,
      { id: "b01634b2-bb95-429c-9558-c8dadeb70060",
        name: "Climbing Wall", system_name: "Automated Safety",
        created_at: new Date(Date.now() - 60_000).toISOString() },
    ]);
    expect(withHistorical.map((r) => r.id)).toEqual([
      "c48ddfd0-85e2-44bd-8857-847ad22e61b1",
    ]);
  });
});
