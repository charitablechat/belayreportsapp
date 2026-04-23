# H12 — Surface partial sync failures

**Problem:** In `src/hooks/useAutoSync.tsx` (~line 448–528), the post-sync logic computes `anySuccess = results.some(r => r?.success > 0)` and shows a green "Data synced successfully (N items)" toast whenever *anything* succeeded. If 3 of 5 inspections sync and 2 fail, the user sees a success toast, assumes everything is up, closes the laptop — and the 2 failed records never sync.

The result objects already carry per-batch `failed` counts (visible at line 507 in the mobile debug log), but `failed` is currently ignored when shaping the toast.

## Fix

Tally `totalFailed` across all four results and branch the toast based on it:

- `totalFailed === 0 && totalSynced > 0` → existing green success toast (with optional `(N more queued)` suffix).
- `totalFailed > 0 && totalSynced > 0` → **warning** toast: `"Synced ${totalSynced}; ${totalFailed} failed — will retry"`. Use `toast.warning(...)` (sonner supports it; it routes through the existing mobile-aware notification-config classifier).
- `totalFailed > 0 && totalSynced === 0` → **error** toast: `"Sync failed: ${totalFailed} item${s} could not upload — will retry"`.
- All-zero → no toast (unchanged).

Mirror the same message into `addSyncNotification` so the in-app notification center reflects the partial failure for later review.

Also gate `emitSyncComplete()` and the backup-ledger "mark synced" loop on `totalFailed === 0` so downstream consumers (which currently treat a sync-complete event as "all clear") don't get a misleading all-clear when items actually failed. Failed items remain in IDB and will be retried by the next sync cycle as today.

## Files

- `src/hooks/useAutoSync.tsx` — update the `if (anySuccess)` block at ~lines 511–528 and the second `if (anySuccess)` at ~lines 532–549 to use the new `totalFailed` / `totalSynced` shape described above. Add `const totalFailed = results.reduce((sum, r) => sum + (r?.failed || 0), 0);` next to the existing `totalSynced`/`totalRemaining` reducers.

No schema changes, no new files, no API surface change. Existing per-type sync functions already populate `failed` on their result objects — no edits needed there.

## Verification

- `npx tsc --noEmit`.
- Manual: temporarily force one inspection sync to throw (e.g. malformed payload), trigger sync with 2 valid + 1 invalid record. Confirm the warning toast reads "Synced 2; 1 failed — will retry" and the failed record stays unsynced and retries on the next cycle.
