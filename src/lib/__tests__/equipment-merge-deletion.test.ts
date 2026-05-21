/**
 * P1 regression: a deleted equipment row must not resurrect when a stale
 * server fetch lands AFTER the user already removed it locally. The form's
 * setEquipment merge paths pass deletedEquipmentIdsRef into mergeChildArray;
 * this test pins the contract for the equipment row shape specifically so
 * a refactor of merge or deletion-tracker semantics is caught immediately.
 */
import { describe, it, expect } from "vitest";
import { mergeChildArray } from "@/lib/field-merge";
import { trackChildDeletions } from "@/lib/track-child-deletions";
import type { MutableRefObject } from "react";

type Eq = {
  id: string;
  inspection_id: string;
  equipment_category: string;
  equipment_type: string;
  production_year: number | null;
  display_order?: number;
};

describe("equipment merge — deletion suppression across refetch", () => {
  it("suppresses a server row whose id is recorded in deletedEquipmentIdsRef", () => {
    const deletedRef: MutableRefObject<Set<string>> = { current: new Set() };

    const local: Eq[] = [
      { id: "real-A", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "Petzl Vertex", production_year: 2024, display_order: 0 },
      { id: "real-B", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "Black Diamond", production_year: 2023, display_order: 1 },
    ];

    // Simulate the wrapped setter the page passes to EquipmentTable.
    let state: Eq[] = local;
    const setter = (action: any) => { state = typeof action === "function" ? action(state) : action; };
    const tracked = trackChildDeletions<Eq>(setter as any, deletedRef);

    // User deletes real-B via the row's Trash button — same path EquipmentTable
    // uses inside handleDeleteConfirm.
    tracked((prev) => prev.filter((e) => e.id !== "real-B"));
    expect(state.map((e) => e.id)).toEqual(["real-A"]);
    expect(deletedRef.current.has("real-B")).toBe(true);

    // A late server fetch still returns BOTH rows.
    const serverLate: Eq[] = [
      { id: "real-A", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "Petzl Vertex", production_year: 2024, display_order: 0 },
      { id: "real-B", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "Black Diamond", production_year: 2023, display_order: 1 },
    ];

    const merged = mergeChildArray(state, serverLate, {
      table: "equipment",
      deletedIds: deletedRef.current,
      coalesceTempByBusinessKey: [
        "inspection_id",
        "equipment_category",
        "equipment_type",
        "production_year",
      ],
    });

    // real-B must NOT resurrect.
    expect(merged.map((e) => e.id)).toEqual(["real-A"]);
  });

  it("never coalesces an empty new temp row away (no business key collapse)", () => {
    // Reproduces the "Add row triples" suspicion: a new row with empty
    // equipment_type + null production_year must not get business-key
    // coalesced into another temp row, otherwise an immediate refetch could
    // make it look like the add failed and the user might tap again,
    // creating duplicates.
    const local: Eq[] = [
      { id: "temp-1", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "", production_year: null, display_order: -1 },
      { id: "temp-2", inspection_id: "ins-1", equipment_category: "helmets", equipment_type: "", production_year: null, display_order: -2 },
    ];
    const server: Eq[] = []; // server hasn't seen them yet
    const merged = mergeChildArray(local, server, {
      table: "equipment",
      coalesceTempByBusinessKey: [
        "inspection_id",
        "equipment_category",
        "equipment_type",
        "production_year",
      ],
    });
    // Both temps survive because empty/null key fields disable coalescing.
    expect(merged.map((e) => e.id).sort()).toEqual(["temp-1", "temp-2"]);
  });
});
