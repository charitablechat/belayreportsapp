/**
 * Slice 5A — Restore-handler CHARACTERIZATION tests.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ CHARACTERIZATION ONLY. None of these tests prove safety. They prove  │
 * │ what the code does TODAY so Slice 5B / 5C do not silently regress    │
 * │ the one runtime behaviour Slice 5A actually changes: sanitized       │
 * │ logging at the four restore-handler error sites.                     │
 * │                                                                      │
 * │ This file deliberately does NOT assert that any of the following     │
 * │ data-loss boundaries are enforced — because they are not enforced    │
 * │ today. They are tracked as skipped placeholders for Slice 5B/5C:     │
 * │   • no confirmation dialog before restore                            │
 * │   • stale snapshots can overwrite newer local data                   │
 * │   • completed / locked reports can be overwritten                    │
 * │   • envelope vs parent identity mismatch is not rejected             │
 * │   • malformed snapshot shape is not fully rejected                   │
 * │   • partial local restore writes are not rolled back                 │
 * │   • client-side role / ownership checks are absent on admin surfaces │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Scope chosen deliberately small: a render-based test of
 * DataRecoveryTool would require mocking ~10 modules (offline-storage,
 * cloud-backup, local-backup-ledger, admin-edit-snapshot, restore-integrity,
 * restore-lock, supabase client, sonner, plus IDB) and would risk creating
 * the very false sense of safety this slice was revised to avoid. Instead
 * we pin the actual edits made in 5A — the four call sites — via source
 * inspection. Combined with the dense helper coverage in
 * `src/lib/recovery/__tests__/sanitize-recovery-log-metadata.test.ts`,
 * this gives a stable signal that the sanitization wiring is in place
 * without overclaiming.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'DataRecoveryTool.tsx'),
  'utf8',
);

const RESTORE_FAILED_TAGS = [
  '[Data Recovery] Restore failed:',
  '[Cloud Recovery] Restore failed:',
  '[All User Snapshots] Restore failed:',
  '[Admin Edit History] Restore failed:',
] as const;

describe('DataRecoveryTool — restore-handler log sanitization wiring (Slice 5A)', () => {
  it('imports the sanitization helpers from the recovery module', () => {
    expect(SOURCE).toMatch(
      /from\s+["']@\/lib\/recovery\/restore-decision["']/,
    );
    expect(SOURCE).toContain('sanitizeRecoveryLogMetadata');
    expect(SOURCE).toContain('sanitizeRecoveryErrorForLog');
  });

  for (const tag of RESTORE_FAILED_TAGS) {
    it(`logs "${tag}" with sanitized error (never the raw error object)`, () => {
      // Locate the console.error call for this tag and inspect the next
      // ~12 lines to confirm the sanitized error helper is used and the
      // raw `error` identifier is NOT passed as a positional argument.
      const idx = SOURCE.indexOf(tag);
      expect(idx, `tag not found: ${tag}`).toBeGreaterThan(-1);
      const window = SOURCE.slice(idx, idx + 600);
      expect(window).toContain('sanitizeRecoveryErrorForLog(error)');
      // Defensive: the old "console.error('…', error)" shape must be gone.
      expect(window).not.toMatch(/Restore failed:['"]\s*,\s*error\s*\)/);
    });
  }

  it('local handler passes sanitized snapshot metadata alongside the error', () => {
    const idx = SOURCE.indexOf('[Data Recovery] Restore failed:');
    const window = SOURCE.slice(idx, idx + 600);
    expect(window).toContain('sanitizeRecoveryLogMetadata(');
  });

  it('cloud handler invokes the metadata sanitizer (without snapshot body access in catch)', () => {
    // Slice 5B: the tag now appears twice in the cloud handler — once in the
    // pre-lock fetch catch, once in the in-lock catch. Both must pass
    // sanitized metadata only. Walk each occurrence and scan its catch body
    // (bounded by the surrounding toast.error call, ~250 chars) for the
    // sanitizer call and for the absence of `snapshot_data` reads.
    const tag = '[Cloud Recovery] Restore failed:';
    let cursor = 0;
    let occurrences = 0;
    while (true) {
      const idx = SOURCE.indexOf(tag, cursor);
      if (idx === -1) break;
      occurrences++;
      const w = SOURCE.slice(idx, idx + 250);
      expect(w).toContain('sanitizeRecoveryLogMetadata(');
      // The catch deliberately does NOT reach into snapshot_data; the
      // fetched `full` is scoped to the pre-lock try in DataRecoveryTool.tsx.
      expect(w).not.toContain('snapshot_data');
      cursor = idx + tag.length;
    }
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });
});

describe('DataRecoveryTool — GAPS tracked for Slice 5C / 5D (intentionally not enforced in 5A/5B)', () => {
  // Slice 5B closes these gaps for Local + Cloud restore (see
  // `data-recovery-restore-enforcement.test.ts`):
  //   • explicit confirmation before any IDB mutation
  //   • stale-snapshot guard (with `unknown` freshness treated as stale)
  //   • envelope + parent identity mismatch rejection
  //   • malformed snapshot shape rejection (incl. unknown child keys)
  //   • completion-lock guard (non-admin hard block, admin override)
  // Remaining gaps:
  it.todo('GAP: partial restore failure mid-loop is rolled back rather than left half-applied — tracked in Slice 5D');
  it.todo('GAP: admin server restores enforce a client-side role and ownership check before RPC — tracked in Slice 5C');
});
