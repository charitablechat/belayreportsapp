/**
 * Read-only status resolver for the Data Recovery local snapshot panel.
 *
 * Validates:
 *   - status mapping across all 4 buckets (synced / pending / local_only / unknown);
 *   - per-report-type dispatch (inspection / training / daily_assessment);
 *   - fallback when the report isn't in IDB;
 *   - resolver never writes (no calls to envelope save / mark-synced / cloud upload).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

const getOfflineInspection = vi.fn();
const getOfflineTraining = vi.fn();
const getOfflineDailyAssessment = vi.fn();

vi.mock("@/lib/offline-storage", () => ({
  getOfflineInspection: (...a: unknown[]) => getOfflineInspection(...a),
  getOfflineTraining: (...a: unknown[]) => getOfflineTraining(...a),
  getOfflineDailyAssessment: (...a: unknown[]) => getOfflineDailyAssessment(...a),
}));

// Spy mounts for the no-write contract.
const saveReportSnapshotSpy = vi.fn();
const markSnapshotSyncedSpy = vi.fn();
const uploadSnapshotToCloudSpy = vi.fn();
vi.mock("@/lib/local-backup-ledger", async () => {
  return {
    saveReportSnapshot: (...a: unknown[]) => saveReportSnapshotSpy(...a),
    markSnapshotSynced: (...a: unknown[]) => markSnapshotSyncedSpy(...a),
  };
});
vi.mock("@/lib/cloud-backup", () => ({
  uploadSnapshotToCloud: (...a: unknown[]) => uploadSnapshotToCloudSpy(...a),
  markCloudBackupSynced: vi.fn(),
}));

import {
  classifyFromReportRecord,
  resolveSnapshotStatuses,
  snapshotStatusKey,
} from "@/lib/local-backup-status";

// ── Helpers ──────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000; // arbitrary, all times relative to this.

beforeEach(() => {
  getOfflineInspection.mockReset();
  getOfflineTraining.mockReset();
  getOfflineDailyAssessment.mockReset();
  saveReportSnapshotSpy.mockReset();
  markSnapshotSyncedSpy.mockReset();
  uploadSnapshotToCloudSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── classifyFromReportRecord ─────────────────────────────────────────────

describe("classifyFromReportRecord", () => {
  it("returns 'local_only' when the record is null/undefined", () => {
    expect(classifyFromReportRecord(null)).toBe("local_only");
    expect(classifyFromReportRecord(undefined)).toBe("local_only");
  });

  it("returns 'synced' when synced_at >= updated_at", () => {
    expect(
      classifyFromReportRecord({ updated_at: T0, synced_at: T0 + 1000 }),
    ).toBe("synced");
    expect(
      classifyFromReportRecord({ updated_at: T0, synced_at: T0 }),
    ).toBe("synced");
  });

  it("returns 'pending' when updated_at > synced_at", () => {
    expect(
      classifyFromReportRecord({ updated_at: T0 + 5000, synced_at: T0 }),
    ).toBe("pending");
  });

  it("returns 'pending' when synced_at is missing", () => {
    expect(classifyFromReportRecord({ updated_at: T0 })).toBe("pending");
    expect(classifyFromReportRecord({ updated_at: T0, synced_at: null })).toBe(
      "pending",
    );
  });

  it("returns 'synced' when synced_at exists but updated_at is missing", () => {
    // Server has it, no known local edit.
    expect(classifyFromReportRecord({ synced_at: T0 })).toBe("synced");
  });

  it("accepts ISO-string timestamps", () => {
    expect(
      classifyFromReportRecord({
        updated_at: new Date(T0).toISOString(),
        synced_at: new Date(T0 + 1000).toISOString(),
      }),
    ).toBe("synced");
    expect(
      classifyFromReportRecord({
        updated_at: new Date(T0 + 1000).toISOString(),
        synced_at: new Date(T0).toISOString(),
      }),
    ).toBe("pending");
  });
});

// ── resolveSnapshotStatuses — per-type dispatch + fallback ───────────────

describe("resolveSnapshotStatuses", () => {
  it.each([
    ["inspection", () => getOfflineInspection] as const,
    ["training", () => getOfflineTraining] as const,
    ["daily_assessment", () => getOfflineDailyAssessment] as const,
  ])("dispatches to the right getter for %s", async (type, getMock) => {
    getMock().mockResolvedValueOnce({ updated_at: T0, synced_at: T0 + 1 });
    const out = await resolveSnapshotStatuses([
      { reportType: type as never, reportId: "abc" },
    ]);
    expect(
      out.get(snapshotStatusKey({ reportType: type as never, reportId: "abc" })),
    ).toBe("synced");
    expect(getMock()).toHaveBeenCalledWith("abc");
  });

  it("maps a synced inspection record to 'synced'", async () => {
    getOfflineInspection.mockResolvedValueOnce({
      updated_at: T0,
      synced_at: T0 + 1,
    });
    const out = await resolveSnapshotStatuses([
      { reportType: "inspection", reportId: "i1" },
    ]);
    expect(out.get("inspection:i1")).toBe("synced");
  });

  it("maps a training record with updated_at > synced_at to 'pending'", async () => {
    getOfflineTraining.mockResolvedValueOnce({
      updated_at: T0 + 5,
      synced_at: T0,
    });
    const out = await resolveSnapshotStatuses([
      { reportType: "training", reportId: "t1" },
    ]);
    expect(out.get("training:t1")).toBe("pending");
  });

  it("maps a daily_assessment record with no synced_at to 'pending'", async () => {
    getOfflineDailyAssessment.mockResolvedValueOnce({ updated_at: T0 });
    const out = await resolveSnapshotStatuses([
      { reportType: "daily_assessment", reportId: "d1" },
    ]);
    expect(out.get("daily_assessment:d1")).toBe("pending");
  });

  it("falls back to 'local_only' when the report is missing from IDB", async () => {
    getOfflineInspection.mockResolvedValueOnce(null);
    getOfflineTraining.mockResolvedValueOnce(undefined);
    getOfflineDailyAssessment.mockResolvedValueOnce(null);
    const out = await resolveSnapshotStatuses([
      { reportType: "inspection", reportId: "i-missing" },
      { reportType: "training", reportId: "t-missing" },
      { reportType: "daily_assessment", reportId: "d-missing" },
    ]);
    expect(out.get("inspection:i-missing")).toBe("local_only");
    expect(out.get("training:t-missing")).toBe("local_only");
    expect(out.get("daily_assessment:d-missing")).toBe("local_only");
  });

  it("never downgrades a verified-missing record to 'Unsynced'", async () => {
    // Regression: even when the envelope was written with synced=false,
    // resolver must return 'local_only', not anything that renders as
    // the old alarming "Unsynced" label.
    getOfflineInspection.mockResolvedValueOnce(null);
    const out = await resolveSnapshotStatuses([
      { reportType: "inspection", reportId: "i-x" },
    ]);
    const status = out.get("inspection:i-x");
    expect(status).toBe("local_only");
    expect(status).not.toBe("unknown");
    expect(status).not.toBe("pending");
  });

  it("returns 'unknown' when the IDB getter throws", async () => {
    getOfflineInspection.mockRejectedValueOnce(new Error("idb down"));
    const out = await resolveSnapshotStatuses([
      { reportType: "inspection", reportId: "i-err" },
    ]);
    expect(out.get("inspection:i-err")).toBe("unknown");
  });

  it("resolves a mixed batch correctly without performing any writes", async () => {
    getOfflineInspection
      .mockResolvedValueOnce({ updated_at: T0, synced_at: T0 + 1 })   // synced
      .mockResolvedValueOnce({ updated_at: T0 + 1, synced_at: T0 })   // pending
      .mockResolvedValueOnce(null);                                    // local_only
    getOfflineTraining
      .mockResolvedValueOnce({ updated_at: T0, synced_at: T0 + 1 })   // synced
      .mockRejectedValueOnce(new Error("boom"));                       // unknown
    getOfflineDailyAssessment
      .mockResolvedValueOnce({ updated_at: T0 })                       // pending
      .mockResolvedValueOnce(null);                                    // local_only

    const inputs = [
      { reportType: "inspection" as const,        reportId: "i1" },
      { reportType: "inspection" as const,        reportId: "i2" },
      { reportType: "inspection" as const,        reportId: "i3" },
      { reportType: "training" as const,          reportId: "t1" },
      { reportType: "training" as const,          reportId: "t2" },
      { reportType: "daily_assessment" as const,  reportId: "d1" },
      { reportType: "daily_assessment" as const,  reportId: "d2" },
    ];

    const out = await resolveSnapshotStatuses(inputs);

    expect(out.get("inspection:i1")).toBe("synced");
    expect(out.get("inspection:i2")).toBe("pending");
    expect(out.get("inspection:i3")).toBe("local_only");
    expect(out.get("training:t1")).toBe("synced");
    expect(out.get("training:t2")).toBe("unknown");
    expect(out.get("daily_assessment:d1")).toBe("pending");
    expect(out.get("daily_assessment:d2")).toBe("local_only");

    // Hard contract: status resolution must NOT mutate the envelope,
    // mark snapshots synced, or trigger a cloud upload.
    expect(saveReportSnapshotSpy).not.toHaveBeenCalled();
    expect(markSnapshotSyncedSpy).not.toHaveBeenCalled();
    expect(uploadSnapshotToCloudSpy).not.toHaveBeenCalled();
  });

  it("handles an empty input list without calling any getter", async () => {
    const out = await resolveSnapshotStatuses([]);
    expect(out.size).toBe(0);
    expect(getOfflineInspection).not.toHaveBeenCalled();
    expect(getOfflineTraining).not.toHaveBeenCalled();
    expect(getOfflineDailyAssessment).not.toHaveBeenCalled();
  });
});
