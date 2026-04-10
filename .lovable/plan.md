

# Fix: Force Sync Not Working and Persistent Sync Badge

## Remaining Gaps Found

After reviewing the current implementation, all the previously approved fixes (circuit breaker reset, bulk clear, null guards, logo caching, signed URLs, save-flush) are correctly in place. However, **three critical gaps** remain that explain why force sync still appears broken:

### Gap 1: Debounce Guard Blocks Force Sync (Primary Cause)
At line 191-207 of `useAutoSync.tsx`, if a background sync ran within the last 5 seconds (`MIN_SYNC_INTERVAL`), force sync hits the debounce guard. When `silent = false`, it schedules a deferred retry but **returns immediately**. The `ForceSyncButton`'s `await forceSync()` resolves instantly without actually syncing. The success toast fires but no sync occurred.

**Fix:** Exempt force sync (non-silent) from the debounce guard entirely. The existing `syncInProgressRef` check (line 169) already prevents true duplicate calls.

### Gap 2: Early Exit Doesn't Refresh Unsynced Counts
When `unsyncedCountRef.current === 0` and queued ops exist, the stale queue cleanup runs, then the code falls through to the full pipeline. However, if `unsyncedCountRef.current === 0` AND `hasQueuedOps === false`, the early exit at line 275-282 returns without calling `updateUnsyncedCounts()`. If the badge is stale (e.g., from a circuit breaker-induced stale read), force sync won't correct it.

**Fix:** Call `updateUnsyncedCounts()` in the early exit path so badge always refreshes.

### Gap 3: Force Sync Success Toast Fires Prematurely
`ForceSyncButton` calls `await forceSync()` and shows a success toast afterward. But `performSync` can return early (debounce guard, auth failure, offline check, preview check) without throwing — the ForceSyncButton interprets this as success.

**Fix:** Have `performSync` return a result object (`{ synced: boolean, reason?: string }`) so ForceSyncButton can provide accurate feedback. Alternatively, simpler: always call `updateUnsyncedCounts()` in the `finally` block of `performSync` so the badge is always up-to-date regardless of what happened.

## Implementation Plan

### File 1: `src/hooks/useAutoSync.tsx`

1. **Bypass debounce for force sync**: Move the debounce check (lines 191-207) to only apply when `silent === true`. Force sync should always proceed (the `syncInProgressRef` guard at line 169 already prevents true conflicts).

2. **Always refresh counts after sync**: Add `updateUnsyncedCounts()` to the `finally` block (line 452-458) so badge state is always fresh, regardless of early exit, timeout, or error.

3. **Early exit count refresh**: Add `updateUnsyncedCounts()` before the early exit `return` at line 281.

### File 2: `src/components/pwa/ForceSyncButton.tsx`

4. **Accurate feedback**: After `await forceSync()`, re-check `unsyncedCount` from context to give accurate feedback (e.g., "Sync complete — X items still pending" vs "All data is up to date").

## Technical Details

```text
BEFORE (force sync flow):
  User clicks → performSync(false) → debounce guard → return (no sync)
  → ForceSyncButton shows "success" → badge stays stale

AFTER (force sync flow):
  User clicks → performSync(false) → skips debounce → runs pipeline
  → finally: updateUnsyncedCounts() → badge refreshes → accurate toast
```

## Files Changed
1. `src/hooks/useAutoSync.tsx` — debounce bypass, count refresh in finally/early-exit
2. `src/components/pwa/ForceSyncButton.tsx` — accurate post-sync feedback

## Expected Impact
- Force sync always executes immediately when clicked
- Badge always reflects current IDB state after any sync attempt
- No false "success" toasts when sync was skipped

