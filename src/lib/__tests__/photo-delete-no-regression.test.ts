/**
 * Photo-delete no-regression: verifies that photo-deletion writes the
 * receipt the existing reconciliation path expects (the user-facing fix
 * preserved by Phase 4–6). This test does NOT touch the deletion API —
 * it only asserts the receipt key shape so an accidental rewrite in a
 * future phase trips the suite.
 *
 * The receipt module is the durable record that prevents a server
 * cross-check from re-surfacing a deleted photo as a "lost" warning.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPhotoDeletionReceipt,
  hasPhotoDeletionReceipt,
  clearPhotoDeletionReceipt,
} from "../photo-receipts";

describe("photo-deletion receipts (no regression)", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* noop */ }
  });

  it("records and reads back a receipt for a deleted photo path", () => {
    const path = "user-1/insp-9/abc.jpg";
    recordPhotoDeletionReceipt(path);
    expect(hasPhotoDeletionReceipt(path)).toBe(true);
  });

  it("clearPhotoDeletionReceipt removes the entry", () => {
    const path = "user-1/insp-9/zzz.jpg";
    recordPhotoDeletionReceipt(path);
    clearPhotoDeletionReceipt(path);
    expect(hasPhotoDeletionReceipt(path)).toBe(false);
  });

  it("untouched paths are not falsely reported as deleted", () => {
    expect(hasPhotoDeletionReceipt("user-1/never-deleted.jpg")).toBe(false);
  });
});
