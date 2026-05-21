/**
 * Guest-claim failure path: when per-store puts fail, guest data must
 * remain on the device and a retry-available signal must fire so the
 * user can attempt the claim again without losing local work.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const store: Record<string, Record<string, any>> = {
  inspections: {},
  inspection_systems: {},
  photos: {},
};
const objectStoreNames = { contains: (n: string) => n in store };

vi.mock("@/lib/offline-storage", () => ({
  getDB: async () => ({
    objectStoreNames,
    getAll: async (name: string) => Object.values(store[name] || {}),
    put: async (_name: string, _value: any) => {
      throw new Error("simulated IDB write failure");
    },
  }),
  IDB_DB_NAME: "test-db",
}));

vi.mock("../guest-session", () => ({
  isGuestUserId: (id: string | null | undefined) =>
    typeof id === "string" && id.startsWith("guest-"),
  clearGuestSession: vi.fn(),
}));

import { claimGuestData } from "../guest-claim";
import * as guestSession from "../guest-session";
const clearGuestSessionMock = guestSession.clearGuestSession as ReturnType<typeof vi.fn>;

describe("guest-claim failure handling", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) {
      for (const id of Object.keys(store[k])) delete store[k][id];
    }
    store.inspections["i1"] = { id: "i1", inspector_id: "guest-abc" };
    clearGuestSessionMock.mockClear();
  });

  it("does not clear the guest session on failure and surfaces retry signal", async () => {
    const events: string[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).type);
    window.addEventListener("guest.claim.failed", listener);
    window.addEventListener("guest.claim.retry-available", listener);

    const result = await claimGuestData("real-user-1");
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(clearGuestSessionMock).not.toHaveBeenCalled();
    expect(events).toContain("guest.claim.failed");
    expect(events).toContain("guest.claim.retry-available");

    window.removeEventListener("guest.claim.failed", listener);
    window.removeEventListener("guest.claim.retry-available", listener);
  });
});
