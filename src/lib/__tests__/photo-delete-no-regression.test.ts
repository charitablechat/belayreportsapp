/**
 * Photo-delete no-regression: verifies the receipt API stays stable so
 * the existing receipt-cleanup + server cross-check behavior cannot be
 * accidentally rewritten in Phase 4–6.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  savePhotoReceipt,
  getPhotoReceipts,
  removePhotoReceipt,
} from "../photo-receipts";

describe("photo-deletion receipts (no regression)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* noop */ }
  });

  it("save/get round-trip preserves a receipt", () => {
    savePhotoReceipt({
      id: "p1",
      inspectionId: "i1",
      section: "systems",
      uploaded: false,
      timestamp: Date.now(),
    });
    const list = getPhotoReceipts("i1", "systems");
    expect(list.some((r) => r.id === "p1")).toBe(true);
  });

  it("removePhotoReceipt clears the entry without affecting siblings", () => {
    savePhotoReceipt({ id: "a", inspectionId: "i1", section: "s", uploaded: false, timestamp: Date.now() });
    savePhotoReceipt({ id: "b", inspectionId: "i1", section: "s", uploaded: false, timestamp: Date.now() });
    removePhotoReceipt("a");
    const list = getPhotoReceipts("i1", "s");
    expect(list.find((r) => r.id === "a")).toBeUndefined();
    expect(list.find((r) => r.id === "b")).toBeTruthy();
  });
});
