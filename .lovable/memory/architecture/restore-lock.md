---
name: restore-lock
description: Restore flow holds a sync lock so auto-sync cannot interleave T0 snapshot overwrites onto freshly-restored records
type: feature
---

src/lib/restore-lock.ts exposes a ref-counted `withRestoreLock(fn)` and `isRestoreInProgress()`. All three `handleRestore` paths in src/components/admin/DataRecoveryTool.tsx (local-ledger, cloud, admin-edit-history) wrap their work in it. src/hooks/useAutoSync.tsx `performSync` short-circuits when the lock is held, and a lock-release listener kicks off a fresh sync 250ms after the lock clears so restored rows reach the server promptly. Local + cloud restores additionally run `verifyRestoreIntegrity` post-write: re-reads the parent and re-applies once if `organization`, `location`, `site`, `status`, or `updated_at` regressed.
