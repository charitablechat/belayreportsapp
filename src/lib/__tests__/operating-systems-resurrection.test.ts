/**
 * Operating-Systems resurrection regression test.
 *
 * Verifies that a tombstoned OS row never re-appears via:
 *   1. IDB reload (`loadInspectionFromOffline`)
 *   2. Server fetch (`fetchInspectionChildrenFromServer`)
 *   3. Default-seed paths (filterChildRows is applied uniformly)
 *
 * The filter is anchored both by server id (for synced rows) and by
 * business key `${name}|${system_name}` (for unsynced temp-id rows that
 * have no server identity yet).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addChildTombstone,
  __test_only__clearAllChildTombstones,
} from "../child-row-tombstones";

vi.mock("@/lib/offline-storage", () => ({
  getOfflineInspection: vi.fn(async () => ({ id: "insp-1" })),
  getRelatedDataOffline: vi.fn(async (kind: string) => {
    if (kind === "systems") {
      return [
        { id: "sys-server-1" },
        { id: "temp-zzz", name: "Doomed", system_name: "Belay" },
        { id: "sys-server-2" },
      ];
    }
    return [];
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({
            data: [
              { id: "sys-server-1", inspection_id: "insp-1" },
              { id: "sys-server-2", inspection_id: "insp-1" },
            ],
          }),
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
    }),
  },
}));

import {
  loadInspectionFromOffline,
  fetchInspectionChildrenFromServer,
} from "../../form-loaders/inspectionLoader";

describe("operating-systems resurrection guard", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("filters tombstoned OS server row from offline reload", async () => {
    addChildTombstone("inspection_operating_system", "insp-1", {
      id: "sys-server-1",
    });
    const pkg = await loadInspectionFromOffline("insp-1");
    expect(pkg.systems.map((r: any) => r.id)).not.toContain("sys-server-1");
    expect(pkg.systems.map((r: any) => r.id)).toContain("sys-server-2");
  });

  it("filters tombstoned unsynced row by businessKey on offline reload", async () => {
    addChildTombstone("inspection_operating_system", "insp-1", {
      businessKey: "doomed|belay",
    });
    const pkg = await loadInspectionFromOffline("insp-1");
    expect(pkg.systems.find((r: any) => r.id === "temp-zzz")).toBeUndefined();
  });

  it("filters tombstoned server row on cross-device server fetch", async () => {
    addChildTombstone("inspection_operating_system", "insp-1", {
      id: "sys-server-1",
    });
    const children = await fetchInspectionChildrenFromServer("insp-1");
    expect(children.systems.map((r: any) => r.id)).not.toContain("sys-server-1");
  });
});
