

# Investigation Report & Fix Plan: Mobile-to-Web Sync Failure

## Executive Summary

The synchronization failure between mobile and web applications stems from **racing timeout conditions** in the IndexedDB access layer. When the database is slow to respond (common on mobile devices), the outer sync timeout (10s) races against the inner IndexedDB operation timeout (5s), causing spurious timeout warnings and inconsistent sync state even when data eventually syncs correctly.

## Technical Diagnosis

### Evidence from Console Logs
```
[Atomic Sync] IndexedDB timeout getting unsynced inspections
[Atomic Sync] IndexedDB timeout getting unsynced trainings  
[Atomic Sync] IndexedDB timeout getting unsynced assessments
```

These warnings appear **before** the sync completes successfully (notice "Sync completed successfully" appears later). This indicates the outer timeout is firing prematurely while the inner operation is still processing.

### Root Cause: Timeout Layer Conflict

```
┌─────────────────────────────────────────────────────────────────┐
│                    TIMEOUT RACE CONDITION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  atomic-sync-manager.ts                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Outer Timeout: 10 seconds                              │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  getUnsyncedInspections()                       │    │   │
│  │  │  ┌─────────────────────────────────────────┐    │    │   │
│  │  │  │  withIndexedDBErrorBoundary             │    │    │   │
│  │  │  │  Inner Timeout: 5 seconds               │    │    │   │
│  │  │  │  ┌─────────────────────────────────┐    │    │    │   │
│  │  │  │  │  Health Check: 3 seconds       │    │    │    │   │
│  │  │  │  └─────────────────────────────────┘    │    │    │   │
│  │  │  └─────────────────────────────────────────┘    │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  PROBLEM: If health check takes 3s + DB open takes 4s,         │
│  outer timeout fires at 10s while inner is still working       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why "Failed to sync online - saved locally" Appears

In `InspectionForm.tsx` (line 1204), when the sync retry mechanism exhausts its 3 attempts, it sets `saveError` to this message. The current retry logic detects network errors but doesn't account for IndexedDB timeout conditions, which are local storage issues, not network failures.

## Solution: Multi-Part Fix

### Part 1: Increase Outer Timeout to Prevent Race Condition

**File:** `src/lib/atomic-sync-manager.ts`

The outer `Promise.race` timeout should be extended to 15 seconds (from 10s) to allow the inner 5-second timeout plus potential health check (3s) plus actual operation time to complete without racing.

```typescript
// Line ~340-345
unsynced = await Promise.race([
  getUnsyncedInspections(user.id),
  new Promise<any[]>((resolve) => setTimeout(() => {
    console.warn('[Atomic Sync] IndexedDB timeout getting unsynced inspections');
    resolve([]);
  }, 15000)) // Changed from 10000 to 15000
]);
```

### Part 2: Add Force Sync Button to InspectionForm Header

**File:** `src/pages/InspectionForm.tsx`

Add a Force Sync button next to the "Retry Save" button in the header area for quick access when users encounter sync issues.

```typescript
// Import ForceSyncButton
import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";

// Add next to the Retry Save button (around line 1835)
{saveError && isOnline && (
  <>
    <Button
      variant="outline"
      size="sm"
      onClick={handleRetrySave}
      // ... existing retry button
    />
    <ForceSyncButton variant="icon" className="h-7 w-7" />
  </>
)}
```

### Part 3: Add Visible Force Sync Button to Dashboard Header

**File:** `src/pages/Dashboard.tsx`

Add an icon-only Force Sync button in the Dashboard header's status indicator area (near NetworkQualityIndicator) for quick access, in addition to the existing dropdown menu option.

```typescript
// In the header row with status indicators (around line 736)
<div className="flex items-center gap-2">
  <StatusIndicator className="md:hidden" />
  <NetworkQualityIndicator />
  
  {/* Add visible Force Sync button */}
  <ForceSyncButton variant="icon" className="h-8 w-8" />
  
  {isSuperAdmin && (
    // ... existing super admin badge
  )}
</div>
```

### Part 4: Ensure Toast Notifications Are Active for Sync States

**File:** `src/hooks/useAutoSync.tsx`

The current implementation uses `addSyncNotification()` which routes to the NotificationCenter on mobile. To ensure users see sync feedback, add explicit sonner toast for critical sync failures that bypass the mobile routing.

```typescript
// In the sync catch block (around line 181)
} catch (error) {
  console.error('[AutoSync] Sync failed:', error);
  clearTimeout(safetyTimeoutHandle);
  setState(prev => ({ ...prev, isSyncing: false }));
  
  // Show explicit error toast (not routed to notification center)
  // Import toast from 'sonner' at top of file
  import { toast } from 'sonner';
  
  toast.error("Sync failed", {
    description: "Changes saved locally. Will retry automatically.",
    duration: 5000,
  });
}
```

### Part 5: Improve InspectionForm Sync Error Detection

**File:** `src/pages/InspectionForm.tsx`

Differentiate between network errors and local storage errors in the `syncWithRetry` function to provide more accurate error messages.

```typescript
// In syncWithRetry catch block (around line 1177-1197)
} catch (error: any) {
  const isNetworkError = 
    error?.message?.toLowerCase().includes('network') ||
    // ... existing checks
    !navigator.onLine;
    
  // Add IndexedDB timeout detection
  const isLocalStorageError = 
    error?.message?.toLowerCase().includes('indexeddb') ||
    error?.message?.toLowerCase().includes('transaction');
  
  if (isLocalStorageError) {
    // Local storage issue - don't retry, it's not a network problem
    console.warn('[InspectionForm] Local storage error detected');
    throw new Error('Local storage error - please refresh the page');
  }
  
  if (retries > 0 && isNetworkError) {
    // ... existing retry logic
  }
  throw error;
}
```

### Part 6: Version Increment

**File:** `vite.config.ts`

Increment the version to reflect this sync fix.

```typescript
// Update APP_VERSION
const APP_VERSION = "2.1.90";
```

## Files to Modify

| Priority | File | Change |
|----------|------|--------|
| P1 | `src/lib/atomic-sync-manager.ts` | Increase outer timeout from 10s to 15s for all three report types |
| P2 | `src/pages/InspectionForm.tsx` | Add ForceSyncButton icon to header utility area |
| P3 | `src/pages/Dashboard.tsx` | Add visible ForceSyncButton icon in header |
| P4 | `src/hooks/useAutoSync.tsx` | Add explicit error toast for sync failures |
| P5 | `src/pages/InspectionForm.tsx` | Improve error detection for local vs network errors |
| P6 | `vite.config.ts` | Update version to v2.1.90 |

## Expected Outcome

After implementation:
1. IndexedDB timeout warnings should disappear as the outer timeout no longer races against inner operations
2. Users will have visible Force Sync button in both Dashboard and InspectionForm headers
3. Sync success/failure states will display toast notifications
4. Error messages will accurately distinguish between network and local storage issues
5. Version badge will show v2.1.90

## Testing Recommendations

After implementation:
1. Test on mobile device with slow network (throttle to 3G)
2. Verify no "IndexedDB timeout" console warnings appear during normal sync
3. Confirm Force Sync button is visible in Dashboard header
4. Confirm Force Sync button appears next to Retry Save in InspectionForm when error state active
5. Verify toast notifications appear for sync success/failure
6. Test offline → online transition to ensure data syncs correctly

