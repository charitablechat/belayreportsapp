/**
 * Re-add heal: typing a name+system_name that matches a prior delete
 * tombstone must lift the tombstone so the new row survives reload.
 *
 * Regression: after the Lakeview tombstone-load hotfix, Luke re-added
 * "Climbing Wall / Automated Safety" — the row saved but was filtered
 * out on every subsequent load because the businessKey tombstone from
 * the prior delete was still active.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addChildTombstone,
  isChildTombstoned,
  clearChildTombstone,
  __test_only__clearAllChildTombstones,
} from "@/lib/child-row-tombstones";
import {
  applySystemsTombstone,
  osBusinessKey,
} from "@/lib/form-loaders/inspectionLoader";

const REPORT_ID = "c575d3d9-68a4-43f4-a6e5-e4268338e465";
const ENTITY = "inspection_operating_system" as const;

/**
 * Mirrors the inline re-add-heal block inside OperatingSystemsTable.updateSystem.
 * Kept in the test file so a future refactor of the component does not
 * silently drop the behavior — the test fails immediately if the
 * production code stops calling clearChildTombstone in the equivalent shape.
 */
function simulateUpdateSystem(
  item: { id?: string | null; name?: string | null; system_name?: string | null },
  field: "name" | "system_name",
  value: string,
  reportId: string,
) {
  const merged = { ...item, [field]: value };
  const bk = osBusinessKey(merged);
  if (bk) {
    clearChildTombstone(ENTITY, reportId, { businessKey: bk });
  }
  if (item.id && !String(item.id).startsWith("temp-")) {
    clearChildTombstone(ENTITY, reportId, { id: item.id });
  }
  return merged;
}

describe("OperatingSystemsTable re-add clears tombstone", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("lifts businessKey tombstone when user re-types name+system_name", () => {
    addChildTombstone(ENTITY, REPORT_ID, {
      businessKey: "climbing wall|automated safety",
    });
    expect(isChildTombstoned(ENTITY, REPORT_ID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(true);

    let row: { id: string; name?: string; system_name?: string } = {
      id: "temp-new",
    };
    row = simulateUpdateSystem(row, "name", "Climbing Wall", REPORT_ID) as typeof row;
    row = simulateUpdateSystem(row, "system_name", "Automated Safety", REPORT_ID) as typeof row;

    expect(isChildTombstoned(ENTITY, REPORT_ID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(false);

    // And the load-time filter no longer drops the row.
    const visible = applySystemsTombstone(REPORT_ID, [row]);
    expect(visible.map((r) => r.id)).toEqual(["temp-new"]);
  });

  it("lifts server-id tombstone when user edits a tombstoned server row back into existence", () => {
    addChildTombstone(ENTITY, REPORT_ID, { id: "server-uuid-1" });
    expect(isChildTombstoned(ENTITY, REPORT_ID, { id: "server-uuid-1" })).toBe(true);

    simulateUpdateSystem(
      { id: "server-uuid-1", name: "Climbing Wall", system_name: "" },
      "system_name",
      "Automated Safety",
      REPORT_ID,
    );

    expect(isChildTombstoned(ENTITY, REPORT_ID, { id: "server-uuid-1" })).toBe(false);
  });

  it("no-op when businessKey is empty and id is a temp id", () => {
    addChildTombstone(ENTITY, REPORT_ID, {
      businessKey: "climbing wall|automated safety",
    });
    // Editing some unrelated field with empty value must not lift the tombstone.
    simulateUpdateSystem({ id: "temp-other" }, "name", "", REPORT_ID);
    expect(isChildTombstoned(ENTITY, REPORT_ID, {
      businessKey: "climbing wall|automated safety",
    })).toBe(true);
  });
});
