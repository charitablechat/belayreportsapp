/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock IDB layer used by last-known-account before importing module.
vi.mock("idb", () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    openDB: vi.fn(async (name: string, _v: number, opts?: any) => {
      if (!stores.has(name)) {
        stores.set(name, new Map());
        opts?.upgrade?.({
          objectStoreNames: { contains: () => false },
          createObjectStore: () => {},
        });
      }
      const map = stores.get(name)!;
      return {
        async put(_store: string, val: any) {
          map.set(val.userId, val);
        },
        async getAll() {
          return [...map.values()];
        },
        async clear() {
          map.clear();
        },
        close() {},
      };
    }),
  };
});

import {
  saveLastKnownAccount,
  getLastKnownAccount,
  getLastKnownAccountAsync,
  clearLastKnownAccount,
  hasLastKnownAccount,
} from "@/lib/last-known-account";

describe("last-known-account", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    saveLastKnownAccount({ userId: "u1", email: "a@b.co", displayName: "A" });
    const r = getLastKnownAccount();
    expect(r?.userId).toBe("u1");
    expect(r?.email).toBe("a@b.co");
    expect(hasLastKnownAccount()).toBe(true);
  });

  it("returns null on corrupt JSON", () => {
    localStorage.setItem("last_known_account", "{not json");
    expect(getLastKnownAccount()).toBeNull();
  });

  it("rehydrates from IDB mirror when localStorage is wiped", async () => {
    saveLastKnownAccount({ userId: "u2", email: "x@y.z" });
    // simulate localStorage eviction
    localStorage.clear();
    await new Promise((r) => setTimeout(r, 10));
    const r = await getLastKnownAccountAsync();
    expect(r?.userId).toBe("u2");
    // and the rehydrate writes back to LS
    expect(getLastKnownAccount()?.userId).toBe("u2");
  });

  it("clearLastKnownAccount removes both layers", async () => {
    saveLastKnownAccount({ userId: "u3" });
    await new Promise((r) => setTimeout(r, 10));
    await clearLastKnownAccount();
    expect(getLastKnownAccount()).toBeNull();
    const r = await getLastKnownAccountAsync();
    expect(r).toBeNull();
  });
});
