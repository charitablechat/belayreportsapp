

# Zero-Data-Loss Strategy: Comprehensive Hardening Plan

## Current Architecture Assessment

The application already has substantial data protection layers:
- Local-first IndexedDB persistence with circuit breaker
- Empty-array save guards on `saveRelatedDataOffline` and `saveAssessmentDataOffline`
- `shouldPreserveLocalRecord` guard on Dashboard caching
- `isLocalDataNewer` guard on form loading
- Transaction manager blocklist preventing deletes on 28 report tables
- Orphan cleanup with threshold guards, recency checks, and recovery logging
- `beforeunload` warning for unsaved changes
- Soft-delete pattern with 60-day retention

## Identified Data Loss Vectors (Remaining Gaps)

### Vector 1: Page Refresh Loses In-Memory State Before First Auto-Save

**Risk**: HIGH
**Scenario**: User opens a report, types data into systems/equipment/ziplines, then accidentally refreshes the page within the 1.5-second auto-save debounce window. The data exists only in React state and has never been persisted to IndexedDB.

**Current mitigation**: `beforeunload` shows a browser warning, but the user can dismiss it. No emergency flush occurs.

**Fix**: Add a `visibilitychange` and `pagehide` listener in InspectionForm, TrainingForm, and DailyAssessmentForm that performs an **emergency synchronous-like save** to IndexedDB when the page is being hidden (covers both tab switching and refresh on iOS). Additionally, flush pending debounce timers in `beforeunload`.

### Vector 2: Server Returns Empty Child Arrays That Bypass the Guard

