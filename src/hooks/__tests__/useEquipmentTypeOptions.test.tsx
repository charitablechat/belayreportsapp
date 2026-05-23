/**
 * Regression: the Equipment Type dropdown on Lanyards / Connectors must keep
 * showing its preloaded options even when Supabase returns an empty array
 * (RLS denial under a synthetic offline JWT, transient empty response, etc.).
 * Previously, an empty Supabase response wiped the IDB cache and the
 * dropdown showed "No entries found. Start typing to create one."
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";

// ---------- mocks ----------
const lanyardCache = [
  { id: "lanyards::Petzl Absorbica", equipment_category: "lanyards", label: "Petzl Absorbica", display_order: 1, is_active: true, synced: true },
  { id: "lanyards::Yates Shock Absorbing", equipment_category: "lanyards", label: "Yates Shock Absorbing", display_order: 2, is_active: true, synced: true },
];
const connectorCache = [
  { id: "connectors::Petzl Am'D", equipment_category: "connectors", label: "Petzl Am'D", display_order: 1, is_active: true, synced: true },
  { id: "connectors::DMM Boa", equipment_category: "connectors", label: "DMM Boa", display_order: 2, is_active: true, synced: true },
  { id: "connectors::CT Quicklink", equipment_category: "connectors", label: "CT Quicklink", display_order: 3, is_active: true, synced: true },
];

const bulkPutSpy = vi.fn(async () => {});

vi.mock("@/lib/offline-storage", () => ({
  getEquipmentTypeOptions: vi.fn(async (category: string) => {
    if (category === "lanyards") return lanyardCache;
    if (category === "connectors") return connectorCache;
    if (category === "empty") return [];
    return [];
  }),
  putEquipmentTypeOption: vi.fn(async () => {}),
  bulkPutEquipmentTypeOptions: (entries: unknown) => bulkPutSpy(entries),
}));

vi.mock("@/lib/cached-auth", () => ({
  getUserWithCache: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isOnline: true }),
}));

// Supabase mock — returns empty data (simulates the RLS/transient-empty
// condition that triggered the bug).
const supabaseResult: { data: unknown[]; error: unknown } = { data: [], error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => supabaseResult,
          }),
        }),
      }),
      insert: async () => ({ error: null }),
    }),
  },
}));

import { useEquipmentTypeOptions } from "../useEquipmentTypeOptions";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEquipmentTypeOptions — empty Supabase response must not wipe cached options", () => {
  beforeEach(() => {
    bulkPutSpy.mockClear();
    supabaseResult.data = [];
    supabaseResult.error = null;
  });

  it("falls back to the IDB cache when Supabase returns an empty array (Lanyards)", async () => {
    const { result } = renderHook(() => useEquipmentTypeOptions("lanyards", []), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual(["Petzl Absorbica", "Yates Shock Absorbing"]);
  });

  it("falls back to the IDB cache when Supabase returns an empty array (Connectors)", async () => {
    const { result } = renderHook(() => useEquipmentTypeOptions("connectors", []), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual(["Petzl Am'D", "DMM Boa", "CT Quicklink"]);
  });

  it("does not overwrite the IDB cache with an empty entries[] when Supabase returns 0 rows", async () => {
    const { result } = renderHook(() => useEquipmentTypeOptions("lanyards", []), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(bulkPutSpy).not.toHaveBeenCalled();
  });

  it("adopts Supabase data when it is non-empty and writes it to the cache", async () => {
    supabaseResult.data = [
      { id: "x", equipment_category: "lanyards", label: "Server-Only Lanyard", display_order: 99, is_active: true },
    ];
    const { result } = renderHook(() => useEquipmentTypeOptions("lanyards", []), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toContain("Server-Only Lanyard");
    expect(bulkPutSpy).toHaveBeenCalledTimes(1);
  });

  it("merges in existing report values that are not in the cache or server list", async () => {
    const { result } = renderHook(
      () => useEquipmentTypeOptions("lanyards", ["Custom Field Entry"]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toContain("Custom Field Entry");
    expect(result.current.options).toContain("Petzl Absorbica");
  });

  it("returns [] only when both cache and server are empty (true cold start)", async () => {
    const { result } = renderHook(() => useEquipmentTypeOptions("empty", []), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.options).toEqual([]);
  });
});
