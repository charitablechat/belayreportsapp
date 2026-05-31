/**
 * Regression: `sanitizeTrainingForRemote` must strip PostgREST embedded
 * relation blobs (`trainer`, `inspector`) attached by Dashboard /
 * SuperAdmin reads. If they survive into `.update(...)` on `trainings`,
 * PostgREST 400s with "Could not find the 'trainer' column of
 * 'trainings' in the schema cache" — see Sentry issue ROPEWORKS-A
 * "AbortError" breadcrumbs (real cause was the 400, the AbortError is
 * downstream noise).
 *
 * Schema reality (verified):
 *   trainings has `trainer_of_record` (text). It does NOT have a
 *   `trainer` column. The `trainer:profiles!...` you see in selects is
 *   a JOIN ALIAS — read-only. Same for `inspector:profiles!...`.
 */
import { describe, it, expect } from "vitest";
import { sanitizeTrainingForRemote } from "@/lib/form-savers/trainingSaver";

describe("sanitizeTrainingForRemote", () => {
  it("strips IDB-only fields (id, created_at, child_count_hint, dirty)", () => {
    const out = sanitizeTrainingForRemote({
      id: "t-1",
      created_at: "2026-01-01T00:00:00Z",
      child_count_hint: 5,
      dirty: true,
      organization: "Acme",
      trainer_of_record: "Pat T.",
    });
    expect("id" in out).toBe(false);
    expect("created_at" in out).toBe(false);
    expect("child_count_hint" in out).toBe(false);
    expect("dirty" in out).toBe(false);
    expect(out.organization).toBe("Acme");
    expect(out.trainer_of_record).toBe("Pat T.");
  });

  it("strips PostgREST embedded relation blobs (`trainer`, `inspector`)", () => {
    const out = sanitizeTrainingForRemote({
      id: "t-1",
      organization: "Acme",
      trainer_of_record: "Pat T.",
      // Read-time join aliases — NOT real columns. Must not be sent back.
      trainer: { first_name: "Pat", last_name: "T.", avatar_url: null },
      inspector: { first_name: "Pat", last_name: "T.", avatar_url: null },
    });
    expect("trainer" in out).toBe(false);
    expect("inspector" in out).toBe(false);
    // Real column survives.
    expect(out.trainer_of_record).toBe("Pat T.");
    expect(out.organization).toBe("Acme");
  });

  it("preserves field_timestamps on trainings (the parent DOES have this column)", () => {
    // Unlike `training_summary` (where `field_timestamps` is client-only
    // and must be stripped), `trainings.field_timestamps` is a real
    // jsonb column used by the cross-device per-field merger. Make sure
    // we don't accidentally strip it here.
    const out = sanitizeTrainingForRemote({
      id: "t-1",
      organization: "Acme",
      field_timestamps: { organization: "2026-01-02T00:00:00Z" },
    });
    expect(out.field_timestamps).toEqual({
      organization: "2026-01-02T00:00:00Z",
    });
  });
});
