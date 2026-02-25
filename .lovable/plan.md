

## Fix: Daily Assessment Offline Access -- Circuit Breaker Never Trips

### Problem

When offline, navigating to a Daily Assessment shows a white screen with a loading spinner for an extended period before either redirecting to the dashboard or appearing to hang. The same affects Inspections and Trainings.

### Root Cause

The circuit breaker in `withIndexedDBErrorBoundary` (src/lib/offline-storage.ts) **never opens** because timeouts are incorrectly counted as successes.

Here's the chain of failure:

1. `withTimeout()` (line 257) resolves with a fallback value on timeout -- it does NOT throw an error
2. `withIndexedDBErrorBoundary()` (line 396) wraps operations with `withTimeout`. When a timeout occurs, the function returns the fallback value normally (no error)
3. After the `await`, `recordIndexedDBSuccess()` is called (line 417), which **resets the failure counter to 0**
4. Since failures are never counted, the circuit breaker threshold (3 failures) is never reached
5. Every subsequent IndexedDB operation attempts a fresh connection, taking the full 5 seconds to time out
6. With multiple sequential/parallel operations during form loading (getDB + get assessment + 6 child table fetches), total wait time reaches 10-15+ seconds

The `getDB()` function (line 448) also has a 5-second timeout that races with the error boundary's 5-second timeout. When they fire simultaneously, the error boundary's `withTimeout` often wins (resolving with fallback), so the `getDB()` rejection never reaches the catch block where `recordIndexedDBFailure()` is called.

### Fix

Two changes to `src/lib/offline-storage.ts`:

**1. Make `withIndexedDBErrorBoundary` distinguish timeouts from successes**

Use a sentinel value to detect when `withTimeout` returned the fallback due to timeout vs. a genuine successful result. When a timeout is detected, call `recordIndexedDBFailure()` instead of `recordIndexedDBSuccess()`.

**2. Reduce `getDB()` internal timeout to 3 seconds**

This ensures `getDB()` always fails BEFORE the 5-second error boundary timeout, so the rejection propagates to the catch block where `recordIndexedDBFailure()` is properly called. This is a defense-in-depth measure.

### Technical Detail

**Current code (withIndexedDBErrorBoundary, lines 392-419):**

```typescript
const OPERATION_TIMEOUT = 5000;

try {
  const result = await withTimeout(
    (async () => {
      // ... health check + operation()
    })(),
    OPERATION_TIMEOUT,
    fallbackValue   // <-- timeout resolves with fallback, indistinguishable from success
  );

  recordIndexedDBSuccess();  // <-- called even on timeout!
  return result;
} catch (error) {
  recordIndexedDBFailure();
  return fallbackValue;
}
```

**Fixed code:**

```typescript
const OPERATION_TIMEOUT = 5000;
const TIMEOUT_SENTINEL = Symbol('timeout');

try {
  const result = await withTimeout(
    (async () => {
      // ... health check + operation()
    })(),
    OPERATION_TIMEOUT,
    TIMEOUT_SENTINEL as any   // Use sentinel to detect timeout
  );

  if (result === TIMEOUT_SENTINEL) {
    // Timeout occurred -- count as failure for circuit breaker
    recordIndexedDBFailure();
    return fallbackValue;
  }

  recordIndexedDBSuccess();
  return result;
} catch (error) {
  recordIndexedDBFailure();
  return fallbackValue;
}
```

**getDB() timeout change (line 594):**

```typescript
// Before:
setTimeout(() => reject(new Error('IndexedDB open timed out')), 5000)

// After:
setTimeout(() => reject(new Error('IndexedDB open timed out')), 3000)
```

### Why This Fixes It

- After 3 consecutive IndexedDB timeouts, the circuit breaker opens
- While open, ALL IndexedDB operations return their fallback value **instantly** (0ms, not 5000ms)
- The form's `loadAssessment()` completes in milliseconds instead of 10-15 seconds
- The user sees the "Assessment not available offline" toast and is redirected to the dashboard within 1 second
- The circuit breaker automatically resets after 60 seconds, allowing IndexedDB to be retried when conditions improve

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Use a sentinel value in `withIndexedDBErrorBoundary` to detect timeouts and count them as failures; reduce `getDB()` timeout from 5s to 3s |

### What is NOT Changing

- No changes to form components (DailyAssessmentForm, InspectionForm, TrainingForm)
- No changes to the queue functions (already wrapped with error boundary from previous fix)
- No changes to the sync system or dashboard
- No database or backend changes

