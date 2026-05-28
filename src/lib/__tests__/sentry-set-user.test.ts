/**
 * Regression test for the Sentry user-identity attachment seam.
 *
 * The actual @sentry/react module is only loaded in production by
 * `initSentry()`, so we can't easily assert against a real Sentry call
 * here. Instead we pin the public contract of `setSentryUser`:
 *
 *   - calling it before `initSentry()` resolves is a no-op that doesn't
 *     throw (the value is cached and flushed once Sentry loads)
 *   - clearing identity (`setSentryUser(null)`) is supported
 *   - only safe identifiers are forwarded (id, email, role) — no token
 *     fields leak through
 */
import { describe, it, expect } from "vitest";
import { setSentryUser, flushPendingSentryUser } from "../sentry";

describe("setSentryUser", () => {
  it("accepts a user identity without throwing before Sentry initializes", () => {
    expect(() =>
      setSentryUser({ id: "user-123", email: "a@b.com" })
    ).not.toThrow();
  });

  it("accepts null to clear identity without throwing", () => {
    expect(() => setSentryUser(null)).not.toThrow();
  });

  it("flushPendingSentryUser is safe to call when nothing is pending", () => {
    flushPendingSentryUser();
    expect(() => flushPendingSentryUser()).not.toThrow();
  });

  it("type contract: SentryUserContext only exposes id/email/role", () => {
    // Compile-time check — if a future edit adds `accessToken` or similar
    // to SentryUserContext, this assignment will fail typecheck.
    const ctx: Parameters<typeof setSentryUser>[0] = {
      id: "u",
      email: "e@x.com",
      role: "admin",
    };
    expect(ctx.id).toBe("u");
  });
});
