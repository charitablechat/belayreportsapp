/**
 * Contract tests for Sentry's `beforeSend` classifier.
 *
 * Two surfaces under test:
 *
 * 1. `classifyRecoverableSentryEvent(name, message)` — the pure
 *    pattern matcher. Adding a new (name, message) pair to the
 *    classifier should pin its expected downgrade directive here so
 *    a regression (typo in message string, accidentally generalised
 *    match, etc.) fails the test instead of silently swallowing real
 *    errors in production.
 *
 * 2. `runBeforeSend(event, hint)` — the wrapper that wires the
 *    classifier into Sentry's `beforeSend`. Pins the "caller wins"
 *    contract: events with an explicit non-`error` level set by the
 *    call-site classifier in `log-error.ts` (e.g. IdbSaveError) MUST
 *    NOT be touched by `beforeSend` — otherwise we'd double-classify
 *    and lose the per-call-site fingerprint detail.
 */

import { describe, it, expect } from "vitest";
import {
  classifyRecoverableSentryEvent,
  runBeforeSend,
} from "../sentry";

describe("classifyRecoverableSentryEvent", () => {
  it("downgrades AbortError with exact 'Lock was stolen by another request' message", () => {
    const result = classifyRecoverableSentryEvent(
      "AbortError",
      "Lock was stolen by another request",
    );
    expect(result).toEqual({
      level: "warning",
      fingerprint: ["AbortError", "lock-stolen", "{{default}}"],
    });
  });

  it("downgrades StorageUnknownError with exact 'Load failed' message", () => {
    const result = classifyRecoverableSentryEvent(
      "StorageUnknownError",
      "Load failed",
    );
    expect(result).toEqual({
      level: "warning",
      fingerprint: ["StorageUnknownError", "load-failed", "{{default}}"],
    });
  });

  it("does NOT match a different message on the same error name (defensive)", () => {
    expect(
      classifyRecoverableSentryEvent("AbortError", "The user aborted"),
    ).toBeNull();
    expect(
      classifyRecoverableSentryEvent("StorageUnknownError", "Network error"),
    ).toBeNull();
  });

  it("does NOT match a different error name with the same message", () => {
    expect(
      classifyRecoverableSentryEvent(
        "DOMException",
        "Lock was stolen by another request",
      ),
    ).toBeNull();
    expect(
      classifyRecoverableSentryEvent("Error", "Load failed"),
    ).toBeNull();
  });

  it("does NOT match if the message is a substring (must be exact)", () => {
    // Future SDK message changes should surface as fresh errors,
    // not be silently swallowed.
    expect(
      classifyRecoverableSentryEvent(
        "AbortError",
        "Lock was stolen by another request (custom suffix)",
      ),
    ).toBeNull();
    expect(
      classifyRecoverableSentryEvent("StorageUnknownError", "Load failed (404)"),
    ).toBeNull();
  });

  it("returns null for unrecognised errors", () => {
    expect(classifyRecoverableSentryEvent("TypeError", "x is null")).toBeNull();
    expect(classifyRecoverableSentryEvent("", "")).toBeNull();
  });
});

describe("runBeforeSend", () => {
  it("downgrades a matching default-level event", () => {
    const event = { level: "error" as const };
    const hint = {
      originalException: Object.assign(new Error("Lock was stolen by another request"), {
        name: "AbortError",
      }),
    };
    const result = runBeforeSend(event, hint);
    expect(result.level).toBe("warning");
    expect(result.fingerprint).toEqual([
      "AbortError",
      "lock-stolen",
      "{{default}}",
    ]);
  });

  it("downgrades a matching event with no level field (defaults to error)", () => {
    const event = {} as { level?: string; fingerprint?: string[] };
    const err = new Error("Load failed");
    Object.defineProperty(err, "name", { value: "StorageUnknownError" });
    const result = runBeforeSend(event, { originalException: err });
    expect(result.level).toBe("warning");
    expect(result.fingerprint).toEqual([
      "StorageUnknownError",
      "load-failed",
      "{{default}}",
    ]);
  });

  it("preserves an explicit caller-supplied warning level (caller wins)", () => {
    // Mode 13 / log-error.ts already classified this event; beforeSend
    // must not double-classify or it would clobber the call-site's
    // per-(code, operation) fingerprint with the generic catch-all
    // pattern. This is what keeps IdbSaveError grouping fine-grained.
    const event = {
      level: "warning" as const,
      fingerprint: ["IdbSaveError", "TIMEOUT", "save-inspection", "{{default}}"],
    };
    const hint = {
      originalException: Object.assign(new Error("Lock was stolen by another request"), {
        name: "AbortError",
      }),
    };
    const result = runBeforeSend(event, hint);
    expect(result.level).toBe("warning");
    expect(result.fingerprint).toEqual([
      "IdbSaveError",
      "TIMEOUT",
      "save-inspection",
      "{{default}}",
    ]);
  });

  it("preserves an explicit caller-supplied fatal level", () => {
    const event = { level: "fatal" as const };
    const hint = {
      originalException: Object.assign(new Error("Load failed"), {
        name: "StorageUnknownError",
      }),
    };
    const result = runBeforeSend(event, hint);
    expect(result.level).toBe("fatal");
  });

  it("returns the event unchanged for unrecognised errors", () => {
    const event = { level: "error" as const };
    const hint = { originalException: new TypeError("x is null") };
    const result = runBeforeSend(event, hint);
    expect(result).toBe(event);
    expect(result.level).toBe("error");
    expect(result.fingerprint).toBeUndefined();
  });

  it("handles missing hint without throwing", () => {
    const event = { level: "error" as const };
    expect(() => runBeforeSend(event)).not.toThrow();
    const result = runBeforeSend(event);
    expect(result.level).toBe("error");
  });

  it("handles missing originalException without throwing", () => {
    const event = { level: "error" as const };
    const result = runBeforeSend(event, {});
    expect(result.level).toBe("error");
  });

  it("handles non-Error originalException values defensively", () => {
    const event = { level: "error" as const };
    expect(() => runBeforeSend(event, { originalException: "string" })).not.toThrow();
    expect(() => runBeforeSend(event, { originalException: null })).not.toThrow();
    expect(() => runBeforeSend(event, { originalException: undefined })).not.toThrow();
    expect(() => runBeforeSend(event, { originalException: 42 })).not.toThrow();
  });

  it("handles an originalException with non-string name/message defensively", () => {
    const event = { level: "error" as const };
    const exotic = { name: 42, message: { weird: true } };
    expect(() => runBeforeSend(event, { originalException: exotic })).not.toThrow();
    const result = runBeforeSend(event, { originalException: exotic });
    expect(result.level).toBe("error");
  });
});
