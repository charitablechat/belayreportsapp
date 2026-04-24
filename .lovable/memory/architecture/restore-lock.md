---
name: restore-lock
description: Restore flow holds a sync lock so auto-sync cannot interleave T0 snapshot overwrites onto freshly-restored records
type: feature
---

src/lib/restore-lock.ts exposes a ref-counted `withRestoreLock(fn)` and `isRestoreInProgress()`. All restore entry points wrap their work in it:
- The three `handleRestore` paths in src/components/admin/DataRecoveryTool.tsx (local-ledger, cloud, admin-edit-history).
- src/lib/local-backup-ledger.ts `importReportBackup` (ZIP/JSON import) — wraps localStorage write, IDB writes, photo import, cloud upload, and the `report-data-imported` dispatch.

src/hooks/useAutoSync.tsx `performSync` short-circuits when the lock is held, and a lock-release listener kicks off a fresh sync 250ms after the lock clears so restored rows reach the server promptly.

Post-write integrity: src/lib/restore-integrity.ts exports `verifyRestoreIntegrity` (extracted from DataRecoveryTool so all paths share it). It re-reads the parent and re-applies once if `organization`, `location`, `site`, `status`, or `updated_at` regressed. Called by all DataRecoveryTool restore handlers and by `importReportBackup`.

C1 contract: photo writes inside restore handlers funnel through `toUploadedFlag` so `photos.by-uploaded` keys the row on Safari (see mem://constraints/photos-uploaded-index).
