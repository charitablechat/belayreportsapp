/**
 * Audit M2: iOS Safari bfcache pageshow handler.
 *
 * iOS Safari serves the page from bfcache on back/forward navigation,
 * tab switch, and after the device wakes from a lock. The page resumes
 * with whatever in-memory state it had when suspended — including a
 * `cachedUser` referencing an access token that has long since expired.
 *
 * The fix attaches a `pageshow` listener that, on `event.persisted`,
 * soft-invalidates in-memory caches and kicks off a single-flight
 * session refresh. This test validates:
 *
 *   1. Initial page load (`persisted=false`) does not trigger a refresh.
 *   2. bfcache restore (`persisted=true`) DOES trigger a refresh.
 *   3. The listener attaches exactly once even after multiple
 *      `getUserWithCache` calls (idempotent guard).
 *   4. A throwing `refreshSession` does not surface as an unhandled
 *      rejection on resume.
 *   5. The handler does not clear persistent offline-auth credentials
 *      (no `clearOfflineAuth` call).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const refreshSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const getSessionMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) =>
        onAuthStateChangeMock(...args),
      getSession: (...args: unknown[]) => getSessionMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}));

const clearOfflineAuthMock = vi.fn();
vi.mock("@/lib/offline-auth", () => ({
  saveUserMapping: vi.fn(() => Promise.resolve()),
  clearOfflineAuth: (...args: unknown[]) => clearOfflineAuthMock(...args),
  readSyntheticSession: vi.fn(() => null),
  clearSyntheticSession: vi.fn(),
}));

vi.mock("@/lib/synthetic-session-guard", () => ({
  isPlaceholderToken: vi.fn(() => false),
  looksLikeJwt: vi.fn(() => true),
}));

vi.mock("@/lib/safe-local-storage", () => ({
  safeSetItem: vi.fn(() => true),
}));

describe("cached-auth bfcache pageshow handler (audit M2)", () => {
  let unhandled: unknown[];
  let unhandledHandler: (reason: unknown) => void;

  beforeEach(async () => {
    vi.resetModules();
    refreshSessionMock.mockReset();
    onAuthStateChangeMock.mockReset();
    getSessionMock.mockReset();
    getUserMock.mockReset();
    clearOfflineAuthMock.mockReset();
    refreshSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    unhandled = [];
    unhandledHandler = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", unhandledHandler);

    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandledHandler);
    vi.restoreAllMocks();
  });

  async function loadModuleAndInitListener() {
    const mod = await import("../cached-auth");
    // First call lazily attaches both the auth and pageshow listeners.
    await mod.getUserWithCache().catch(() => null);
    return mod;
  }

  function dispatchPageshow(persisted: boolean) {
    const event = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", { value: persisted });
    window.dispatchEvent(event);
  }

  it("does NOT call refreshSession on initial page-load pageshow (persisted=false)", async () => {
    await loadModuleAndInitListener();
    refreshSessionMock.mockClear();
    dispatchPageshow(false);
    // Yield to event-loop microtasks.
    await Promise.resolve();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("DOES call refreshSession on bfcache restore (persisted=true)", async () => {
    await loadModuleAndInitListener();
    // Wait for any pending getUserWithCache-driven refreshes to settle, then
    // clear the call history so we observe only the pageshow-driven call.
    await new Promise((r) => setTimeout(r, 5));
    refreshSessionMock.mockClear();

    dispatchPageshow(true);
    await new Promise((r) => setTimeout(r, 5));
    // Contract: at least one refresh was kicked off by the bfcache handler.
    expect(refreshSessionMock).toHaveBeenCalled();
  });

  it("attaches the pageshow listener exactly once across multiple getUserWithCache calls", async () => {
    const addEventSpy = vi.spyOn(window, "addEventListener");
    const mod = await loadModuleAndInitListener();
    // Call again to re-trigger the lazy initializer.
    await mod.getUserWithCache().catch(() => null);
    await mod.getUserWithCache().catch(() => null);
    const pageshowAttachments = addEventSpy.mock.calls.filter(
      (c) => c[0] === "pageshow",
    ).length;
    expect(pageshowAttachments).toBe(1);
    addEventSpy.mockRestore();
  });

  it("swallows refreshSession failures so a bfcache restore does not surface an unhandled rejection", async () => {
    refreshSessionMock.mockRejectedValueOnce(new Error("network down"));
    await loadModuleAndInitListener();
    refreshSessionMock.mockClear();
    refreshSessionMock.mockRejectedValueOnce(new Error("still down"));

    dispatchPageshow(true);
    // Wait for the rejection to be handled (or surface).
    await new Promise((r) => setTimeout(r, 20));

    expect(unhandled).toEqual([]);
  });

  it("does NOT clear offline auth credentials on bfcache restore (soft invalidation only)", async () => {
    await loadModuleAndInitListener();
    clearOfflineAuthMock.mockClear();
    dispatchPageshow(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(clearOfflineAuthMock).not.toHaveBeenCalled();
  });
});
