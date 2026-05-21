import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const pwaState = {
  isOnline: true,
  unsyncedCount: 0,
  unsyncedPhotoCount: 0,
  unsyncedInspections: [] as any[],
  isSyncing: false,
  lastSyncTime: null as Date | null,
  syncError: null as string | null,
  syncErrorSeverity: null as "fatal" | "soft" | null,
};

vi.mock("@/hooks/usePWA", () => ({ usePWA: () => pwaState }));

const cachedUserRef = { current: null as { id: string } | null };
vi.mock("@/lib/cached-auth", () => ({
  getCachedUserFromStorage: () => cachedUserRef.current,
}));

vi.mock("@/lib/guest-session", () => ({
  isGuestUserId: (id: string | null | undefined) =>
    typeof id === "string" && id.startsWith("guest-"),
}));

import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";

function badgeStatus(): string | null {
  const el = document.querySelector("[data-sync-status]");
  return el?.getAttribute("data-sync-status") ?? null;
}

describe("SyncStatusIndicator visibility states", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    cachedUserRef.current = { id: "real-user" };
    pwaState.isOnline = true;
    pwaState.unsyncedCount = 0;
    pwaState.unsyncedPhotoCount = 0;
    pwaState.isSyncing = false;
    pwaState.syncError = null;
    pwaState.syncErrorSeverity = null;
  });

  it("renders 'synced' by default", () => {
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("synced");
  });

  it("renders 'syncing' while a drain is in flight", () => {
    pwaState.isSyncing = true;
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("syncing");
  });

  it("renders 'unsynced' with combined count", () => {
    pwaState.unsyncedCount = 3;
    pwaState.unsyncedPhotoCount = 1;
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("unsynced");
    expect(screen.getByText(/4 Unsynced/i)).toBeTruthy();
  });

  it("renders 'failed' only for fatal severity", () => {
    pwaState.syncError = "boom";
    pwaState.syncErrorSeverity = "fatal";
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("failed");
  });

  it("renders 'guest' when cached user is a guest, with disabled-sync copy", () => {
    cachedUserRef.current = { id: "guest-abc" };
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("guest");
    expect(screen.getByText(/sign in to sync/i)).toBeTruthy();
  });

  it("renders 'conflict' when dismissed-conflict ids exist in localStorage", () => {
    localStorage.setItem(
      "rw_conflict_dialog_dismissed_ids",
      JSON.stringify(["c1"]),
    );
    render(<SyncStatusIndicator />);
    expect(badgeStatus()).toBe("conflict");
  });
});
