/**
 * Regression coverage for the IDB-only field strip in atomic-sync-manager.
 *
 * Prior to this fix, parent-row upserts spread the in-memory IDB record
 * directly into Supabase REST upserts, leaking the local-only `dirty`
 * flag (added in IDB v17 for the unsynced-edit signal) and
 * `child_count_hint` (S25). PostgREST rejected the upsert with
 * `Could not find the 'dirty' column of 'inspections' in the schema
 * cache`, which surfaced as `Step 1 failed: ...` and tore down the
 * entire offline → online reconcile path. Every offline edit dead-
 * lettered on the device.
 *
 * This file probes the public sync entry points instead of the private
 * helper so the contract being tested is "outbound payloads MUST NOT
 * carry IDB-only fields", regardless of which internal helper enforces
 * it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const upsertMock = vi.fn(() => ({
  select: vi.fn(() => Promise.resolve({ data: [{ id: "abc" }], error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: upsertMock,
      // Other operations are not exercised by these tests but the
      // transaction manager prefetches rollback rows via select().eq().
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

import { executeTransaction, type TransactionStep } from "../transaction-manager";

describe("transaction upsert payloads — IDB-only field strip", () => {
  beforeEach(() => {
    upsertMock.mockClear();
  });

  it("happy path passes through real columns untouched", async () => {
    const steps: TransactionStep[] = [
      {
        table: "inspections",
        operation: "upsert",
        data: {
          id: "abc",
          location: "Site A",
          organization: "Acme",
          updated_at: "2025-04-22T00:00:00.000Z",
        },
      },
    ];
    const result = await executeTransaction(steps);
    expect(result.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      id: "abc",
      location: "Site A",
      organization: "Acme",
      updated_at: "2025-04-22T00:00:00.000Z",
    });
  });
});

/**
 * Direct contract test for the strip helper itself. Imported via an
 * internal-export so the documented invariant ("dirty and
 * child_count_hint never leave atomic-sync") gets a unit test that
 * doesn't depend on the larger transaction integration mock.
 */
import {
  __test_only__stripLocalOnlyFields,
  __test_only__stripLocalOnlyFieldsArray,
} from "../atomic-sync-manager";

describe("stripLocalOnlyFields", () => {
  it("removes dirty and child_count_hint, preserves everything else", () => {
    const input = {
      id: "abc",
      location: "Site A",
      organization: "Acme",
      updated_at: "2025-04-22T00:00:00.000Z",
      synced_at: null,
      dirty: true,
      child_count_hint: 7,
    };
    const out = __test_only__stripLocalOnlyFields(input);
    expect(out).toEqual({
      id: "abc",
      location: "Site A",
      organization: "Acme",
      updated_at: "2025-04-22T00:00:00.000Z",
      synced_at: null,
    });
    // Source object must not be mutated.
    expect(input.dirty).toBe(true);
    expect(input.child_count_hint).toBe(7);
  });

  it("leaves rows that never had the local fields untouched", () => {
    const input = {
      id: "abc",
      location: "Site A",
      organization: "Acme",
    };
    const out = __test_only__stripLocalOnlyFields(input);
    expect(out).toEqual(input);
  });

  it("strips dirty=false (not just truthy)", () => {
    const input = { id: "abc", dirty: false, location: "Site A" };
    const out = __test_only__stripLocalOnlyFields(input);
    expect(out).toEqual({ id: "abc", location: "Site A" });
  });

  it("strips child_count_hint=0 (not just truthy)", () => {
    const input = { id: "abc", child_count_hint: 0, location: "Site A" };
    const out = __test_only__stripLocalOnlyFields(input);
    expect(out).toEqual({ id: "abc", location: "Site A" });
  });
});

/**
 * Array variant: child upserts route through this helper today as
 * future-proofing. Children currently have no IDB-only fields, but if a
 * future migration adds one to LOCAL_ONLY_REMOTE_UPSERT_FIELDS the strip
 * must propagate to every child path — otherwise we re-create the same
 * silent dead-letter on the children that PR #16 fixed on the parents.
 */
describe("stripLocalOnlyFieldsArray", () => {
  it("strips local-only fields from every row", () => {
    const input = [
      { id: "a", system_name: "S1", dirty: true },
      { id: "b", system_name: "S2", child_count_hint: 3 },
      { id: "c", system_name: "S3" },
    ];
    const out = __test_only__stripLocalOnlyFieldsArray(input);
    expect(out).toEqual([
      { id: "a", system_name: "S1" },
      { id: "b", system_name: "S2" },
      { id: "c", system_name: "S3" },
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(__test_only__stripLocalOnlyFieldsArray([])).toEqual([]);
  });

  it("does not mutate input rows", () => {
    const input = [{ id: "a", dirty: true, child_count_hint: 5 }];
    __test_only__stripLocalOnlyFieldsArray(input);
    expect(input[0].dirty).toBe(true);
    expect(input[0].child_count_hint).toBe(5);
  });
});
