
# Plan: Fix Mobile Report Loading When IndexedDB Times Out

## Problem Summary
On mobile devices, recent reports fail to load because IndexedDB operations are timing out repeatedly, and the current loading logic waits for IndexedDB before attempting Supabase fetches. When IndexedDB hangs, it blocks the entire data loading flow.

---

## Root Cause

The Dashboard's `loadInspections` function has a **sequential dependency** bug:

```text
Current Flow (Broken):
1. getOfflineInspections() ─── [TIMES OUT after 5-15 seconds] ─── returns []
2. if (length > 0) ─── false, so setInspections() NOT called
3. if (navigator.onLine) ─── fetch from Supabase
4. setInspections(data) ─── finally sets data
```

The problem is that when IndexedDB times out (common on mobile Safari after backgrounding), the 5-15 second delay makes the app feel completely broken. The user sees nothing while waiting.

Additionally, the `dbPromise` global in `offline-storage.ts` gets stuck in a "rejecting" cycle where each call creates a new promise that also times out.

---

## Solution

### Strategy: Parallel Loading with "First Win" Pattern

Instead of loading sequentially (IndexedDB → Supabase), load **both in parallel** and display whichever returns first:

```text
Fixed Flow:
1. Start getOfflineInspections() ─── [may timeout]
2. Start fetchFromSupabase() ─── [parallel]
3. Whichever returns first → setInspections()
4. Second result → merge/update if newer
```

---

## Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/pages/Dashboard.tsx` | **P0** | Restructure loading to run IndexedDB and Supabase in parallel |
| `src/lib/offline-storage.ts` | **P1** | Add IndexedDB circuit breaker to stop repeated failing attempts |

---

## Technical Changes

### Dashboard.tsx - Parallel Loading Pattern

Refactor `loadInspections`, `loadTrainingReports`, and `loadDailyAssessments` to:

1. Start both IndexedDB and Supabase fetches simultaneously
2. Set state from whichever completes first
3. If IndexedDB fails silently, proceed with network data only
4. Use a short timeout (2 seconds) for IndexedDB before preferring network

**Updated loadInspections function:**
```typescript
const loadInspections = async (cachedUserId?: string) => {
  try {
    const userId = cachedUserId || (await getUserWithCache())?.id;
    
    // Start both fetches in parallel
    const offlinePromise = getOfflineInspections(userId).catch(() => []);
    
    let supabasePromise: Promise<any[]> = Promise.resolve([]);
    if (navigator.onLine) {
      supabasePromise = supabase
        .from("inspections")
        .select(`*, inspector:profiles(...)`)
        .order("last_opened_at", { ascending: false })
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        });
    }

    // Race with preference: use offline if fast, otherwise wait for network
    const offlineWithTimeout = Promise.race([
      offlinePromise,
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 2000))
    ]);
    
    const offlineData = await offlineWithTimeout;
    if (offlineData.length > 0) {
      setInspections(offlineData); // Show cached data immediately
    }
    
    // Always try to get fresh data from network
    if (navigator.onLine) {
      const networkData = await supabasePromise;
      if (networkData.length > 0) {
        setInspections(networkData);
        // Background save to IndexedDB (fire-and-forget)
        Promise.all(networkData.map(i => saveInspectionOffline(i))).catch(() => {});
      }
    }
  } catch (error) {
    console.error("Error loading inspections:", error);
  }
};
```

### offline-storage.ts - Circuit Breaker for IndexedDB

Add a circuit breaker pattern to stop hammering a failing IndexedDB:

```typescript
// Track consecutive failures
let indexedDBFailureCount = 0;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_TIME = 60000; // 1 minute
let circuitBreakerTrippedAt: number | null = null;

function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerTrippedAt) {
    if (Date.now() - circuitBreakerTrippedAt > CIRCUIT_BREAKER_RESET_TIME) {
      // Reset circuit breaker after cooldown
      circuitBreakerTrippedAt = null;
      indexedDBFailureCount = 0;
      return false;
    }
    return true; // Circuit is still open
  }
  return false;
}

function recordIndexedDBFailure(): void {
  indexedDBFailureCount++;
  if (indexedDBFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerTrippedAt = Date.now();
    console.warn('[Offline Storage] Circuit breaker tripped - IndexedDB disabled for 60s');
  }
}

function recordIndexedDBSuccess(): void {
  indexedDBFailureCount = 0;
  circuitBreakerTrippedAt = null;
}
```

Then modify `withIndexedDBErrorBoundary` to check the circuit breaker:

```typescript
async function withIndexedDBErrorBoundary<T>(...): Promise<T> {
  // If circuit breaker is open, return fallback immediately
  if (isCircuitBreakerOpen()) {
    if (import.meta.env.DEV) {
      console.log('[Offline Storage] Circuit breaker open, returning fallback for', operationName);
    }
    return fallbackValue;
  }

  try {
    const result = await withTimeout(...);
    recordIndexedDBSuccess();
    return result;
  } catch (error) {
    recordIndexedDBFailure();
    return fallbackValue;
  }
}
```

---

## Benefits

| Before | After |
|--------|-------|
| User waits 5-15s for IndexedDB timeout | User sees network data in ~1-2s |
| Repeated IndexedDB failures block app | Circuit breaker prevents repeated failures |
| IndexedDB must succeed for data to load | Network data shown even if IndexedDB fails |
| Mobile users see empty dashboard | Mobile users see data from Supabase |

---

## Testing Checklist

After implementation:
- [ ] Open Dashboard on mobile Safari - reports should load within 3 seconds
- [ ] Test with DevTools throttling IndexedDB - should fallback to network
- [ ] Verify offline mode still works (loads from IndexedDB when available)
- [ ] Test circuit breaker: after 3 failures, IndexedDB is bypassed for 60 seconds
- [ ] Verify background IndexedDB saves don't block UI
- [ ] Test pull-to-refresh still works

---

## Summary

The fix implements a **parallel-first, network-preferred** loading strategy that ensures mobile users see their reports quickly, even when IndexedDB is misbehaving. The circuit breaker prevents the app from repeatedly timing out on a broken IndexedDB connection, providing a smoother experience on devices with storage issues.
