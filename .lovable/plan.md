

# Fix: Druidia Perpetual Re-Sync -- String Comparison Bug in getUnsyncedInspections

## Root Cause Found

The Druidia inspection is properly synced on the server (`synced_at` is 767 seconds ahead of `updated_at`). The problem is in the **local IndexedDB filter** that determines what needs syncing.

**File: `src/lib/offline-storage.ts`, line 606:**
```typescript
let unsynced = allInspections.filter(i => !i.synced_at || i.updated_at > i.synced_at);
```

This uses **JavaScript string comparison**, not date comparison. When timestamps have different formats or microsecond precision from the server (e.g., `"2026-02-18T04:37:21.091403+00:00"` vs `"2026-02-18T04:50:08.911+00:00"`), string comparison works coincidentally for most cases -- but breaks when:

- Timestamps come from different sources (RPC vs Supabase JS client vs `new Date().toISOString()`)
- Timezone offset format differs (`+00:00` vs `+00` vs `Z`)
- Microsecond precision varies (6 digits vs 3 digits vs none)

The `isLocalDataNewer` and `shouldPreserveLocalRecord` guards in `local-data-guards.ts` correctly use `new Date()` parsing. But `getUnsyncedInspections`, `getUnsyncedTrainings`, and `getUnsyncedDailyAssessments` all use raw string comparison.

Additionally, the `align_synced_at` RPC call was added to `atomic-sync-manager.ts` but the preview build may not include these changes yet. Network logs confirm zero `align_synced_at` calls were made during the session. Even once deployed, the string comparison bug in `getUnsyncedInspections` would remain a ticking time bomb.

## Fix

### 1. `src/lib/offline-storage.ts` -- Fix string comparison in three functions

**getUnsyncedInspections (line 606):**
```typescript
// Before (string comparison -- unreliable):
let unsynced = allInspections.filter(i => !i.synced_at || i.updated_at > i.synced_at);

// After (proper date comparison):
let unsynced = allInspections.filter(i => {
  if (!i.synced_at) return true;
  if (!i.updated_at) return false;
  return new Date(i.updated_at).getTime() > new Date(i.synced_at).getTime();
});
```

Apply the identical fix to:
- **getUnsyncedTrainings** (same pattern, different function)
- **getUnsyncedDailyAssessments** (same pattern, different function)

### 2. Verify `align_synced_at` RPC is being called

After the build deploys, verify via console logs that the RPC call at `atomic-sync-manager.ts:443` is executing. If it fails, the catch block at line 448 falls back to `new Date().toISOString()` which still aligns both timestamps -- but the server-side alignment wouldn't happen, potentially causing re-sync on the next Dashboard load.

## Impact

- **Scope:** Three filter functions in `offline-storage.ts`
- **Risk:** Very low. Changing string comparison to date comparison is strictly more correct. No behavior change for properly formatted ISO strings where string comparison happens to work.
- **Fixes:** The immediate Druidia re-sync loop, and prevents future timestamp format mismatches from causing phantom unsynced records across all report types.

