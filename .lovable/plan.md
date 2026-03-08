

## Application-Wide Failure & Error Analysis

Beyond the dashboard filter issues already fixed, here are additional failures and concerns found across the application:

---

### Issue A: IndexedDB Timeout Storm (HIGH — Active in Console Logs)

**Location:** `src/lib/offline-storage.ts` line 257-264, triggered by `useAutoSync` every 30s + `useUnsyncedPhotos` + `useStorageHealthCheck`

**Problem:** Console shows 10 timeouts every 30 seconds. The `withTimeout` wrapper resolves with a fallback after 5s, but multiple callers invoke IndexedDB operations in parallel (unsynced counts for inspections, trainings, assessments × 2 hooks + photo counts). In the Lovable preview iframe, IndexedDB may be restricted/slow, causing all operations to hit the 5s timeout simultaneously. This creates ~10 warning logs per cycle, polluting the console and masking real errors.

**Fix:** Add a shared "IndexedDB available" gate that short-circuits all operations when the circuit breaker is open, and batch the 3 unsynced-count reads into a single IndexedDB transaction instead of 3 separate `withTimeout` calls.

---

### Issue B: iOS Focus Listener Memory Leak (MEDIUM)

**Location:** `src/hooks/useAutoSync.tsx` lines 486-488

**Problem:** An anonymous arrow function is added as a `focus` event listener but never removed in cleanup:
```typescript
window.addEventListener('focus', () => {
  if (navigator.onLine) performSync(true);
});
```
The cleanup block (line 526-546) removes `pageshow` but not `focus`. On iOS, every re-mount of the hook leaks one listener.

**Fix:** Extract the focus handler to a named variable and add `window.removeEventListener('focus', handleFocus)` in cleanup.

---

### Issue C: Training Soft-Delete Skips Offline Deletion (HIGH — Data Loss Risk)

**Location:** `src/pages/Dashboard.tsx` lines 948-968

**Problem:** When deleting a training while online, the code calls Supabase to soft-delete but never calls `deleteOfflineTraining(reportToDelete.id)`. Compare with inspection delete (line 883) which calls `deleteOfflineInspection`. This means the locally-cached training persists in IndexedDB and could reappear after the next sync cycle or offline session.

**Fix:** Add `await deleteOfflineTraining(reportToDelete.id)` before the Supabase call, mirroring the inspection and daily assessment patterns.

---

### Issue D: `handleDeleteConfirm` Uses Stale State Closures (MEDIUM)

**Location:** `src/pages/Dashboard.tsx` lines 912, 947, 971

**Problem:** The delete handler references `inspections`, `trainings`, and `dailyAssessments` state arrays directly (not via functional setState). If multiple deletes happen quickly or state updates are batched, the filter operates on stale data:
```typescript
setInspections(inspections.filter(i => i.id !== inspectionToDelete.id));
```

**Fix:** Use functional setState: `setInspections(prev => prev.filter(i => i.id !== id))`.

---

### Issue E: Dashboard Main Effect Has No Stable Dependencies (LOW-MEDIUM)

**Location:** `src/pages/Dashboard.tsx` line 367: `}, [location.key]);`

**Problem:** The massive effect (lines 196-367) defines `loadInspections`, `loadTrainingReports`, `loadDailyAssessments` as local functions. These are recreated every render but only re-run when `location.key` changes. This is functionally OK but means:
- The functions close over stale state when called from event listeners (`handleOnline`, `handleVisibilityChange`, `onSyncComplete`)
- Any future dependency additions would cause full re-initialization of all event listeners and Realtime subscriptions

This is a latent stability issue rather than an active bug.

---

### Issue F: Massive Code Duplication in Dashboard Data Loaders (LOW — Maintainability)

**Location:** `loadInspections` (384-543), `loadTrainingReports` (545-693), `loadDailyAssessments` (695-843)

**Problem:** These three ~150-line functions are ~95% identical. Each implements the same pattern: parallel IndexedDB+Supabase fetch, timeout handling, offline fallback, orphan cleanup with rate limiting and threshold guards. Any bug fix must be applied three times.

**Fix:** Extract a generic `loadReports(config)` function parameterized by table name, offline getter/saver/deleter, and child data cleanup config.

---

### Implementation Plan

**Phase 1 — Active Bugs (correctness)**
1. Add `deleteOfflineTraining` call to training soft-delete (Issue C) — 1 line fix
2. Fix iOS focus listener leak in `useAutoSync` (Issue B) — 3 line fix  
3. Fix stale closure in `handleDeleteConfirm` with functional setState (Issue D) — 3 line fix

**Phase 2 — Performance**
4. Gate IndexedDB operations behind circuit breaker check before each `withTimeout` call to reduce timeout spam (Issue A)
5. Batch the 3 unsynced-count reads into a single operation

**Phase 3 — Code Quality**
6. Extract generic `loadReports` helper to eliminate Dashboard data loader duplication (Issue F)

