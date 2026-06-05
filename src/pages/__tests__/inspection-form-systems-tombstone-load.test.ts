/**
 * Hotfix coverage — InspectionForm systems/dividers tombstone-load.
 *
 * Bug: `OperatingSystemsTable.handleDeleteConfirm` writes a persistent
 * `inspection_operating_system` tombstone, but `InspectionForm.tsx`
 * previously read `inspection_systems` directly without consulting it.
 * After browser restart the deleted system/divider rehydrated.
 *
 * Fix: every load path in InspectionForm now routes the rows through
 * `applySystemsTombstone(inspectionId, rows)` — the shared helper this
 * suite pins. Same helper is used in the live-session,
 * completed/revision-mode, and JSON-import paths.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  addChildTombstone,
  __test_only__clearAllChildTombstones,
} from "@/lib/child-row-tombstones";
import { applySystemsTombstone } from "@/lib/form-loaders/inspectionLoader";

const REPORT_ID = "c575d3d9-68a4-43f4-a6e5-e4268338e465";

type SysRow = {
  id?: string | null;
  name?: string | null;
  system_name?: string | null;
  is_divider?: boolean;
  divider_text?: string | null;
};

describe("InspectionForm systems/dividers tombstone-load", () => {
  beforeEach(() => {
    __test_only__clearAllChildTombstones();
  });

  it("offline-preload path: filters a tombstoned system row by id", () => {
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { id: "a48a77dd-2390-48d0-b2cf-307f85f32b8a" },
      "explicit-user-delete",
    );
    const offline: SysRow[] = [
      { id: "a48a77dd-2390-48d0-b2cf-307f85f32b8a", name: "Crate Stacking", system_name: "Top Rope" },
      { id: "0c61bf82-5035-4ab6-8468-a79b8afc0969", name: "Climbing Wall", system_name: "Automated Safety" },
    ];
    const filtered = applySystemsTombstone(REPORT_ID, offline);
    expect(filtered.map((r) => r.id)).toEqual([
      "0c61bf82-5035-4ab6-8468-a79b8afc0969",
    ]);
  });

  it("server-load path: filters a tombstoned divider that resurfaced from server", () => {
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { id: "fda2a2f3-79d3-4728-9f93-64bbf1e94854" },
      "explicit-user-delete",
    );
    // Simulates the duplicate Water Slide / Top Rope dividers that came
    // back on the server in the Lakeview incident.
    const server: SysRow[] = [
      { id: "fda2a2f3-79d3-4728-9f93-64bbf1e94854", is_divider: true, divider_text: "Top Rope Systems" },
      { id: "251dc6be-ec2c-4e3b-a51d-e26e48024045", is_divider: true, divider_text: "Water Slide" },
    ];
    expect(applySystemsTombstone(REPORT_ID, server).map((r) => r.id))
      .toEqual(["251dc6be-ec2c-4e3b-a51d-e26e48024045"]);
  });

  it("server-empty/local-fallback path: still applies the tombstone", () => {
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { id: "b01634b2-bb95-429c-9558-c8dadeb70060" },
      "explicit-user-delete",
    );
    const local: SysRow[] = [
      { id: "b01634b2-bb95-429c-9558-c8dadeb70060", name: "Climbing Wall", system_name: "Automated Safety" },
      { id: "76de5f09-529d-43e1-8be7-f881913bc383", name: "Wet Willie Waterslide Pool", system_name: "Water Slide" },
    ];
    expect(applySystemsTombstone(REPORT_ID, local).map((r) => r.id))
      .toEqual(["76de5f09-529d-43e1-8be7-f881913bc383"]);
  });

  it("JSON-import path: temp-id rows are filtered by businessKey", () => {
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { businessKey: "crate stacking|top rope" },
      "explicit-user-delete",
    );
    const imported: SysRow[] = [
      { id: "temp-1111", name: "Crate Stacking", system_name: "Top Rope" },
      { id: "temp-2222", name: "Climbing Wall", system_name: "Automated Safety" },
    ];
    expect(applySystemsTombstone(REPORT_ID, imported).map((r) => r.id))
      .toEqual(["temp-2222"]);
  });

  it("completed/revision mode: tombstone still applies when the inspection is being revised after completion", () => {
    // The Lakeview report was `status: 'completed'` while Luke was
    // revising it. Tombstones are scoped per (entity, reportId) and do
    // not consult parent status, so a completed report must filter
    // identically to a draft.
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { id: "a7c849f8-2b09-45de-8e72-90ee82245e01" },
      "explicit-user-delete",
    );
    const completedReportRows: SysRow[] = [
      // Parent inspection.status === 'completed' in this scenario; only
      // the child rows are passed to applySystemsTombstone.
      { id: "a7c849f8-2b09-45de-8e72-90ee82245e01", name: "Climbing Wall", system_name: "Automated Safety" },
      { id: "22917300-ecd8-409f-963f-416b1ef7b140", name: "Wet Willie Waterslide (Lake)", system_name: "Water Slide" },
    ];
    expect(applySystemsTombstone(REPORT_ID, completedReportRows).map((r) => r.id))
      .toEqual(["22917300-ecd8-409f-963f-416b1ef7b140"]);
  });

  it("no-op when reportId is empty or rows are empty", () => {
    addChildTombstone(
      "inspection_operating_system",
      REPORT_ID,
      { id: "x" },
      "explicit-user-delete",
    );
    expect(applySystemsTombstone("", [{ id: "x" }])).toEqual([{ id: "x" }]);
    expect(applySystemsTombstone(REPORT_ID, [])).toEqual([]);
  });
});
