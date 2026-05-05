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
const captureExceptionMock = vi.fn((..._args: unknown[]): unknown => {
  throw new Error("simulated sentry failure");
});

vi.mock("@/lib/sentry", () => ({
  captureException: captureExceptionMock,
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

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureExceptionMock.mockClear();
    // Reset the mock impl back to the default (throws) so each test starts
    // from the same severity-swallowing baseline.
    captureExceptionMock.mockImplementation(() => {
      throw new Error("simulated sentry failure");
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
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

  it("Mode 13: forwards level='warning' to Sentry and uses console.warn locally", async () => {
    captureExceptionMock.mockImplementation(() => {});
    logError(new Error("recoverable"), {
      scope: "atomic-sync.syncInspection",
      level: "warning",
    });
    // Local DevTools view matches Sentry severity: warning → console.warn.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[logError]",
      expect.objectContaining({ level: "warning" }),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    // Flush the dynamic-import microtasks so the captureException forward
    // has a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("Mode 13: forwards fingerprint array to Sentry capture options", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const fingerprint = [
      "atomic-sync.syncInspection",
      "rollback-successful",
      "upsert:inspection_ziplines",
      "{{default}}",
    ];
    logError(new Error("recoverable"), {
      scope: "atomic-sync.syncInspection",
      level: "warning",
      fingerprint,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      expect.objectContaining({ fingerprint }),
    );
  });

  it("Mode 13: defaults to console.error + no level option when level is omitted (back-compat)", async () => {
    captureExceptionMock.mockImplementation(() => {});
    logError(new Error("hard fail"), { scope: "atomic-sync.syncInspection" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Without an explicit level, the third argument's level field is undefined
    // (the SDK then uses its `error` default).
    const lastCall = captureExceptionMock.mock.calls.at(-1);
    expect(lastCall?.[2]).toEqual(
      expect.objectContaining({ level: undefined }),
    );
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
