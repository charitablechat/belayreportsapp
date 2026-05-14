import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mocks must be hoisted before importing the hook under test.
const mockGetEquipmentTypeOptions = vi.fn();
const mockBulkPutEquipmentTypeOptions = vi.fn();
const mockPutEquipmentTypeOption = vi.fn();
vi.mock("@/lib/offline-storage", () => ({
  getEquipmentTypeOptions: (...a: any[]) => mockGetEquipmentTypeOptions(...a),
  bulkPutEquipmentTypeOptions: (...a: any[]) => mockBulkPutEquipmentTypeOptions(...a),
  putEquipmentTypeOption: (...a: any[]) => mockPutEquipmentTypeOption(...a),
}));

vi.mock("@/lib/cached-auth", () => ({
  getUserWithCache: vi.fn(async () => ({ id: "user-1" })),
}));

let isOnlineFlag = true;
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isOnline: isOnlineFlag }),
}));

const mockOrder = vi.fn();
const mockEqActive = vi.fn(() => ({ order: mockOrder }));
const mockEqCategory = vi.fn(() => ({ eq: mockEqActive }));
const mockSelect = vi.fn(() => ({ eq: mockEqCategory }));
const mockInsert = vi.fn(async () => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
    })),
  },
}));

import {
  useElementNameOptions,
  DEFAULT_ELEMENT_NAMES,
} from "@/hooks/useElementNameOptions";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isOnlineFlag = true;
  mockGetEquipmentTypeOptions.mockResolvedValue([]);
  mockOrder.mockResolvedValue({ data: [], error: null });
});

describe("useElementNameOptions", () => {
  it("returns DEFAULT_ELEMENT_NAMES when offline and IDB cache is empty", async () => {
    isOnlineFlag = false;
    mockGetEquipmentTypeOptions.mockResolvedValue([]);

    const { result } = renderHook(() => useElementNameOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.options.length).toBeGreaterThan(0));
    expect(result.current.options).toEqual(DEFAULT_ELEMENT_NAMES);
  });

  it("returns IDB cache labels when offline with cached entries", async () => {
    isOnlineFlag = false;
    mockGetEquipmentTypeOptions.mockResolvedValue([
      { id: "operating_system_elements::Cached A", equipment_category: "operating_system_elements", label: "Cached A", display_order: 1, is_active: true, synced: true },
      { id: "operating_system_elements::Cached B", equipment_category: "operating_system_elements", label: "Cached B", display_order: 2, is_active: true, synced: true },
    ]);

    const { result } = renderHook(() => useElementNameOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.options).toEqual(["Cached A", "Cached B"]));
  });

  it("uses server rows and writes them to IDB when online with data", async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: "1", equipment_category: "operating_system_elements", label: "Server A", display_order: 1, is_active: true },
        { id: "2", equipment_category: "operating_system_elements", label: "Server B", display_order: 2, is_active: true },
      ],
      error: null,
    });

    const { result } = renderHook(() => useElementNameOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.options).toEqual(["Server A", "Server B"]));
    expect(mockBulkPutEquipmentTypeOptions).toHaveBeenCalledTimes(1);
  });

  it("seeds defaults via supabase insert when online and DB is empty", async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useElementNameOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.options).toEqual(DEFAULT_ELEMENT_NAMES));
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0];
    expect(Array.isArray(inserted)).toBe(true);
    expect(inserted.map((r: any) => r.label)).toEqual(DEFAULT_ELEMENT_NAMES);
    expect(inserted.every((r: any) => r.equipment_category === "operating_system_elements")).toBe(true);
  });

  it("merges existingValues into options (case-insensitive dedupe)", async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: "1", equipment_category: "operating_system_elements", label: "Tower", display_order: 1, is_active: true }],
      error: null,
    });

    const { result } = renderHook(
      () => useElementNameOptions(["TOWER", "Custom Element"]),
      { wrapper: wrapper() }
    );
    await waitFor(() => expect(result.current.options).toEqual(["Tower", "Custom Element"]));
  });

  it("addOption inserts a new label and skips duplicates", async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: "1", equipment_category: "operating_system_elements", label: "Tower", display_order: 1, is_active: true }],
      error: null,
    });

    const { result } = renderHook(() => useElementNameOptions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.options).toEqual(["Tower"]));

    result.current.addOption("Brand New");
    await waitFor(() => expect(mockPutEquipmentTypeOption).toHaveBeenCalled());
    await waitFor(() => expect(mockInsert).toHaveBeenCalled());
    const lastInsertCall = mockInsert.mock.calls[mockInsert.mock.calls.length - 1][0];
    expect(lastInsertCall.label).toBe("Brand New");

    mockInsert.mockClear();
    mockPutEquipmentTypeOption.mockClear();
    result.current.addOption("tower"); // duplicate, case-insensitive
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockPutEquipmentTypeOption).not.toHaveBeenCalled();
  });
});
