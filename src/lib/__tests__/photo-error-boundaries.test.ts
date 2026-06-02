/**
 * Slice 3: Boundary contract tests for `classifyPhotoError`.
 *
 * Locks the photo-classifier policy:
 *   - permanent (bump retryCount, eventually dead-letter):
 *       401, 403, 413, 415, 422, raw unknown errors, missing-status defaults
 *   - transient (backoff, no retryCount bump):
 *       408, 425, 429, 5xx, generic 409 (no duplicate body), AbortError name,
 *       TypeError + 'fetch', message containing network / failed to fetch /
 *       load failed / timeout
 *   - success-equivalent (mark uploaded):
 *       Postgres 23505, storage 409 + duplicate body, storage 400 +
 *       resource-already-exists body
 *
 * String-status coercion (`status: "500"`) and missing-status defaults
 * (`{ message: '…' }`) are pinned so a future refactor can't accidentally
 * route a 5xx string into the permanent bucket or treat a bare message as
 * transient.
 *
 * Source-of-truth `classifyPhotoError` body is read-only in this slice.
 * Existing coverage NOT duplicated: photo-retry-buckets.test.ts (bucketing),
 * mode5-desktop-retry-classifier-gate.test.ts (retry-loop gating).
 */

import { describe, it, expect } from "vitest";

import { classifyPhotoError } from "../sync-manager";

// -----------------------------------------------------------------------------
// Permanent — 4xx that indicate the request is bad and won't succeed on retry.
// -----------------------------------------------------------------------------

describe("classifyPhotoError → permanent (4xx)", () => {
  const cases: Array<[string, { status?: number; message?: string; name?: string }]> = [
    ["401 Unauthorized", { status: 401, message: "JWT expired" }],
    ["403 Forbidden / RLS", { status: 403, message: "permission denied" }],
    [
      "403 row-level security",
      {
        status: 403,
        message:
          'new row violates row-level security policy for table "photos"',
      },
    ],
    ["413 Payload Too Large", { status: 413, message: "Payload Too Large" }],
    [
      "415 Unsupported Media Type",
      { status: 415, message: "Unsupported Media Type" },
    ],
    [
      "422 Unprocessable Entity",
      { status: 422, message: "Unprocessable Entity" },
    ],
    [
      "400 schema mismatch (no duplicate marker)",
      { status: 400, message: "invalid input syntax for type uuid" },
    ],
    [
      "404 Not Found (bucket / object missing)",
      { status: 404, message: "The resource was not found" },
    ],
  ];

  for (const [label, err] of cases) {
    it(`${label} → permanent`, () => {
      expect(classifyPhotoError(err).kind).toBe("permanent");
    });
  }

  it("preserves the original message on the returned bucket", () => {
    const out = classifyPhotoError({ status: 401, message: "JWT expired" });
    expect(out.message).toBe("JWT expired");
  });
});

// -----------------------------------------------------------------------------
// Transient — 5xx, retryable 4xx (408/425/429), generic 409, network shapes.
// -----------------------------------------------------------------------------

describe("classifyPhotoError → transient (5xx, retryable, network)", () => {
  const cases: Array<[string, { status?: number; message?: string; name?: string }]> = [
    ["408 Request Timeout", { status: 408, message: "Request Timeout" }],
    ["425 Too Early", { status: 425, message: "Too Early" }],
    ["429 Too Many Requests", { status: 429, message: "Too Many Requests" }],
    [
      "409 Conflict without duplicate body (version mismatch)",
      { status: 409, message: "Conflict" },
    ],
    ["500 Internal Server Error", { status: 500, message: "boom" }],
    ["502 Bad Gateway", { status: 502, message: "Bad Gateway" }],
    ["503 Service Unavailable", { status: 503, message: "Service Unavailable" }],
    ["504 Gateway Timeout", { status: 504, message: "Gateway Timeout" }],
    ["AbortError by name", { name: "AbortError", message: "aborted" }],
    [
      "TypeError + fetch (Chromium offline)",
      { name: "TypeError", message: "Failed to fetch" },
    ],
    ["message: network", { message: "network error" }],
    ["message: failed to fetch", { message: "Failed to fetch" }],
    ["message: load failed (Safari)", { message: "Load failed" }],
    ["message: timeout", { message: "request timeout" }],
    ["message: timed out", { message: "operation timed out" }],
  ];

  for (const [label, err] of cases) {
    it(`${label} → transient`, () => {
      expect(classifyPhotoError(err).kind).toBe("transient");
    });
  }

  it("coerces string status ('500') to numeric and still classifies transient", () => {
    expect(classifyPhotoError({ status: "500", message: "boom" }).kind).toBe(
      "transient",
    );
    expect(classifyPhotoError({ statusCode: "502", message: "x" }).kind).toBe(
      "transient",
    );
    expect(classifyPhotoError({ httpStatus: "503", message: "x" }).kind).toBe(
      "transient",
    );
  });
});

