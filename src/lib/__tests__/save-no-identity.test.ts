/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSaveWithoutIdentity,
  recordBootAuthOutcome,
} from "@/lib/offline-readiness";

describe("save.no-identity telemetry", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("increments the session counter", () => {
    recordSaveWithoutIdentity({ op: "inspection-save" });
    recordSaveWithoutIdentity({ op: "photo-delete" });
    const count = parseInt(sessionStorage.getItem("save.no-identity.count") || "0", 10);
    expect(count).toBe(2);
  });

  it("records boot.auth.outcome", () => {
    recordBootAuthOutcome("last-known-account-resume");
    expect(sessionStorage.getItem("boot.auth.outcome")).toBe("last-known-account-resume");
  });

  it("does not throw on repeated calls", () => {
    for (let i = 0; i < 10; i++) {
      recordSaveWithoutIdentity({ op: "emergency-save" });
    }
    expect(parseInt(sessionStorage.getItem("save.no-identity.count") || "0", 10)).toBe(10);
  });
});
