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
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(lastCall?.[2]).toEqual(
      expect.objectContaining({ level: undefined }),
    );
  });

  it("IdbSaveError auto-classify: defaults to level='warning' + fingerprint=[IdbSaveError, code, op, default]", async () => {
    captureExceptionMock.mockImplementation(() => {});
    // Construct an error with the IdbSaveError shape without importing the
    // class (avoids pulling offline-storage into the test module graph).
    const err = Object.assign(new Error("[saveInspectionOffline] save failed: timeout"), {
      name: "IdbSaveError",
      code: "timeout",
      operationName: "saveInspectionOffline",
    });
    logError(err, { scope: "InspectionForm.performSave" });
    // Caller passed no level → auto-downgraded to warning, so console.warn
    // (not console.error) is used locally.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[logError]",
      expect.objectContaining({ level: "warning" }),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      expect.objectContaining({
        level: "warning",
        fingerprint: [
          "IdbSaveError",
          "timeout",
          "saveInspectionOffline",
          "{{default}}",
        ],
      }),
    );
  });

  it("IdbSaveError auto-classify: caller-supplied level + fingerprint win over defaults", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const err = Object.assign(new Error("[saveTrainingOffline] save failed: idb_closing"), {
      name: "IdbSaveError",
      code: "idb_closing",
      operationName: "saveTrainingOffline",
    });
    const customFingerprint = ["custom", "override", "{{default}}"];
    logError(err, {
      scope: "TrainingForm.saveTraining",
      level: "error",
      fingerprint: customFingerprint,
    });
    // Caller said level='error' → console.error (not warn).
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      expect.objectContaining({
        level: "error",
        fingerprint: customFingerprint,
      }),
    );
  });

  it("IdbSaveError auto-classify: ignores values that only LOOK like IdbSaveError (no string code)", async () => {
    captureExceptionMock.mockImplementation(() => {});
    // name matches but code is missing — must NOT be auto-downgraded
    // (defensive: only the canonical shape from offline-storage.ts qualifies).
    const err = Object.assign(new Error("imposter"), {
      name: "IdbSaveError",
      // code intentionally omitted
    });
    logError(err, { scope: "test.imposter" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(lastCall?.[2]).toEqual(
      expect.objectContaining({ level: undefined }),
    );
  });

  it("Mode 14: flattens IdbSaveError.cause diagnostic shape into Sentry extra context", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const diag = {
      store: 'inspections',
      probeMs: 12,
      opMs: 7993,
      elapsedMs: 8005,
      timeoutMs: 8000,
      inPostOnlineGrace: false,
      layerBreakerOpen: false,
      breakerOpen: true,
      breakerFailureCount: 3,
      quotaBytes: 1_000_000_000,
      usageBytes: 250_000_000,
      usagePct: 25,
      persisted: true,
      userAgent: 'Mozilla/5.0',
      platform: 'iPhone',
    };
    const err = Object.assign(new Error("[saveInspectionOffline] save failed: timeout"), {
      name: "IdbSaveError",
      code: "timeout",
      operationName: "saveInspectionOffline",
      cause: diag,
    });
    logError(err, { scope: "InspectionForm.performSave" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    const ctxArg = lastCall?.[1] as Record<string, unknown>;
    expect(ctxArg).toEqual(
      expect.objectContaining({
        scope: "InspectionForm.performSave",
        code: "timeout",
        operationName: "saveInspectionOffline",
        store: 'inspections',
        probeMs: 12,
        opMs: 7993,
        elapsedMs: 8005,
        timeoutMs: 8000,
        breakerOpen: true,
        breakerFailureCount: 3,
        quotaBytes: 1_000_000_000,
        usageBytes: 250_000_000,
        usagePct: 25,
        persisted: true,
      }),
    );
  });

  it("Mode 14: caller-supplied extras win over diagnostic cause keys", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const err = Object.assign(new Error("[saveTrainingOffline] save failed: timeout"), {
      name: "IdbSaveError",
      code: "timeout",
      operationName: "saveTrainingOffline",
      cause: { store: 'trainings', elapsedMs: 8001 },
    });
    logError(err, {
      scope: "TrainingForm",
      extra: { store: 'overridden-by-caller' },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    const ctxArg = lastCall?.[1] as Record<string, unknown>;
    expect(ctxArg).toMatchObject({
      store: 'overridden-by-caller',
      elapsedMs: 8001,
    });
  });

  it("Mode 14: IdbSaveError without a cause still surfaces code + operationName as extras", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const err = Object.assign(new Error("[saveInspectionOffline] save failed: idb_unhealthy"), {
      name: "IdbSaveError",
      code: "idb_unhealthy",
      operationName: "saveInspectionOffline",
    });
    logError(err, { scope: "InspectionForm" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    const ctxArg = lastCall?.[1] as Record<string, unknown>;
    expect(ctxArg).toMatchObject({
      code: "idb_unhealthy",
      operationName: "saveInspectionOffline",
    });
  });

  it("IdbSaveError auto-classify: missing operationName falls back to 'unknown' in the fingerprint", async () => {
    captureExceptionMock.mockImplementation(() => {});
    const err = Object.assign(new Error("[??] save failed: quota_exceeded"), {
      name: "IdbSaveError",
      code: "quota_exceeded",
      // operationName intentionally omitted
    });
    logError(err);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(Object),
      expect.objectContaining({
        level: "warning",
        fingerprint: [
          "IdbSaveError",
          "quota_exceeded",
          "unknown",
          "{{default}}",
        ],
      }),
    );
  });

  it("Sprint 2 G: enriches every Sentry event with app_version + app_version_full extras", async () => {
    captureExceptionMock.mockImplementation(() => {});
    logError(new Error("boom"), { scope: "atomic-sync.syncInspection" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    const ctxArg = lastCall?.[1] as Record<string, unknown>;
    // We can't assert exact values (Vite's `define` plugin replaces
    // import.meta.env at build time, not test time, so APP_VERSION is
    // 'unknown' in vitest). The contract we need is just that the keys
    // are present and string-valued so Sentry can index them.
    expect(ctxArg).toEqual(
      expect.objectContaining({
        app_version: expect.any(String),
        app_version_full: expect.any(String),
      }),
    );
  });

  it("Sprint 2 G: caller-supplied extras override the auto-enriched app_version keys", async () => {
    captureExceptionMock.mockImplementation(() => {});
    logError(new Error("boom"), {
      scope: "manual-override",
      extra: { app_version: "caller-wins" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lastCall = captureExceptionMock.mock.calls.at(-1) as unknown[] | undefined;
    const ctxArg = lastCall?.[1] as Record<string, unknown>;
    expect(ctxArg).toMatchObject({ app_version: "caller-wins" });
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
