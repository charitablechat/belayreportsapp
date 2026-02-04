
# Data Synchronization Integrity Audit Report

## Executive Summary

A line-by-line code audit of the data synchronization layer between mobile (IndexedDB) and central (Supabase) databases has been completed. The current implementation at **v2.1.70** is architecturally sound with robust timeout protection, batch operations, and conflict resolution. However, **5 issues** were identified that could affect production stability.

## Current Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA SYNCHRONIZATION FLOW                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐     ┌───────────────┐     ┌──────────────────┐   │
│  │   Form UI    │────▶│  IndexedDB    │────▶│  Atomic Sync     │   │
│  │  (Debounced  │     │  (Offline     │     │  Manager         │   │
│  │   1.5s)      │     │   Storage)    │     │  (Batch + Retry) │   │
│  └──────────────┘     └───────────────┘     └────────┬─────────┘   │
│                                                       │             │
│                     ┌─────────────────────────────────▼──────────┐  │
│                     │            Supabase (Central DB)           │  │
│                     │  ┌────────────────────────────────────┐    │  │
│                     │  │  Transaction Manager (8s/step)    │    │  │
│                     │  │  - Batch inserts                  │    │  │
│                     │  │  - Rollback on failure            │    │  │
│                     │  └────────────────────────────────────┘    │  │
│                     └────────────────────────────────────────────┘  │
│                                                                     │
│  TIMEOUT LAYERS:                                                    │
│  • Per-step DB operation: 8 seconds                                 │
│  • Per-item sync: 25 seconds                                        │
│  • Overall sync: 30 seconds                                         │
│  • Safety reset: 32 seconds                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Audit Findings

### CRITICAL ISSUES (0)

No critical issues were found. The core synchronization logic is properly protected with timeout wrappers and error boundaries.

---

### MAJOR ISSUES (2)

#### Issue M1: Assessment Data Save Uses Sequential Deletes/Inserts Instead of Batch Transaction

**File:** `src/lib/offline-storage.ts` (lines 1079-1114)  
**Severity:** Major  
**Category:** Data Consistency / Performance

**Problem:**
Unlike `saveRelatedDataOffline` for inspections which uses a single read-write transaction with batch operations, `saveAssessmentDataOffline` and `saveTrainingDataOffline` use sequential `db.delete()` and `db.put()` calls:

```typescript
// saveAssessmentDataOffline - SEQUENTIAL PATTERN (lines 1093-1104)
for (const item of existingData) {
  await db.delete(storeName, item.id); // Sequential deletes
}
for (const item of data) {
  await db.put(storeName, dataWithAssessmentId); // Sequential inserts
}
```

Compare to the optimized inspection pattern:

```typescript
// saveRelatedDataOffline - BATCH PATTERN (lines 850-870)
const tx = db.transaction(storeName, 'readwrite');
const store = tx.store;
// Batch all operations within the same transaction
const deletePromises = existingData.map(item => store.delete(item.id));
const putPromises = data.map(item => store.put(dataWithInspectionId));
await Promise.all([...deletePromises, ...putPromises]);
await tx.done;
```

**Impact:**
- On mobile devices with slow storage, this adds latency during auto-save
- Partial failure risk: if the browser crashes mid-operation, data could be left in an inconsistent state
- Not atomic: deletes may complete but inserts fail

**Recommended Fix:**
Refactor `saveAssessmentDataOffline` and `saveTrainingDataOffline` to use the same single-transaction batch pattern as `saveRelatedDataOffline`.

---

#### Issue M2: Circuit Breaker Success Detection is Heuristic-Based

**File:** `src/lib/offline-storage.ts` (lines 353-359)  
**Severity:** Major  
**Category:** Error Handling Accuracy

**Problem:**
The circuit breaker's success detection uses a heuristic that cannot distinguish between a genuine empty result and a timeout:

```typescript
// If we got the fallback value due to timeout, record as failure
// Note: This is a heuristic - we can't perfectly detect timeout vs actual fallback value
if (result === fallbackValue && operationName.includes('get')) {
  // Only record failure for read operations that returned empty
  // Write operations returning fallback is expected on timeout
}
```

**Impact:**
- If IndexedDB genuinely has no data (new user, empty state), this incorrectly counts as a "failure"
- After 3 empty-state reads, circuit breaker trips unnecessarily, disabling IndexedDB for 60 seconds
- Users on new accounts may experience degraded offline functionality

**Recommended Fix:**
Use a structured result object with explicit timeout flag:
```typescript
interface IndexedDBResult<T> {
  data: T;
  timedOut: boolean;
}
```

---

### MINOR ISSUES (3)

#### Issue N1: Duplicate Error Boundary Wrapper on `deleteOfflineInspection`

**File:** `src/lib/offline-storage.ts` (lines 583-586)  
**Severity:** Minor  
**Category:** Code Consistency

**Problem:**
`deleteOfflineInspection` is the only function that doesn't use `withIndexedDBErrorBoundary`:

```typescript
export async function deleteOfflineInspection(id: string) {
  const db = await getDB();
  await db.delete('inspections', id);
}
```

All other similar functions are wrapped:
```typescript
export async function deleteOfflineDailyAssessment(id: string) {
  return withIndexedDBErrorBoundary(async () => { ... });
}
```

**Impact:**
- If IndexedDB fails during delete, the error propagates uncaught
- Inconsistent error handling across the codebase

**Recommended Fix:**
Wrap `deleteOfflineInspection` in `withIndexedDBErrorBoundary` for consistency.

---

#### Issue N2: useConflicts Hook Missing Dependency in useEffect

