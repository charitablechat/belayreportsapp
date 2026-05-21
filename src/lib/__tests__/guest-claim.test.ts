import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory IDB shim used by both passes of claimGuestData.
const store: Record<string, Record<string, any>> = {
  inspections: {},
  trainings: {},
  daily_assessments: {},
  inspection_systems: {},
  photos: {},
};

const objectStoreNames = {
  contains: (n: string) => n in store,
};

vi.mock("@/lib/offline-storage", () => ({
  getDB: async () => ({
    objectStoreNames,
    getAll: async (name: string) => Object.values(store[name] || {}),
    put: async (name: string, value: any) => {
      store[name][value.id] = value;
    },
  }),
  IDB_DB_NAME: "test-db",
}));

vi.mock("../guest-session", () => ({
  isGuestUserId: (id: string | null | undefined) =>
    typeof id === "string" && id.startsWith("guest-"),
  clearGuestSession: vi.fn(),
}));

import { claimGuestData, detectGuestDataForClaim } from "../guest-claim";

describe("guest-claim idempotency + failure", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) {
      for (const id of Object.keys(store[k])) delete store[k][id];
    }
    store.inspections["i1"] = { id: "i1", inspector_id: "guest-abc" };
    store.inspections["i2"] = { id: "i2", inspector_id: "guest-abc" };
    store.inspection_systems["s1"] = { id: "s1", inspector_id: "guest-abc" };
    store.photos["p1"] = { id: "p1", user_id: "guest-abc", uploaded: true };
  });

  it("migrates guest rows onto target user", async () => {
    const counts = await detectGuestDataForClaim();
    expect(counts.total).toBe(4);
    const result = await claimGuestData("real-user-1");
    expect(result.ok).toBe(true);
    expect(store.inspections["i1"].inspector_id).toBe("real-user-1");
    expect(store.photos["p1"].user_id).toBe("real-user-1");
    expect(store.photos["p1"].uploaded).toBe(1); // coerced 0|1
  });

  it("is idempotent — second pass migrates zero", async () => {
    await claimGuestData("real-user-1");
    const after = await claimGuestData("real-user-1");
    expect(after.counts.total).toBe(0);
    expect(after.ok).toBe(true);
  });

  it("rejects guest target user-id", async () => {
    const result = await claimGuestData("guest-other");
    expect(result.ok).toBe(false);
    expect(result.errors[0].store).toBe("validation");
  });

  it("preserves guest rows when target is invalid (no destructive clear)", async () => {
    await claimGuestData("");
    expect(store.inspections["i1"].inspector_id).toBe("guest-abc");
  });
});
