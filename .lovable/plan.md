
# Fix Sync Status Discrepancy on InspectionForm

## Problem Summary

The InspectionForm displays "Failed to sync online - saved locally" in the header **even after** background sync completes successfully. The toast shows "Sync completed successfully" (correct), but the error indicator persists (incorrect).

This creates confusion: users see conflicting signals about their data sync status.

## Root Cause

The `InspectionForm` component sets `saveError` when online sync fails during a save operation. However, when `useAutoSync` later successfully syncs the data via background sync:

1. It emits `emitSyncComplete()` event
2. It shows a success toast
3. **But `InspectionForm` doesn't listen for this event to clear the error**

The `saveError` state is only cleared:
- On next manual save attempt (user action)
- When the component remounts

## Solution

Add a listener in `InspectionForm` to subscribe to sync completion events and clear the `saveError` when sync succeeds. This is the same pattern used by `Dashboard.tsx`.

## Technical Implementation

### File: `src/pages/InspectionForm.tsx`

**Add import** (near line 4):
```typescript
import { onSyncComplete } from "@/lib/sync-events";
```

**Add useEffect hook** (after existing useEffects, around line 385):
```typescript
// Clear save error when background sync completes successfully
useEffect(() => {
  const unsubscribe = onSyncComplete(() => {
    // Clear any sync errors since background sync succeeded
    if (saveError && saveError.includes('sync')) {
      setSaveError(null);
      if (import.meta.env.DEV) {
        console.log('[InspectionForm] Cleared sync error after successful background sync');
      }
    }
  });
  
  return () => unsubscribe();
}, [saveError]);
```

### File: `vite.config.ts`

Update version to track this fix:
```typescript
// v2.2.50 - Fixed sync status discrepancy on InspectionForm (clear error after background sync)
const APP_VERSION = "2.2.50";
const BUILD_TIMESTAMP = "02-04-2026 at 10:15 AM CST";
```

## Why This Works

1. When `useAutoSync` completes a successful sync, it calls `emitSyncComplete()`
2. `InspectionForm` receives this event via `onSyncComplete`
3. If there's a sync-related error displayed, it gets cleared
4. The UI now correctly reflects the actual sync state

## Additional Verification

The service worker (`sw-push.js`) already has the `SKIP_WAITING` handler (lines 68-73):
```javascript
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING, activating new version');
    self.skipWaiting();
  }
});
```

This was correctly implemented in the previous plan. The current issue is purely a React state management problem.

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/InspectionForm.tsx` | Add import for `onSyncComplete`, add useEffect to clear `saveError` on sync success |
| `vite.config.ts` | Increment version to `v2.2.50` and update timestamp |

## Expected Outcome

After this fix:
1. User saves changes while online → sync fails → "Failed to sync online" appears ✓
2. Background sync runs and succeeds → "Data synced successfully" toast appears ✓
3. **NEW: Error indicator automatically clears** → UI shows "Saved" state ✓

No more conflicting signals between the toast and the header indicator.
