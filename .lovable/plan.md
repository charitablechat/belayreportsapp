

## Audit follow-ups — status check

Walking through each flagged item against current code.

### Restoration flow

**H2 — restore/sync race.** Resolved. `withRestoreLock` wraps all three restore paths (`DataRecoveryTool` snapshot restore, cloud restore, ZIP import via `local-backup-ledger.importReportBackup`). `useAutoSync.performSync` short-circuits while held and resumes via `onRestoreLockChange`. Memory: `mem://architecture/restore-lock`. Test: `import-backup-zip-restore.test.ts` ("restore lock is held during the IDB write phase").

**Photos imported as `uploaded: false` (C1 in restore path).** Resolved. ZIP import path in `local-backup-ledger.ts` now coerces through `toUploadedFlag` → `0|1`. Locked by `import-backup-zip-restore.test.ts` ("imported photos persist uploaded as a number"). Same coercion applies on the cloud-restore path because both funnel through `savePhotoOffline`.

**No post-restore integrity check.** Resolved. `src/lib/restore-integrity.ts::verifyRestoreIntegrity` re-reads the parent after every restore (DataRecoveryTool, cloud, ZIP) and re-applies if `organization`, `location`, `site`, `status`, or `updated_at` regressed. Test: `import-backup-zip-restore.test.ts` ("drift between snapshot and live IDB row triggers a re-apply").

### Reconciliation — still open

**`empty_local_guard` pulling server children back without confirmation.** Still open. `reconcileChildTable` GUARD A / GUARD B refuse to *delete* on suspicious-empty, but they don't address the inverse pull-back path. Need to confirm whether that pull-back still happens in `atomic-sync-manager` after the reconcile-blocked branch.

**H3 — `reconcileAllChildTables` runs outside the parent transaction.** Still open. Current `restoreReconciledDeletions` (C4) is a best-effort *post-hoc* compensator, not a transactional fix. Reconcile delete + parent upsert are still two separate round-trips.

**50% / delta-of-3 size guards.** Confirmed removed in `sync-reconciliation.ts` (explicit comment lines 84-86). Replaced by GUARD A/B + the final `assertSafeToDeleteChildRows` tripwire. This item is closed; the audit note is stale.

### Cross-device sync — still open

**Realtime persists server parents without child-level guard.** Still open per audit. Need to re-read the realtime handler to confirm.

**Temp-ID → existing-UUID adoption overwrites concurrent writes.** Still open per audit. Field-merge (`mem://features/silent-conflict-resolution-v7`) covers field-level convergence on subsequent syncs but does not address the adoption-moment overwrite.

### Security

**`storage-rls-probe` once-per-UTC-day.** Confirmed present. M3 caveat noted (single-bucket sample).

**`synthetic-session-guard.isUnsafeToTransmit` unused (C5/H4).** Per audit. `mem://constraints/sync-session-jwt-guard` documents `assertRealSessionForSync` is wired, but the `isUnsafeToTransmit` helper specifically still needs a caller. Need to confirm.

**Three edge functions with `verify_jwt = false` (super-admin bypass).** Out of scope today per the user. Will report grep result without remediating.

### Plan — what to actually do

1. **Confirm three open items** with read-only grep/inspection before touching anything:
   - `atomic-sync-manager.ts` post-`reconcile.blocked` branch — does it pull server children back into IDB?
   - Realtime parent-write handler — child-level guard present?
   - `synthetic-session-guard.isUnsafeToTransmit` — any callers?
   - `supabase/config.toml` — current `verify_jwt = false` count.

2. **Report findings** in a follow-up plan. For each genuinely-open item, propose either:
   - A targeted fix (e.g. add `isUnsafeToTransmit` call sites at the two known transmission boundaries), or
   - A "won't-fix, here's why" with a memory entry so it stops resurfacing in audits.

3. **Do not** attempt H3 (transactional reconcile + parent upsert) in this round — it's a multi-day refactor of `atomic-sync-manager` and needs its own scoping pass. Flag it as known debt; `restoreReconciledDeletions` (C4) remains the mitigation.

4. **Do not** touch the three `verify_jwt = false` edge functions — explicitly out of scope.

### Verdict

- **Restoration flow (H2, C1-restore, integrity check):** all three shipped, tests in place. Closed.
- **Reconciliation 50%/delta-of-3 guards:** closed — removed and replaced by tripwire.
- **Reconciliation `empty_local_guard` pull-back, H3 transactional reconcile:** open. H3 explicitly deferred.
- **Cross-device realtime + temp-ID adoption:** open, needs confirmation read before planning a fix.
- **`isUnsafeToTransmit` unused:** open, small fix once call sites confirmed.
- **Edge function `verify_jwt = false`:** out of scope, will report count only.

Approve and I'll switch to default mode, run the four confirmation reads, then come back with a tight per-item fix plan (or a no-op + memory entry where appropriate).