// -----------------------------------------------------------------------------
// Success-equivalent — duplicates that mean the upload already landed.
// -----------------------------------------------------------------------------

describe("classifyPhotoError → success-equivalent (duplicates)", () => {
  it("Postgres 23505 → success-equivalent (regardless of status)", () => {
    expect(classifyPhotoError({ code: "23505", message: "boom" }).kind).toBe(
      "success-equivalent",
    );
  });

  it("'duplicate key' message → success-equivalent", () => {
    expect(
      classifyPhotoError({
        message: 'duplicate key value violates unique constraint "photos_pkey"',
      }).kind,
    ).toBe("success-equivalent");
  });

  it("Storage 409 + 'duplicate' body → success-equivalent", () => {
    expect(
      classifyPhotoError({ status: 409, message: "The resource already exists (duplicate)" })
        .kind,
    ).toBe("success-equivalent");
  });

  it("Storage 400 + 'resource already exists' body → success-equivalent (audit P2 boundary)", () => {
    // Some Supabase Storage paths return 400 instead of 409 with the same
    // duplicate body. Both must collapse to success-equivalent so a
    // successful upload is never dead-lettered.
    expect(
      classifyPhotoError({
        status: 400,
        message: "The resource already exists",
      }).kind,
    ).toBe("success-equivalent");
  });

  it("Storage 400 + 'duplicate' body → success-equivalent", () => {
    expect(
      classifyPhotoError({ status: 400, message: "Duplicate object" }).kind,
    ).toBe("success-equivalent");
  });

  it("generic 409 WITHOUT a duplicate body stays transient (not success)", () => {
    // Lock the boundary: a bare 409 is NOT a duplicate; it's a generic
    // conflict that should be retried, not silently marked uploaded.
    expect(classifyPhotoError({ status: 409, message: "Conflict" }).kind).toBe(
      "transient",
    );
  });

  it("generic 400 WITHOUT a duplicate body stays permanent (not success)", () => {
    expect(
      classifyPhotoError({ status: 400, message: "Bad Request" }).kind,
    ).toBe("permanent");
  });
});

// -----------------------------------------------------------------------------
// Defaults — missing status, raw strings, unparseable inputs default HARD
// (permanent), so a misclassification cannot silently skip the dead-letter
// path. "When in doubt, classify harder."
// -----------------------------------------------------------------------------

describe("classifyPhotoError → defaults to permanent on missing/unknown shapes", () => {
  it("raw error message with no status/code/name → permanent", () => {
    expect(classifyPhotoError({ message: "something broke" }).kind).toBe(
      "permanent",
    );
  });

  it("null → permanent (does not throw)", () => {
    let out: ReturnType<typeof classifyPhotoError> | undefined;
    expect(() => {
      out = classifyPhotoError(null);
    }).not.toThrow();
    expect(out?.kind).toBe("permanent");
  });

  it("undefined → permanent (does not throw)", () => {
    expect(() => classifyPhotoError(undefined)).not.toThrow();
    expect(classifyPhotoError(undefined).kind).toBe("permanent");
  });

  it("empty object → permanent", () => {
    expect(classifyPhotoError({}).kind).toBe("permanent");
  });

  it("plain string → permanent (caller passed a non-object)", () => {
    expect(classifyPhotoError("oops" as unknown).kind).toBe("permanent");
  });

  it("number → permanent (no throw)", () => {
    expect(() => classifyPhotoError(42 as unknown)).not.toThrow();
    expect(classifyPhotoError(42 as unknown).kind).toBe("permanent");
  });
});

// -----------------------------------------------------------------------------
// Cross-classifier invariants: hard-failure inputs that the *atomic-sync*
// classifier treats as 'error' must NOT be misclassified as transient here
// either — locks the "no soft downgrade for data-loss-class errors" rule
// across the photo pipeline.
// -----------------------------------------------------------------------------

describe("photo classifier never downgrades hard auth/RLS/schema failures to transient", () => {
  const hardCases: Array<{ status?: number; message: string }> = [
    { status: 401, message: "JWT expired" },
    { status: 401, message: "invalid JWT" },
    { status: 403, message: "permission denied for table photos" },
    {
      status: 403,
      message: 'new row violates row-level security policy for table "photos"',
    },
    { status: 400, message: "invalid input syntax for type uuid" },
    { message: "schema cache: relation \"photos\" does not exist" },
  ];

  for (const err of hardCases) {
    it(`${err.status ?? "no-status"} '${err.message}' → permanent (not transient, not success)`, () => {
      const out = classifyPhotoError(err);
      expect(out.kind).toBe("permanent");
    });
  }
});
