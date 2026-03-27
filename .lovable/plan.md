

## Diagnosis: Persistent IndexedDB Timeouts and "Storage Unavailable" Warning

### What the warning means
The app has a **circuit breaker** in `offline-storage.ts` that trips after 3 consecutive IndexedDB operation failures (timeouts). When tripped, all IndexedDB writes are silently dropped for 60 seconds and you see the "Local storage unavailable / Your changes are at risk" banner plus a destructive toast.

### Root cause
The console logs show `Operation timed out after 8000ms` **every 60 seconds** in a continuous loop. Here's the cycle:

```text
1. Periodic sync fires (every 30s desktop / 60s mobile)
2. performSync() calls syncAllInspectionsAtomic/syncPhotos/etc.
3. These call getDB() → operations like db.getAll() or index queries
4. The operations hang (never resolve) → 5-8s timeout fires
5. withIndexedDBErrorBoundary records failure → circuit breaker trips after 3
6. Circuit breaker resets after 60s → next sync cycle hits same stale connection
7. Loop repeats indefinitely
```

**The critical bug**: When `getDB()` succeeds but the returned connection becomes **stale** (e.g., after a Service Worker upgrade, bfcache restore, or Safari evicting the connection), `dbPromise` remains cached with the dead connection. Every subsequent operation hangs because it reuses this zombie connection. The timeout fires, `dbConnectionVerified` is reset, the health check passes (opens a *separate* test DB), but the cached `dbPromise` still points to the dead connection.

### Fix (2 files)

#### 1. `src/lib/offline-storage.ts` — Reset stale `dbPromise` on timeout

In `withIndexedDBErrorBoundary` (around line 449), when a timeout is detected, **reset `dbPromise = null`** so the next operation opens a fresh connection instead of reusing the dead one. Also close the stale connection to release locks.

```typescript
// Line ~449-453: After timeout sentinel check
if (result === TIMEOUT_SENTINEL) {
  console.warn(`[Offline Storage] Timeout for ${operationName}, resetting DB connection`);
  dbConnectionVerified = false;
  recordIndexedDBFailure();
  // ✅ NEW: Close and discard the stale connection
  if (dbPromise) {
    dbPromise.then(db => db.close()).catch(() => {});
    dbPromise = null;
  }
  return fallbackValue;
}
```

#### 2. `src/hooks/useAutoSync.tsx` — Skip sync cycle when circuit breaker is active

The periodic sync currently fires regardless of circuit breaker state, hammering a broken IndexedDB with new timeout attempts every cycle. Add a guard at the top of `performSync` to skip when the circuit breaker is open:

```typescript
// After the navigator.onLine check (~line 117):
import { getCircuitBreakerStatus } from '@/lib/offline-storage';

// Inside performSync, after the online check:
const cbStatus = getCircuitBreakerStatus();
if (cbStatus.open) {
  if (import.meta.env.DEV) {
    console.log('[AutoSync] Circuit breaker open - skipping sync cycle');
  }
  return;
}
```

### Why this fixes it

| Problem | Fix |
|---------|-----|
| Stale cached `dbPromise` causes every operation to hang | Reset `dbPromise = null` and `db.close()` on timeout, forcing fresh connection |
| Periodic sync hammers broken IndexedDB every 30-60s | Skip sync when circuit breaker is open — let the 60s cooldown work |
| Circuit breaker resets but immediately hits same dead connection | Connection is now discarded on timeout, so post-reset operations get a new one |

### Files modified
- `src/lib/offline-storage.ts` (reset `dbPromise` on timeout, ~5 lines)
- `src/hooks/useAutoSync.tsx` (skip sync when circuit breaker open, ~8 lines)

