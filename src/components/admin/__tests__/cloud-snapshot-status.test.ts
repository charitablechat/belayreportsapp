/**
 * Cloud Snapshots panel — badge label mapping contract.
 *
 * Validates that the cloud-panel status mapping:
 *   - covers all four resolver buckets;
 *   - never produces the old destructive generic "Unsynced" label;
 *   - uses "Cloud backup" (not "Local backup") for the `local_only` bucket;
 *   - keeps the shared resolver read-only (no IDB writes, no
 *     `markCloudBackupSynced`, no envelope save, no cloud upload).
 *
 * The resolver itself is independently covered by
 * `src/lib/__tests__/local-backup-status.test.ts` (17/17). This file pins the
 * cloud-specific UI contract only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks: read-only IDB getters ─────────────────────────────────────────

const getOfflineInspection = vi.fn();
const getOfflineTraining = vi.fn();
const getOfflineDailyAssessment = vi.fn();

vi.mock("@/lib/offline-storage", () => ({
  getOfflineInspection: (...a: unknown[]) => getOfflineInspection(...a),
  getOfflineTraining: (...a: unknown[]) => getOfflineTraining(...a),
  getOfflineDailyAssessment: (...a: unknown[]) => getOfflineDailyAssessment(...a),
}));

// No-write contract spies. If any of these fire during status resolution,
// the panel would be mutating data during discovery — fail loudly.
const markCloudBackupSyncedSpy = vi.fn();
const uploadSnapshotToCloudSpy = vi.fn();
const saveReportSnapshotSpy = vi.fn();
const markSnapshotSyncedSpy = vi.fn();
vi.mock("@/lib/cloud-backup", () => ({
  markCloudBackupSynced: (...a: unknown[]) => markCloudBackupSyncedSpy(...a),
  uploadSnapshotToCloud: (...a: unknown[]) => uploadSnapshotToCloudSpy(...a),
}));
vi.mock("@/lib/local-backup-ledger", () => ({
  saveReportSnapshot: (...a: unknown[]) => saveReportSnapshotSpy(...a),
  markSnapshotSynced: (...a: unknown[]) => markSnapshotSyncedSpy(...a),
}));

import { resolveSnapshotStatuses, snapshotStatusKey, type ResolvedSnapshotStatus } from "@/lib/local-backup-status";
import { CLOUD_STATUS_META } from "@/components/admin/DataRecoveryTool";

const T0 = 1_700_000_000_000;

beforeEach(() => {
  getOfflineInspection.mockReset();
  getOfflineTraining.mockReset();
  getOfflineDailyAssessment.mockReset();
  markCloudBackupSyncedSpy.mockReset();
  uploadSnapshotToCloudSpy.mockReset();
  saveReportSnapshotSpy.mockReset();
  markSnapshotSyncedSpy.mockReset();
});

// ── 1. Badge mapping contract ────────────────────────────────────────────

describe("CLOUD_STATUS_META mapping", () => {
  it("covers all four resolver buckets", () => {
    const buckets: ResolvedSnapshotStatus[] = ["synced", "pending", "local_only", "unknown"];
    for (const b of buckets) {
      expect(CLOUD_STATUS_META[b]).toBeDefined();
      expect(CLOUD_STATUS_META[b].label).toBeTruthy();
      expect(CLOUD_STATUS_META[b].tooltip).toBeTruthy();
    }
  });

  it("uses the approved cloud-panel labels", () => {
    expect(CLOUD_STATUS_META.synced.label).toBe("Report synced");
    expect(CLOUD_STATUS_META.pending.label).toBe("Pending report sync");
    expect(CLOUD_STATUS_META.local_only.label).toBe("Cloud backup");
    expect(CLOUD_STATUS_META.unknown.label).toBe("Status unknown");
  });

  it("uses 'Cloud backup' (not 'Local backup') for the local_only bucket", () => {
    expect(CLOUD_STATUS_META.local_only.label).toBe("Cloud backup");
    expect(CLOUD_STATUS_META.local_only.label).not.toBe("Local backup");
  });

  it("never produces the old destructive generic 'Unsynced' label", () => {
    for (const meta of Object.values(CLOUD_STATUS_META)) {
      expect(meta.label).not.toBe("Unsynced");
      expect(meta.variant).not.toBe("destructive");
    }
  });

  it("uses non-alarming badge variants only", () => {
    const allowed = new Set(["default", "secondary", "outline"]);
    for (const meta of Object.values(CLOUD_STATUS_META)) {
      expect(allowed.has(meta.variant)).toBe(true);
    }
  });
});

// ── 2. Resolver dispatch — read-only IDB only ────────────────────────────

describe("resolveSnapshotStatuses (cloud panel usage)", () => {
  it("classifies all four buckets across all three report types", async () => {
    // inspection → synced (synced_at >= updated_at)
    getOfflineInspection.mockResolvedValueOnce({
      id: "i1",
      updated_at: new Date(T0 - 60_000).toISOString(),
      synced_at: new Date(T0).toISOString(),
    });
    // training → pending (updated_at > synced_at)
    getOfflineTraining.mockResolvedValueOnce({
      id: "t1",
      updated_at: new Date(T0).toISOString(),
      synced_at: new Date(T0 - 60_000).toISOString(),
    });
    // daily_assessment → local_only (record missing)
    getOfflineDailyAssessment.mockResolvedValueOnce(null);
    // inspection → unknown (IDB throws)
    getOfflineInspection.mockRejectedValueOnce(new Error("idb closed"));

    const inputs = [
      { reportType: "inspection" as const, reportId: "i1" },
      { reportType: "training" as const, reportId: "t1" },
      { reportType: "daily_assessment" as const, reportId: "d1" },
      { reportType: "inspection" as const, reportId: "i2" },
    ];

    const map = await resolveSnapshotStatuses(inputs);

    expect(map.get(snapshotStatusKey(inputs[0]))).toBe("synced");
    expect(map.get(snapshotStatusKey(inputs[1]))).toBe("pending");
    expect(map.get(snapshotStatusKey(inputs[2]))).toBe("local_only");
    expect(map.get(snapshotStatusKey(inputs[3]))).toBe("unknown");

    // Each cloud bucket maps to a defined badge label.
    for (const status of map.values()) {
      expect(CLOUD_STATUS_META[status].label).toBeTruthy();
    }
  });

  it("issues only read-only IDB calls — no writes, no mark-synced, no upload", async () => {
    getOfflineInspection.mockResolvedValue({
      id: "i1",
      updated_at: new Date(T0).toISOString(),
      synced_at: new Date(T0).toISOString(),
    });
    getOfflineTraining.mockResolvedValue(null);
    getOfflineDailyAssessment.mockResolvedValue(null);

    await resolveSnapshotStatuses([
      { reportType: "inspection", reportId: "i1" },
      { reportType: "training", reportId: "t1" },
      { reportType: "daily_assessment", reportId: "d1" },
    ]);

    expect(markCloudBackupSyncedSpy).not.toHaveBeenCalled();
    expect(uploadSnapshotToCloudSpy).not.toHaveBeenCalled();
    expect(saveReportSnapshotSpy).not.toHaveBeenCalled();
    expect(markSnapshotSyncedSpy).not.toHaveBeenCalled();
    expect(getOfflineInspection).toHaveBeenCalledTimes(1);
    expect(getOfflineTraining).toHaveBeenCalledTimes(1);
    expect(getOfflineDailyAssessment).toHaveBeenCalledTimes(1);
  });
});
