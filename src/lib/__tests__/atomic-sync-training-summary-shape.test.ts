/**
 * Regression: the atomic-sync training_summary step MUST whitelist columns
 * before upserting (same contract as the form-saver path), otherwise
 * `field_timestamps` (and other client-only fields) leak through and
 * 400 the PostgREST upsert with "Could not find the 'field_timestamps'
 * column of 'training_summary' in the schema cache", aborting the whole
 * atomic transaction at Step 7.
 *
 * A full executeTransaction integration test would require mocking the
 * entire offline-storage + reconcile + quarantine surface; instead this
 * test does two cheap, robust things:
 *
 *   1. Asserts the shared whitelist sanitizer behaves as advertised
 *      (mirrors `training-summary-sanitizer.test.ts`, kept here too so
 *      a future refactor that splits the file still trips the alarm).
 *   2. Asserts the atomic-sync module's source contains the sanitizer
 *      import + call near the `training_summary` step — a regression
 *      tripwire if someone reverts to the raw spread + stripLocalOnlyFields
 *      path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sanitizeTrainingSummaryForRemote } from "@/lib/form-savers/trainingSaver";

describe("atomic-sync training_summary payload shape", () => {
  it("strips field_timestamps / updated_at / synced_at / last_modified_by / dirty", () => {
    const out = sanitizeTrainingSummaryForRemote({
      id: "s",
      training_id: "t",
      observations: "o",
      recommendations: "r",
      person_submitting: "p",
      submission_date: "2026-01-02",
      created_at: "2026-01-01T00:00:00Z",
      field_timestamps: { observations: "2026-01-02T00:00:00Z" },
      updated_at: "2026-01-02T00:00:00Z",
      synced_at: "2026-01-02T00:00:00Z",
      last_modified_by: "u",
      dirty: true,
    });
    expect("field_timestamps" in out).toBe(false);
    expect("updated_at" in out).toBe(false);
    expect("synced_at" in out).toBe(false);
    expect("last_modified_by" in out).toBe(false);
    expect("dirty" in out).toBe(false);
    // Real columns must survive.
    expect(out).toMatchObject({
      id: "s",
      training_id: "t",
      observations: "o",
      recommendations: "r",
      person_submitting: "p",
      submission_date: "2026-01-02",
    });
  });

  it("atomic-sync-manager.ts wires the whitelist sanitizer into the training_summary step", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(here, "..", "atomic-sync-manager.ts"),
      "utf8",
    );
    // Tripwire: revert to the raw `{ ...summary, id, submission_date }`
    // shape + only `stripLocalOnlyFieldsArray` would silently re-introduce
    // the 400. Catch it at the source level.
    expect(source).toMatch(
      /import\s*\{\s*sanitizeTrainingSummaryForRemote\s*\}\s*from\s*["']\.\/form-savers\/trainingSaver["']/,
    );
    // The sanitizer must be invoked inside the training_summary branch.
    const summaryBlock = source.match(
      /if\s*\(summary\)\s*\{[\s\S]{0,8000}?table:\s*['"]training_summary['"][\s\S]{0,800}?\}\s*\)\s*;\s*\}/,
    );
    expect(summaryBlock, "training_summary branch should exist").toBeTruthy();
    expect(summaryBlock![0]).toMatch(/sanitizeTrainingSummaryForRemote\s*\(/);
  });
});
