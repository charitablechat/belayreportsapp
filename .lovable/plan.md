

# Fix: Force Sync Not Working and Persistent Sync Badge

## Root Cause Analysis

### Issue 1: autoIncrement Keys Not Accessible via `op.id` (Primary DataError Source)
The three operation stores (`operations`, `training_operations`, `assessment_operations`) are created with `{ autoIncrement: true }` and NO `keyPath`. This means `getAll()` returns the raw stored objects — the auto-incremented IDB key is NOT included as a property on the object. When `useAutoSync.tsx` does `op.id!`, it's always `undefined` for entries that don't have an `id` field in their data payload.

The `validIdFilter` added in the last fix checks `op.id != null`, but this filters against the data property, not the IDB key. Many queued operations DO have a data property called `id` (the report UUID), so they pass the filter — but that UUID is not the IDB auto-increment key, so `db.delete('operations', reportUUID)` silently does nothing or throws.

Meanwhile, operations WITHOUT an `id` in their data payload pass through as `undefined`, causing the `DataError: No key or key range specified` crash that trips the circuit breaker, disabling ALL IndexedDB for 60 seconds. This cascades into the "Using backup storage" banner and prevents force sync from completing.

### Issue 2: `removeQueuedOperation` Lacks Null Guard
Unlike `removeQueuedTrainingOperation` and `removeQueuedAssessmentOperation` (which were patched with null guards), `removeQueuedOperation` for inspections still accepts bare `number` with no guard against `undefined`.

### Issue 3: Circuit Breaker Cascade
Once the DataError trips the circuit breaker (3 failures), ALL subsequent IndexedDB operations fail for 60 seconds. This means:
- `updateUnsyncedCounts()` fails → badge stays stale
- Next sync cycle skips (circuit breaker check at line 130)
- Force sync also hits the same circuit breaker gate

## Fix Plan

### Step 1: Use `clearAll` Instead of Individual Deletes for Stale Queue Cleanup
**File:** `src/hooks/useAutoSync.tsx`

Replace the individual `removeQueuedOperation(op.id!)` calls with bulk `clearAllQueuedOperations()`, `clearAllQueuedTrainingOperations()`, `clearAllQueuedAssessmentOperations()`. These already exist and use `store.clear()` which doesn't need keys at all. This eliminates the entire key mismatch problem.

For soft-delete entries, process them FIRST via `processQueuedSoftDeletes()`, THEN clear the remaining non-soft-delete entries in bulk.

```typescript
// BEFORE: Individual deletes with broken keys
await Promise.all([
  ...inspOps.filter(nonSoftDeleteFilter).filter(validIdFilter).map(op => removeQueuedOperation(op.id!)),
  ...
]);

// AFTER: Process soft-deletes first, then bulk clear
await processQueuedSoftDeletes();
await Promise.all([
  clearAllQueuedOperations(),
  clearAllQueuedTrainingOperations(),
  clearAllQueuedAssessmentOperations(),
]);
```

### Step 2: Add Null Guard to `removeQueuedOperation`
**File:** `src/lib/offline-storage.ts`

Add the same null/undefined guard that `removeQueuedTrainingOperation` and `removeQueuedAssessmentOperation` already have:

```typescript
export async function removeQueuedOperation(id: number | undefined | null) {
  if (id === undefined || id === null) {
    console.warn('[Offline Storage] Cannot remove operation with undefined/null ID');
    return;
  }
  // ...existing logic
}
```

### Step 3: Force Sync Should Reset Circuit Breaker
**File:** `src/hooks/useAutoSync.tsx`

When the user explicitly clicks "Force Sync," bypass or reset the circuit breaker so the sync can actually execute:

```typescript
const performSync = useCallback(async (silent = true) => {
  // ...existing checks...
  
  const cbStatus = getCircuitBreakerStatus();
  if (cbStatus.open) {
    if (silent) return; // Skip on periodic/auto sync
    // Force sync: reset the circuit breaker so user action always works
    resetCircuitBreaker();
  }
  // ...rest of sync...
});
```

### Step 4: Expose `resetCircuitBreaker` from offline-storage
**File:** `src/lib/offline-storage.ts`

Add a function to reset the circuit breaker state so force sync can bypass it:

```typescript
export function resetCircuitBreaker() {
  indexedDBFailureCount = 0;
  indexedDBDisabledUntil = 0;
  indexedDBBackoffCount = 0;
  dbPromise = null; // Force fresh connection
}
```

## Files Changed
1. `src/hooks/useAutoSync.tsx` — bulk clear instead of individual key deletes; bypass circuit breaker on force sync
2. `src/lib/offline-storage.ts` — null guard on `removeQueuedOperation`; expose `resetCircuitBreaker`

## Expected Impact
- Force sync will always execute when user clicks it (no longer blocked by circuit breaker)
- Zero `DataError` crashes (bulk clear doesn't need keys)
- Circuit breaker stops cascading into unrelated operations
- Sync badge updates correctly after successful sync

