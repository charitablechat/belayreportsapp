

# Fix: Stuck Assessment Blocks Sync Button

## Problem

The sync button **does work** — it triggers the sync engine. But a specific daily assessment (`c24b6198`, "Airiel Crawler World") is **permanently stuck** in a skip loop, so the unsynced count never reaches 0 and subsequent presses are debounced.

The `suspicious_empty_guard` in `syncDailyAssessmentAtomic` (line 1905) checks three conditions:
1. All child data arrays are empty
2. The record was "edited" (`updatedAt - createdAt > 60s`)
3. The record is older than 5 minutes

When all three are true, it skips the sync. But the record is never removed or marked synced, so **every cycle** it tries again and skips again — forever.

In this case, the server also has no child data (the `empty_local_guard` at line 1857 doesn't fire because `serverHasChildData` is false). This is a legitimately empty assessment that should just sync normally.

## Root Cause

The `suspicious_empty_guard` has no escape hatch. If a record is genuinely empty (user opened a blank form, tapped save, never filled anything in), the guard blocks it permanently. There's also no limit on how many times a record can be skipped before giving up.

## Fix

**File: `src/lib/atomic-sync-manager.ts`** — Two changes in the `suspicious_empty_guard` block (~line 1894):

1. **Check server state before skipping**: If the server also has no child data (i.e., the first guard's `serverHasChildData` was false or the record doesn't exist on the server yet), then the local empty state is consistent — not suspicious. Allow the sync to proceed.

2. **Add a skip counter with a maximum**: After N skips (e.g., 3), stop blocking and let the sync proceed. The guard is meant to catch transient IndexedDB read failures, not permanently block records. Track skip count via a simple in-memory Map or by stamping the IndexedDB record.

### Implementation Detail

```text
// Pseudocode for the refined guard:

if (localIsCompletelyEmpty && wasEdited && ageMinutes > 5) {
  // NEW: Only block if the SERVER has child data
  // (meaning local empty is suspicious vs server non-empty)
  if (recordStatus?.record_exists && !recordStatus?.is_deleted) {
    // Server exists — check if server ALSO has no child data
    // If server is also empty, this is consistent, not suspicious
    const serverAlsoEmpty = !serverHasChildData; // reuse from earlier check
    if (serverAlsoEmpty) {
      // Both empty — allow sync (it's a genuinely blank form)
      // proceed normally
    } else {
      // Server has data, local doesn't — suspicious, skip
      return { success: false, skipped: true, reason: 'suspicious_empty' };
    }
  } else {
    // Record doesn't exist on server yet — it's a new blank form
    // Allow sync (user legitimately saved an empty form)
  }
}
```

The key insight: the `suspicious_empty_guard` should only fire when local is empty **but the server is not**. If both sides are empty, or the record is new, it's safe to sync.

### Restructuring

The current code runs two separate guard blocks:
- **Guard 1** (line 1833): `recordStatus.record_exists && localIsCompletelyEmpty && serverHasChildData` → recovery + skip
- **Guard 2** (line 1896): `localIsCompletelyEmpty && wasEdited && ageMinutes > 5` → skip (no server check)

Guard 2 needs to be merged with Guard 1's server-side knowledge. Since Guard 1 already fetches server child data and runs first, we can set a flag (`serverHasChildData`) that Guard 2 reuses. If the server also has no data, Guard 2 should not block.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/atomic-sync-manager.ts` | Refine `suspicious_empty_guard` to check server state; skip only when server has data but local doesn't |

## Impact

- The stuck "Airiel Crawler World" assessment will sync on the next attempt
- The unsynced count will drop to 0
- The "1 pending" badge and SyncPulse dot will clear
- No data loss risk — the guard still protects against the real corruption case (server has data, local doesn't)

