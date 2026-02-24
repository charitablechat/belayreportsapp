

## Fix: Dashboard Not Showing Latest Reports After Save & Exit

### Problem

When you save a report and exit back to the dashboard, the dashboard doesn't display the just-saved report until you manually refresh. This happens because of a timing race in the event system.

### Root Cause

The Save & Exit flow does this:

1. Save data to local storage
2. Fire a "sync complete" event (to tell the dashboard to refresh)
3. Navigate back to the dashboard

The problem is that step 2 happens **before** the dashboard page has loaded. The dashboard only starts listening for sync events after it mounts, so it completely misses the event. By the time the dashboard loads and fetches data from the server, the locally saved data hasn't been uploaded yet, so the server returns stale results.

### Fix

Instead of relying on an event that fires before the dashboard exists, we'll use a simple persistent flag. When a report is saved-and-exited, a flag is written to `sessionStorage`. When the dashboard mounts, it checks for this flag, clears it, and forces a reload of local data after a short delay to ensure everything is settled.

### Changes

| File | What Changes |
|------|-------------|
| `src/lib/sync-events.ts` | Add two new helper functions: `markPendingDashboardRefresh()` and `consumePendingDashboardRefresh()` that use `sessionStorage` to persist a refresh flag across page navigations |
| `src/pages/InspectionForm.tsx` | In the Save & Exit handler, call `markPendingDashboardRefresh()` alongside `emitSyncComplete()` |
| `src/pages/TrainingForm.tsx` | Same change as InspectionForm |
| `src/pages/DailyAssessmentForm.tsx` | Same change as InspectionForm |
| `src/pages/Dashboard.tsx` | On mount, check `consumePendingDashboardRefresh()`. If true, schedule a second data reload after a short delay (500ms) to pick up the freshly saved local data |

### Technical Detail

**New functions in `sync-events.ts`:**

```typescript
const PENDING_REFRESH_KEY = 'pendingDashboardRefresh';

export function markPendingDashboardRefresh(): void {
  sessionStorage.setItem(PENDING_REFRESH_KEY, '1');
}

export function consumePendingDashboardRefresh(): boolean {
  const pending = sessionStorage.getItem(PENDING_REFRESH_KEY);
  if (pending) {
    sessionStorage.removeItem(PENDING_REFRESH_KEY);
    return true;
  }
  return false;
}
```

**In each form's Save & Exit handler** (alongside the existing `emitSyncComplete()`):

```typescript
emitSyncComplete();
markPendingDashboardRefresh(); // <-- new line
```

**In Dashboard's mount effect**, after the initial `loadAllData()`:

```typescript
// Check if we're returning from a save-and-exit
if (consumePendingDashboardRefresh()) {
  // Schedule a follow-up reload to catch locally saved data
  setTimeout(async () => {
    const user = await getUserWithCache();
    const userId = user?.id || getOfflineUserId();
    const superAdminStatus = user ? await getSuperAdminStatusWithCache() : false;
    await Promise.all([
      loadInspections(userId, superAdminStatus),
      loadTrainingReports(userId, superAdminStatus),
      loadDailyAssessments(userId, superAdminStatus),
    ]);
  }, 500);
}
```

### Why This Works

- `sessionStorage` persists across in-app navigations but clears when the browser tab is closed
- The flag survives the unmount/mount cycle between the report form and the dashboard
- The 500ms delay ensures the IndexedDB write from the save operation has fully committed before the dashboard reads from it
- The existing `emitSyncComplete()` call is kept for cases where the dashboard is already mounted (e.g., browser back button with cached component)

### What is NOT Changing

- No database or backend changes
- No changes to the sync system or background sync logic
- No changes to how data is saved in the report forms
- The existing `onSyncComplete` listener in Dashboard remains for handling background sync events

