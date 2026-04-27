/**
 * Contract tests for the centralized error-logging seam.
 *
 * The campaign hot paths (atomic-sync, useAutoSync, form save catches,
 * cloud-backup) all call `logError` from inside `catch` blocks and
 * MUST NOT have their failure paths broken by a logging side-effect:
 *
 * - `logError` must not throw, even if Sentry init fails or the
 *   audit_logs RPC rejects.
 * - `logError` must return synchronously (it fires the Sentry forward
 *   and the audit_logs RPC as fire-and-forget background promises).
 * - The original error reaches `console.error` regardless of whether
 *   the Sentry / RPC forwards succeed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Sentry module to throw — proves logError swallows downstream errors.
vi.mock("@/lib/sentry", () => ({
  captureException: vi.fn(() => {
    throw new Error("simulated sentry failure");
  }),
}));

// Mock the supabase client so the audit_logs RPC path is exercised but
// can't actually hit the network during the unit run.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() =>
      Promise.reject(new Error("simulated rpc failure")),
    ),
  },
}));

import { logError } from "../log-error";

describe("logError", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns synchronously without throwing on a real Error", () => {
    expect(() => logError(new Error("boom"))).not.toThrow();
  });

  it("returns synchronously without throwing on non-Error values", () => {
    expect(() => logError("string error")).not.toThrow();
    expect(() => logError(null)).not.toThrow();
    expect(() => logError(undefined)).not.toThrow();
    expect(() => logError({ code: 42 })).not.toThrow();
  });

  it("logs to console.error with the structured payload", () => {
    logError(new Error("boom"), { scope: "test.scope" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[logError]",
      expect.objectContaining({
        message: "boom",
        scope: "test.scope",
      }),
    );
  });

  it("does not propagate Sentry forward failures", () => {
    // Sentry mock throws, audit-logs mock rejects — logError must still
    // return cleanly. This is the key contract: a logging crash inside
    // a `catch` block must not mask the original failure.
    expect(() => logError(new Error("boom"))).not.toThrow();
  });

  it("swallows rejections from both forward paths so the global unhandledrejection handler cannot recurse", async () => {
    // Critical contract: if either dynamic-import / forward chain leaks
    // an unhandled rejection, the new global handler in main.tsx will
    // call logError → trigger the same import → leak again → infinite
    // loop. Both `.then` chains in log-error.ts must end in `.catch`.
    const onUnhandled = vi.fn();
    if (typeof process !== "undefined" && process.on) {
      process.on("unhandledRejection", onUnhandled);
    }

    logError(new Error("boom"), { scope: "recursion-guard" });
    // Flush microtasks so any leaked rejection would have surfaced.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onUnhandled).not.toHaveBeenCalled();

    if (typeof process !== "undefined" && process.off) {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