**File:** `src/hooks/useConflicts.tsx` (lines 169-173)  
**Severity:** Minor  
**Category:** React Best Practices

**Problem:**
The auto-resolve useEffect is missing `autoResolveConflicts` in its dependency array:

```typescript
useEffect(() => {
  if (validConflicts.length > 0 && !autoResolveConflicts.isPending) {
    autoResolveConflicts.mutate(validConflicts);
  }
}, [validConflicts.length]); // Missing: autoResolveConflicts
```

**Impact:**
- React ESLint warning (if enabled)
- Potential stale closure issues in edge cases

**Recommended Fix:**
Add `autoResolveConflicts` to the dependency array, or use `autoResolveConflicts.mutate` with stable reference via useCallback.

---

#### Issue N3: iOS Background Sync Fallback Has No Cleanup Mechanism

**File:** `src/lib/background-sync.ts` (lines 30-40)  
**Severity:** Minor  
**Category:** Memory / Storage Hygiene

**Problem:**
iOS uses localStorage to track pending syncs, but `clearPendingSyncs` is only called from a function that checks `isIOS()`:

```typescript
export function clearPendingSyncs(): void {
  if (!isIOS()) return; // Early return on non-iOS
  localStorage.removeItem('pending-inspection-sync');
  localStorage.removeItem('pending-photo-sync');
}
```

There's no code that calls `clearPendingSyncs()` after a successful sync on iOS.

**Impact:**
- `localStorage` entries persist indefinitely on iOS
- Not a functional bug, but unnecessary storage accumulation

**Recommended Fix:**
Call `clearPendingSyncs()` after successful sync completion in `useAutoSync` for iOS devices.

---

## Verified Strengths (No Issues Found)

### Timeout Architecture ✅

The multi-layer timeout system is properly implemented:

| Layer | Timeout | Location |
|-------|---------|----------|
| Per-step DB operation | 8 seconds | `transaction-manager.ts:4` |
| IndexedDB operation | 5 seconds | `offline-storage.ts:329` |
| Per-item sync | 25 seconds | `atomic-sync-manager.ts:309` |
| Overall sync | 30 seconds | `useAutoSync.tsx:19` |
| Safety reset | 32 seconds | `useAutoSync.tsx:124` |

### Circuit Breaker Pattern ✅

Properly prevents repeated IndexedDB failures from blocking the app:
- Threshold: 3 consecutive failures
- Cooldown: 60 seconds
- Automatic reset after cooldown

### Batch Insert Operations ✅

Recently optimized to use batch inserts instead of sequential operations:
```typescript
// atomic-sync-manager.ts - batch inserts for all related data
if (equipment.length > 0) {
  steps.push({
    table: 'inspection_equipment',
    operation: 'insert',
    data: equipment, // Batch insert all at once
  });
}
```

### Conflict Resolution ✅

Silent "Last Write Wins" strategy is properly implemented:
- Conflicts auto-resolve within 24 hours
- Orphaned conflicts are automatically cleaned up
- No user interaction required

### Auth Caching ✅

`getUserWithCache()` properly implements:
- In-memory cache with 60-second TTL
- localStorage fallback for offline scenarios
- Single-flight pattern to prevent duplicate requests
- Background refresh to keep cache fresh

### Rollback Mechanism ✅

Transaction manager properly captures rollback data and reverses operations on failure:
```typescript
// Captures existing data before delete for potential rollback
const existingSystems = await fetchRollbackData('inspection_systems', { inspection_id });
steps.push({
  operation: 'delete',
  rollbackData: existingSystems // Used to restore if transaction fails
});
```

---

## Summary Table

| ID | Severity | Description | Impact |
|----|----------|-------------|--------|
| M1 | Major | Assessment/Training save uses sequential instead of batch transaction | Performance + partial failure risk |
| M2 | Major | Circuit breaker heuristic cannot distinguish timeout from empty data | Unnecessary IndexedDB disabling |
| N1 | Minor | `deleteOfflineInspection` missing error boundary wrapper | Uncaught errors possible |
| N2 | Minor | `useConflicts` useEffect missing dependency | React warning + stale closure |
| N3 | Minor | iOS background sync localStorage entries never cleared | Storage accumulation |

---

## Recommendations

### Priority 1: Fix Issue M1 (Batch Transactions)
Refactor `saveAssessmentDataOffline` and `saveTrainingDataOffline` to use single-transaction batch operations matching the pattern in `saveRelatedDataOffline`.

### Priority 2: Fix Issue M2 (Circuit Breaker Accuracy)
Implement explicit timeout detection using a structured result object instead of comparing against fallback values.

### Priority 3: Address Minor Issues
- Wrap `deleteOfflineInspection` in error boundary
- Add missing dependency to `useConflicts` useEffect
- Call `clearPendingSyncs()` on iOS after successful sync

### Version Update
If fixes are implemented, increment version to **v2.1.80**:
```typescript
// v2.1.80 - Sync integrity fixes: batch transactions for assessments/trainings, circuit breaker accuracy
const APP_VERSION = "2.1.80";
```

---

## Technical Verification Checklist

After implementing fixes, verify:
- [ ] Assessment data saves use single IndexedDB transaction
- [ ] Training data saves use single IndexedDB transaction  
- [ ] Circuit breaker only trips on actual timeout/error, not empty data
- [ ] `deleteOfflineInspection` is wrapped in error boundary
- [ ] `useConflicts` hook has no React dependency warnings
- [ ] iOS localStorage entries are cleared after successful sync
- [ ] No regression in sync performance (test with 20+ equipment items)
- [ ] Offline → Online transition syncs all data correctly
- [ ] Version badge shows updated version in Dashboard dropdown
