

# Zero Data Loss Strategy: Complete Implementation Plan

## Audit Results: Remaining Threats

After exhaustive code review of every file that touches report data, here are ALL remaining paths where data can be lost:

### CRITICAL: Service Worker (`public/sw-sync.js`) -- DELETE-THEN-INSERT

This is the **most dangerous remaining threat**. The service worker runs independently of the main application and uses raw `fetch()` DELETE calls against the database REST API. It completely bypasses the transaction manager blocklist and all application-level safeguards.

- Lines 97-106: `deleteRelatedData()` sends HTTP DELETE requests to `inspection_systems`, `inspection_ziplines`, `inspection_equipment`, `inspection_standards`, `inspection_summary`
- Lines 149-156: Called inside `syncInspectionWithTransaction()` -- deletes ALL child rows then re-inserts
- If IndexedDB returns empty arrays (quota exceeded, browser GC, corruption), the DELETE runs but INSERT is skipped -- permanent data loss

### MODERATE: IndexedDB Local Save Functions -- Atomic Delete+Put

Three functions in `src/lib/offline-storage.ts` use a "delete existing then put new" pattern within IndexedDB:

- `saveRelatedDataOffline()` (line 909): Deletes all existing items, then puts new ones
- `saveAssessmentDataOffline()` (line 1165): Same pattern for daily assessments
- `saveTrainingDataOffline()` (line 1424): Same pattern for trainings

These are safe when called with populated data (the delete and put happen in the same IndexedDB transaction, so if the put fails the delete is also rolled back). However, if called with an **empty array** as the `data` parameter, all existing IndexedDB data for that report section is wiped with nothing replacing it.

### LOW: `clearRelatedDataOffline` / `clearAssessmentDataOffline` / `clearTrainingDataOffline`

These are standalone "clear all" functions. Currently only called during temp-ID migration (cleaning up old temp-ID entries after a permanent UUID is assigned). Safe in current usage, but they are exported and could be misused.

---

## Implementation Plan

### Fix 1: Rewrite Service Worker Sync to Upsert-Only

**File:** `public/sw-sync.js`

Replace the `deleteRelatedData()` + `insertRelatedData()` pattern with a single `upsertRelatedData()` function that uses the PostgREST `PATCH` or `POST` with `Prefer: resolution=merge-duplicates` header (PostgREST upsert).

Changes:
- Remove the `deleteRelatedData()` function entirely
- Create new `upsertRelatedData()` function using HTTP POST with upsert headers
- Update `syncInspectionWithTransaction()` to skip the delete step and only upsert
- Add empty-array guard: if local data is empty, skip that table entirely (never send a request that could wipe data)

### Fix 2: Add Empty-Array Guard to IndexedDB Save Functions

**File:** `src/lib/offline-storage.ts`

Add a guard at the top of `saveRelatedDataOffline()`, `saveAssessmentDataOffline()`, and `saveTrainingDataOffline()` that prevents overwriting existing data with nothing:

```
if (data.length === 0) {
  // SAFETY: Never overwrite existing IndexedDB data with an empty array
  // This prevents silent data loss from empty state being persisted
  console.warn('[Offline Storage] Blocked save of empty array -- preserving existing data');
  return;
}
```

This ensures that even if a form component accidentally passes an empty array during initialization, auto-save, or background sync, the existing local data survives.

### Fix 3: Restrict `clear*DataOffline` Functions

**File:** `src/lib/offline-storage.ts`

Add a parameter guard to `clearRelatedDataOffline()`, `clearAssessmentDataOffline()`, and `clearTrainingDataOffline()` that only allows clearing data for temp-IDs (the only legitimate use case):

```
if (!inspectionId.startsWith('temp-')) {
  console.error('[SAFETY] Blocked clear operation on non-temp ID:', inspectionId);
  return;
}
```

This prevents any code path from accidentally wiping IndexedDB data for real (permanent UUID) reports.

---

## Files Modified

| File | Change | Risk |
|------|--------|------|
| `public/sw-sync.js` | Replace delete-then-insert with upsert; add empty-array guards | CRITICAL |
| `src/lib/offline-storage.ts` | Add empty-array guards to 3 save functions; restrict 3 clear functions to temp-IDs only | MODERATE |

## Files NOT Modified (Already Safe)

| File | Why Safe |
|------|----------|
| `src/lib/atomic-sync-manager.ts` | Already converted to upsert-only + has empty-local-guard (previous fix) |
| `src/lib/transaction-manager.ts` | Already has REPORT_TABLE_BLOCKLIST blocking deletes (previous fix) |
| `src/pages/TrainingForm.tsx` | `completeTraining()` already converted to upsert (previous fix) |
| `src/pages/InspectionForm.tsx` | `completeInspection()` only updates status field |
| `src/pages/DailyAssessmentForm.tsx` | `handleSubmit()` uses upsert pattern |
| `src/pages/Dashboard.tsx` | Already has threshold guard on orphan cleanup (previous fix) |
| `src/components/PhotoGallery.tsx` | Photo delete is user-initiated only (explicit button click with confirmation) |
| `src/hooks/useEmptyReportCleanup.tsx` | Uses soft-delete (sets `deleted_at`), only for truly empty reports, skipped if user interacted |
| `src/hooks/useSoftDelete.tsx` | Admin-initiated soft-delete only |

## What This Guarantees

After implementation, the following failure modes are ALL protected:

1. **Page refresh**: Data persists in IndexedDB (already working) -- empty-array guard prevents accidental overwrites during re-initialization
2. **Network interruption / offline-to-online**: Sync uses upsert-only, never deletes. Empty local state is blocked from syncing
3. **Background sync (service worker)**: Converted from delete-then-insert to upsert. Empty arrays skip the sync
4. **Browser storage pressure / IndexedDB corruption**: Empty-array guard prevents "corrupted empty read" from propagating to server
5. **Component unmount / state reset**: Auto-save debounce with empty-array guard prevents empty state from overwriting IndexedDB
6. **Partial server responses**: Dashboard threshold guard already prevents orphan cleanup on incomplete data

**The ONLY way data can be removed after this implementation is by explicit user action** (clicking a delete/remove button in the UI).

## Testing Protocol

1. **Rapid refresh test**: Fill out all fields in a Training report, rapidly refresh the page 5 times, verify all data persists
2. **Offline-to-online test**: Fill out a report offline, toggle airplane mode on/off 3 times, verify no data lost
3. **Empty state sync test**: Open browser DevTools, manually clear an IndexedDB store, go online -- verify server data is NOT deleted
4. **Service worker sync test**: Create an inspection with all child data, force a service worker sync event, verify all child records survive
5. **Multi-tab test**: Open same report in two tabs, edit in one, close the other -- verify no data wiped
