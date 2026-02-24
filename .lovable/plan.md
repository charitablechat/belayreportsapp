

## Fix: Dashboard Race Condition After Save & Exit

### Problem

The current implementation has a race condition. When the Dashboard mounts, two independent data loads fire concurrently:

1. **`loadAllData()`** (line 241) -- starts immediately but takes 1-3 seconds because it first validates the auth session via `ensureValidSession()` (which has a 5-second timeout race)
2. **500ms delayed reload** (line 244-254) -- fires 500ms after mount, skips session validation, fetches fresh data quickly

The 500ms reload completes first and sets the correct state. Then `loadAllData()` finishes later and **overwrites the state** with its own result. If `loadAllData()`'s session validation caused any delay or partial failure, its subsequent server queries may return stale or empty results, clobbering the good data from the 500ms reload.

### Root Cause

The `consumePendingDashboardRefresh()` check and its 500ms reload run **concurrently** with `loadAllData()`, not **sequentially after** it. This creates an uncontrolled race where either load can overwrite the other's results.

### Fix

Sequence the pending refresh reload to run **after** `loadAllData()` completes, not alongside it. This guarantees:

- The initial load finishes first (session validated, data fetched)
- Only then, if a pending refresh flag exists, a follow-up reload runs 300ms later to catch any data that wasn't yet visible during the initial load
- No overwriting of fresh data by a slower concurrent load

### Changes

| File | What Changes |
|------|-------------|
| `src/pages/Dashboard.tsx` | Move the `consumePendingDashboardRefresh()` check inside a `.then()` chained after `loadAllData()`, so the follow-up reload only runs after the initial load completes |

### Technical Detail

**Current code (lines 241-255):**

```typescript
loadAllData();  // fire-and-forget async

// Runs concurrently -- can be overwritten by loadAllData()
if (consumePendingDashboardRefresh()) {
  setTimeout(async () => {
    // reload...
  }, 500);
}
```

**Fixed code:**

```typescript
// Consume the flag synchronously (before any async work clears it)
const hasPendingRefresh = consumePendingDashboardRefresh();

loadAllData().then(() => {
  // Only after initial load completes, schedule follow-up if needed
  if (hasPendingRefresh) {
    setTimeout(async () => {
      const user = await getUserWithCache();
      const userId = user?.id || getOfflineUserId();
      const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
      await Promise.all([
        loadInspections(userId, superAdminStatus),
        loadTrainingReports(userId, superAdminStatus),
        loadDailyAssessments(userId, superAdminStatus),
      ]);
    }, 300);
  }
});
```

Key changes:
- The flag is consumed synchronously (before `loadAllData` starts) so it's not lost
- The follow-up reload is chained with `.then()` so it only fires **after** the initial load finishes
- The delay is reduced from 500ms to 300ms since it now runs after the initial load (total wait = initial load time + 300ms, which is more than enough)
- No more concurrent overwrites

### What is NOT Changing

- No changes to the form components (InspectionForm, TrainingForm, DailyAssessmentForm) -- they already correctly call `markPendingDashboardRefresh()`
- No changes to `sync-events.ts`
- No changes to the `onSyncComplete` listener (handles background sync events separately)
- No changes to data fetching logic in `loadInspections`, `loadTrainingReports`, or `loadDailyAssessments`

