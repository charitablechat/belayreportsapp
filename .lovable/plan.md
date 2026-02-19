

# Fix: Data Recovery Tool Crash

## Root Cause

The three `getQueued*Operations()` functions in `offline-storage.ts` call `getDB()` directly **without** the `withIndexedDBErrorBoundary` wrapper that protects every other IndexedDB function. When IndexedDB is unhealthy or hangs (clearly happening based on repeated "Operation timed out after 5000ms" warnings in the console), these three unprotected functions either:

1. **Hang forever** -- `getDB()` never resolves, so `Promise.all` in `loadLocalData` never completes, leaving the component stuck on "Loading..."
2. **Throw an unhandled error** -- which rejects `Promise.all`, hitting the catch block (the previous fix handles this case, but not case 1)

The protected functions (`getOfflineInspections`, `getOfflineTrainings`, `getOfflineDailyAssessments`) all use `withIndexedDBErrorBoundary` which has a 5-second timeout and returns an empty array as fallback. The queued operations functions lack this protection.

### Affected Functions

| Function | Protected? |
|---|---|
| `getOfflineTrainings()` | Yes (withIndexedDBErrorBoundary, fallback: `[]`) |
| `getOfflineDailyAssessments()` | Yes |
| `getOfflineInspections()` | Yes |
| `getQueuedOperations()` | **No -- raw getDB() call** |
| `getQueuedAssessmentOperations()` | **No -- raw getDB() call** |
| `getQueuedTrainingOperations()` | **No -- raw getDB() call** |

## Fix

### 1. Wrap the three unprotected functions (src/lib/offline-storage.ts)

Wrap `getQueuedOperations`, `getQueuedAssessmentOperations`, and `getQueuedTrainingOperations` in the existing `withIndexedDBErrorBoundary` wrapper with an empty array fallback. This gives them the same timeout, circuit breaker, and error handling that every other IndexedDB function already has.

```typescript
// Before (no protection):
export async function getQueuedOperations() {
  const db = await getDB();
  const operations = await db.getAll('operations');
  return operations;
}

// After (protected):
export async function getQueuedOperations() {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      return await db.getAll('operations');
    },
    [],
    'getQueuedOperations'
  );
}
```

Same pattern applied to `getQueuedAssessmentOperations` and `getQueuedTrainingOperations`.

### 2. Add a safety timeout to loadLocalData (src/components/admin/DataRecoveryTool.tsx)

As a defense-in-depth measure, wrap the `Promise.all` call with a timeout so the component can never hang indefinitely, even if a future unprotected function is added:

```typescript
const loadWithTimeout = Promise.race([
  Promise.all([...]),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Load timeout')), 10000))
]);
```

This ensures the catch block (which already sets empty defaults) is reached even if something hangs.

## Files Modified

| File | Change |
|---|---|
| `src/lib/offline-storage.ts` | Wrap 3 `getQueued*` functions in `withIndexedDBErrorBoundary` |
| `src/components/admin/DataRecoveryTool.tsx` | Add 10s safety timeout around `Promise.all` in `loadLocalData` |

## What This Does NOT Change

- No data safety protocols are modified
- The `withIndexedDBErrorBoundary` wrapper is already battle-tested across 30+ other functions
- Fallback values are empty arrays (same as existing pattern) -- no data is fabricated or lost
- The circuit breaker, timeout, and error logging behavior remain identical