**Risk**: MEDIUM
**Scenario**: When loading a report online, if the server returns an empty `systemsData` array (e.g., RLS misconfiguration, query timeout returning `null` that's coerced to `[]`), the form calls `setSystems([])` and then `saveRelatedDataOffline('systems', id, [])`. The empty-array guard in `saveRelatedDataOffline` blocks the IndexedDB write, but the React state is already set to `[]`, overwriting any data the user previously entered. The next auto-save then persists the empty state to IndexedDB.

**Fix**: In `loadInspection`, do NOT call `setSystems(serverData)` or `saveRelatedDataOffline` if the server returned empty data AND local IndexedDB already has non-empty data. Apply the same guard to all child data types across all three form types.

### Vector 3: Empty Report Cleanup Soft-Deletes Reports With Unloaded Child Data

**Risk**: MEDIUM
**Scenario**: `useEmptyReportCleanup` evaluates `isInspectionEmpty()` using the current React state. If child data (systems, equipment) hasn't finished loading from IndexedDB yet (timeout, circuit breaker), the arrays are empty in state, causing `isInspectionEmpty` to return `true`. The cleanup soft-deletes a report that actually has data.

**Fix**: Add a `dataFullyLoaded` flag that is only set to `true` after both IndexedDB and server data loading complete. Pass this to `useEmptyReportCleanup` as an additional guard. If data hasn't fully loaded, never clean up.

### Vector 4: Dashboard Orphan Cleanup Deletes During RLS Policy Changes

**Risk**: LOW (mitigated but not eliminated)
**Scenario**: If a user's RLS policy changes (e.g., admin removes access), the server returns fewer records. The 50% threshold guard catches large drops, but a gradual reduction (e.g., from 4 to 2 records) could still trigger orphan deletion.

**Fix**: Increase the minimum record count threshold from 3 to 5, and add a `localStorage` timestamp check -- never run orphan cleanup more than once per hour.

### Vector 5: Photo Blob Lost on IndexedDB Eviction

**Risk**: MEDIUM (browser-dependent)
**Scenario**: On mobile browsers with storage pressure, the browser can evict IndexedDB data even with persistent storage requested (if the request was denied). Photo blobs in IndexedDB are large and high-priority eviction targets.

**Fix**: After each successful photo save to IndexedDB, also save a lightweight metadata record to `localStorage` (photo ID, inspectionId, section, timestamp, uploadStatus). This acts as a "receipt" that a photo was captured. If the blob is evicted, the app can show a "Photo data lost -- please retake" warning instead of silently dropping it.

### Vector 6: Concurrent Save Operations Overwrite Each Other

**Risk**: LOW
**Scenario**: Auto-save fires at the same time as a manual save or immediate save. Both read the same React state and write to IndexedDB, but if the auto-save reads state slightly before a user edit and writes after, the edit is lost.

**Fix**: The existing `anySaveInProgressRef` mutex prevents concurrent saves in InspectionForm. Verify the same pattern exists in TrainingForm and DailyAssessmentForm.

## Implementation Plan

### Phase 1: Emergency Save on Page Hide (Vector 1)

**Files**: `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`

Add a `useEffect` that listens for `visibilitychange` (state === 'hidden') and `pagehide` events. On trigger:
1. Cancel any pending debounce timer
2. Synchronously call `performSaveRef.current(true)` without awaiting (fire-and-forget, since the page is being torn down)
3. Use `navigator.sendBeacon` as a fallback signal if the save didn't complete

Also flush the debounce in `beforeunload`:
```typescript
useEffect(() => {
  const handleEmergencySave = () => {
    if (hasUnsavedChanges && !saving) {
      // Cancel debounce and trigger immediate save
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
        saveDebounceTimerRef.current = null;
      }
      // Fire-and-forget -- page is being hidden
      performSaveRef.current?.(true);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      handleEmergencySave();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handleEmergencySave);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handleEmergencySave);
  };
}, [hasUnsavedChanges, saving]);
```

### Phase 2: Server Empty-Data Guard on Form Loading (Vector 2)

**Files**: `src/pages/InspectionForm.tsx` (lines ~1008-1060), `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`

Wrap each server-to-state assignment with a "non-regression" check:

```typescript
// Before setting systems from server:
if (systemsData && systemsData.length > 0) {
  setSystems(normalizedSystems);
  saveRelatedDataOffline('systems', id!, normalizedSystems).catch(...);
} else if (offlineSystems.length > 0) {
  // Server returned empty but local has data -- preserve local
  console.warn('[InspectionForm] Server returned empty systems but local has data -- preserving local');
  // Do NOT call setSystems or saveRelatedDataOffline
}
```

Apply to all 5 child types (systems, ziplines, equipment, standards, summary) and to all 3 form types.

### Phase 3: Data-Loaded Guard for Empty Report Cleanup (Vector 3)

**Files**: `src/pages/InspectionForm.tsx`, `src/pages/TrainingForm.tsx`, `src/pages/DailyAssessmentForm.tsx`

Add a `dataFullyLoaded` state flag:
```typescript
const [dataFullyLoaded, setDataFullyLoaded] = useState(false);
```

Set it to `true` at the end of `loadInspection` (in the `finally` block). Pass to `useEmptyReportCleanup`:
```typescript
const { cleanupEmptyReport } = useEmptyReportCleanup({
  ...existing props,
  hasUserInteracted: hasUserInteracted || !dataFullyLoaded,
});
```

This ensures cleanup never runs before all data sources have been consulted.

### Phase 4: Orphan Cleanup Rate Limiting (Vector 4)

**File**: `src/pages/Dashboard.tsx`

Add a rate limiter for orphan cleanup:
```typescript
const ORPHAN_CLEANUP_COOLDOWN = 3600000; // 1 hour
const lastCleanupKey = 'lastOrphanCleanup';
const lastCleanup = parseInt(localStorage.getItem(lastCleanupKey) || '0');
if (Date.now() - lastCleanup < ORPHAN_CLEANUP_COOLDOWN) {
  console.log('[Dashboard] Orphan cleanup on cooldown -- skipping');
  return; // Skip cleanup entirely
}
localStorage.setItem(lastCleanupKey, String(Date.now()));
```

### Phase 5: Photo Metadata Receipts (Vector 5)

**File**: `src/components/PhotoCapture.tsx`

After saving a photo to IndexedDB, also write a receipt to `localStorage`:
```typescript
// After savePhotoOffline succeeds:
try {
  const receipts = JSON.parse(localStorage.getItem('photoReceipts') || '[]');
  receipts.push({
    id: photoId,
    inspectionId,
    section,
    timestamp: Date.now(),
    uploaded: false,
  });
  // Keep last 100 receipts
  if (receipts.length > 100) receipts.splice(0, receipts.length - 100);
  localStorage.setItem('photoReceipts', JSON.stringify(receipts));
} catch {}
```

**File**: `src/components/PhotoGallery.tsx`

On gallery load, cross-reference receipts against IndexedDB. If a receipt exists but the blob is missing, show a warning badge.

### Phase 6: Verify Concurrent Save Protection (Vector 6)

Audit `TrainingForm.tsx` and `DailyAssessmentForm.tsx` to confirm they have the same `anySaveInProgressRef` mutex pattern as InspectionForm.

## Technical Summary

```text
+------------------------------+----------+---------------------------+
| Vector                       | Risk     | Fix                       |
+------------------------------+----------+---------------------------+
| Pre-debounce page refresh    | HIGH     | visibilitychange + pagehide emergency save |
| Server empty array overwrite | MEDIUM   | Non-regression guard on load              |
| Empty cleanup before load    | MEDIUM   | dataFullyLoaded flag                      |
| Gradual orphan deletion      | LOW      | 1-hour cooldown rate limit                |
| Photo blob eviction          | MEDIUM   | localStorage receipts                     |
| Concurrent save race         | LOW      | Verify mutex in all forms                 |
+------------------------------+----------+---------------------------+
```

## Security

- No API keys or secrets are involved in any of these changes
- All fixes operate on local storage (IndexedDB, localStorage) and React state
- No new network calls or database operations introduced
- Console logs use truncated IDs only

## Files Modified

1. `src/pages/InspectionForm.tsx` -- emergency save, server empty guard, dataFullyLoaded flag
2. `src/pages/TrainingForm.tsx` -- same three fixes
3. `src/pages/DailyAssessmentForm.tsx` -- same three fixes
4. `src/pages/Dashboard.tsx` -- orphan cleanup rate limiter
5. `src/components/PhotoCapture.tsx` -- photo receipt to localStorage
6. `src/components/PhotoGallery.tsx` -- receipt cross-reference warning

