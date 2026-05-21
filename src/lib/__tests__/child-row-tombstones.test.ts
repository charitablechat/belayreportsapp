import { describe, it, expect, beforeEach } from "vitest";
import {
  addChildTombstone,
  filterChildRows,
  isChildTombstoned,
  clearChildTombstone,
  listChildTombstones,
  __test_only__clearAllChildTombstones,
} from "../child-row-tombstones";

const ENT = "inspection_operating_system" as const;
const RID = "inspection-test-1";

describe("child-row-tombstones", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("filters rows by server id", () => {
    addChildTombstone(ENT, RID, { id: "sys-1" });
    const rows = [{ id: "sys-1" }, { id: "sys-2" }];
    expect(filterChildRows(ENT, RID, rows)).toEqual([{ id: "sys-2" }]);
  });

  it("filters rows by businessKey for unsynced temp ids", () => {
    addChildTombstone(ENT, RID, { businessKey: "main gate|zipline" });
    const rows = [
      { id: "temp-1", name: "Main Gate", system_name: "Zipline" },
      { id: "temp-2", name: "Other", system_name: "Belay" },
    ];
    const out = filterChildRows(ENT, RID, rows, (r: any) =>
      `${(r.name ?? "").toLowerCase()}|${(r.system_name ?? "").toLowerCase()}`,
    );
    expect(out.map((r) => r.id)).toEqual(["temp-2"]);
  });

  it("ignores rows without anchor id/businessKey", () => {
    addChildTombstone(ENT, RID, { id: null, businessKey: null });
    expect(listChildTombstones(ENT, RID)).toHaveLength(0);
  });

  it("isChildTombstoned reflects state; clearChildTombstone removes it", () => {
    addChildTombstone(ENT, RID, { id: "a" });
    expect(isChildTombstoned(ENT, RID, { id: "a" })).toBe(true);
    clearChildTombstone(ENT, RID, { id: "a" });
    expect(isChildTombstoned(ENT, RID, { id: "a" })).toBe(false);
  });

  it("scoped per reportId — other reports not affected", () => {
    addChildTombstone(ENT, RID, { id: "shared" });
    expect(filterChildRows(ENT, "other-report", [{ id: "shared" }])).toEqual([
      { id: "shared" },
    ]);
  });
});
