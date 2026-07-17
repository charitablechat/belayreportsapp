/**
 * Mode 7C — Tests for `getLocallyValidCachedUser`.
 *
 * Background: when the supabase REST endpoint is unreachable
 * (`Failed to fetch` for the post-online recovery window), `performSync`'s
 * `ensureValidSession()` either hangs past the 8s `Auth timeout` or
 * resolves to null. Pre-Mode-7C, both branches caused a silent no-op:
 * autosync returned without ever calling `getUnsynced*`, so the dirty
 * record sat in IDB until the network unblocked refresh — typically
 * minutes after the network actually returned.
 *
 * `getLocallyValidCachedUser(skewSeconds)` reads the supabase session
 * from localStorage and returns the cached user only when the embedded
 * JWT has not yet locally expired (with `skewSeconds` pessimism).
 * Refuses placeholder/synthetic tokens (would 401 immediately on the
 * actual sync POST and just churn the retry loop).
 *
 * Tests pin:
 *   - Returns null when there's no cached session
 *   - Returns null when the JWT is expired (or near expiry within skew)
 *   - Returns the user when the JWT is comfortably in the future
 *   - Refuses placeholder tokens
 *   - Refuses non-JWT-shaped tokens
 *   - Tolerates malformed JSON / missing fields without throwing
 *   - Honors a custom `skewSeconds` argument
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client module BEFORE importing cached-auth.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn(),
      getUser: vi.fn(),
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}));

vi.mock("@/lib/offline-auth", () => ({
  saveUserMapping: vi.fn(() => Promise.resolve()),
  clearOfflineAuth: vi.fn(),
  readSyntheticSession: vi.fn(() => null),
  clearSyntheticSession: vi.fn(),
}));

import { getLocallyValidCachedUser } from "../cached-auth";

const PROJECT_REF =
  (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ||
  "ssgzcgvygnsrqalisshx";
const SESSION_KEY = `sb-${PROJECT_REF}-auth-token`;

/**
 * A minimal valid-shape JWT: three base64url segments separated by `.`.
 * `looksLikeJwt` only checks structure, not signature, so any well-formed
 * three-segment string is accepted. We use a stable fixture so unrelated
 * test changes don't shift the cache surface area.
 */
const VALID_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.signature-stub";

function setSession(payload: unknown): void {
  // Stamping `null` clears; otherwise persist as JSON.
  if (payload === null) {
    window.localStorage.removeItem(SESSION_KEY);
  } else {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }
}

function makeSession(opts: {
  expiresInSec: number;
  user?: { id: string; email?: string };
  accessToken?: string;
}): Record<string, unknown> {
  return {
    access_token: opts.accessToken ?? VALID_JWT,
    expires_at: Math.floor(Date.now() / 1000) + opts.expiresInSec,
    user: opts.user ?? { id: "user-7c-test", email: "user@example.com" },
  };
}

describe("getLocallyValidCachedUser — Mode 7C auth-cache fallback", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no cached session is present", () => {
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when the localStorage entry is malformed JSON", () => {
    window.localStorage.setItem(SESSION_KEY, "{not-json");
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when there's no `user` field on the session", () => {
    setSession({ access_token: VALID_JWT, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when there's no `access_token` field on the session", () => {
    setSession({ expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u" } });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when there's no `expires_at` field on the session", () => {
    // Defensive: refuse to assume infinite validity. A missing expires_at
    // is treated as expired so we never silently send a token whose
    // freshness we cannot verify locally.
    setSession({ access_token: VALID_JWT, user: { id: "u" } });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when `expires_at` is not a number", () => {
    setSession({
      access_token: VALID_JWT,
      expires_at: "2025-12-31T23:59:59Z" as unknown as number,
      user: { id: "u" },
    });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns the user when the JWT is comfortably in the future", () => {
    setSession(makeSession({ expiresInSec: 3600 })); // 1h ahead
    const user = getLocallyValidCachedUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe("user-7c-test");
  });

  it("returns null when the JWT is already expired", () => {
    setSession(makeSession({ expiresInSec: -1 }));
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns null when the JWT expires within the default 60s skew window", () => {
    // Skew is pessimistic: within `skewSeconds` of expiry, treat as expired.
    setSession(makeSession({ expiresInSec: 30 })); // 30s ahead, < 60s skew
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("returns the user when the JWT expires just past the default 60s skew", () => {
    setSession(makeSession({ expiresInSec: 90 })); // 90s ahead, > 60s skew
    const user = getLocallyValidCachedUser();
    expect(user).not.toBeNull();
  });

  it("honors a custom `skewSeconds` argument — wider skew rejects tighter freshness", () => {
    setSession(makeSession({ expiresInSec: 90 })); // 90s ahead
    expect(getLocallyValidCachedUser(60)).not.toBeNull();   // 90 > 60 ✓
    expect(getLocallyValidCachedUser(120)).toBeNull();      // 90 < 120 ✗
  });

  it("honors a custom `skewSeconds=0` — strict expiry boundary", () => {
    // With zero skew the boundary is exactly `expires_at > now`. A token
    // with 1s left is valid; an expired token (negative remaining) is not.
    setSession(makeSession({ expiresInSec: 1 }));
    expect(getLocallyValidCachedUser(0)).not.toBeNull();

    setSession(makeSession({ expiresInSec: -1 }));
    expect(getLocallyValidCachedUser(0)).toBeNull();
  });

  it("refuses placeholder tokens — never surfaces a synthetic-session token to network callers", () => {
    // The placeholder pattern is documented in
    // `src/lib/synthetic-session-guard.ts` as `'sg-placeholder.…'`.
    // Returning a placeholder would 401 immediately on the actual sync
    // POST and just churn the retry loop, defeating the fallback.
    setSession({
      access_token: "sg-placeholder.do-not-send",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "u" },
    });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("refuses non-JWT-shaped tokens — defensive against future schema drift", () => {
    // A real supabase JWT has three base64url segments. If the entry is
    // shaped like a string but isn't a JWT (e.g. opaque token from a
    // misconfigured custom auth flow), refuse to surface it.
    setSession({
      access_token: "opaque-token-no-dots",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "u" },
    });
    expect(getLocallyValidCachedUser()).toBeNull();
  });

  it("does not throw on a localStorage stub that itself throws", () => {
    // Some embedded webviews (legacy iOS Cordova, certain Chromebook
    // kiosk modes) raise on getItem. Fallback should swallow and return
    // null so autosync degrades to "skip sync" rather than crashing.
    const original = window.localStorage.getItem;
    window.localStorage.getItem = (() => {
      throw new Error("storage disabled");
    }) as typeof original;
    try {
      expect(getLocallyValidCachedUser()).toBeNull();
    } finally {
      window.localStorage.getItem = original;
    }
  });
});
