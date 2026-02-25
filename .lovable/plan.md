

## Fix: Daily Assessment Hanging Offline Due to Unprotected IndexedDB Calls

### Problem

When offline, creating or interacting with a Daily Assessment causes the app to hang on a white screen with a spinner. The same issue affects Inspections and Trainings.

### Root Cause

Three queue functions in `src/lib/offline-storage.ts` call IndexedDB **directly without any timeout or error protection**:

- `queueAssessmentOperation` (line 1286)
- `queueOperation` (line 736)
- `queueTrainingOperation` (line 1590)

Every other IndexedDB function in the file uses `withIndexedDBErrorBoundary`, which provides a 5-second timeout and circuit breaker. These three were missed.

The console logs confirm IndexedDB is struggling -- repeated "Operation timed out after 5000ms" warnings appear. When the user creates a new assessment offline, the flow in `NewDailyAssessment.tsx` calls `saveDailyAssessmentOffline` (protected, completes fine) and then `queueAssessmentOperation` (unprotected, hangs forever). The `navigate('/daily-assessment/...')` line is never reached, leaving the user stuck on a spinner.

### Fix

**1. Wrap all three queue functions with `withIndexedDBErrorBoundary`** in `src/lib/offline-storage.ts`

This gives them the same 5-second timeout, circuit breaker, and graceful fallback that all other functions have. If the queue operation fails, it returns silently -- the local save (which is already protected) preserves the data, and the background sync system will pick it up later.

**2. Add `withTimeout` protection to queue calls in form components** as defense-in-depth

Wrap the `queueAssessmentOperation` / `queueOperation` / `queueTrainingOperation` calls in the submit/save handlers of all three form pages with the existing `withTimeout` utility (5 seconds). This ensures the submit flow always completes within a bounded time, even if the error boundary somehow fails.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/offline-storage.ts` | Wrap `queueOperation`, `queueAssessmentOperation`, and `queueTrainingOperation` with `withIndexedDBErrorBoundary` |
| `src/pages/NewDailyAssessment.tsx` | Add try/catch with timeout around `queueAssessmentOperation` call in `handleSubmit` |
| `src/pages/DailyAssessmentForm.tsx` | Add timeout protection around `queueAssessmentOperation` calls in `handleUpdateAssessment` and submit handler |
| `src/pages/InspectionForm.tsx` | Add timeout protection around `queueOperation` calls in offline paths |
| `src/pages/TrainingForm.tsx` | Add timeout protection around `queueTrainingOperation` calls in offline paths |

### Technical Detail

**`src/lib/offline-storage.ts` -- `queueAssessmentOperation` (current):**

```typescript
export async function queueAssessmentOperation(type, assessmentId, data) {
  const db = await getDB();           // Can hang forever
  await db.add('assessment_operations', {...}); // Can hang forever
  const { registerInspectionSync } = await import('./background-sync');
  await registerInspectionSync();     // Can hang forever
}
```

**After fix:**

```typescript
export async function queueAssessmentOperation(type, assessmentId, data) {
  return withIndexedDBErrorBoundary(
    async () => {
      const db = await getDB();
      await db.add('assessment_operations', {
        type, assessmentId, data,
        timestamp: Date.now(), retries: 0,
      });
      if (import.meta.env.DEV) {
        console.log('[Offline Storage] Queued assessment operation:', { type, assessmentId });
      }
      try {
        const { registerInspectionSync } = await import('./background-sync');
        await registerInspectionSync();
      } catch (e) {
        console.warn('[Offline Storage] Background sync registration failed:', e);
      }
    },
    undefined,
    'queueAssessmentOperation'
  );
}
```

Same pattern for `queueOperation` and `queueTrainingOperation`.

**`src/pages/NewDailyAssessment.tsx` -- `handleSubmit` offline path (current):**

```typescript
await queueAssessmentOperation('create', assessmentId, newAssessment);
```

**After fix:**

```typescript
try {
  await Promise.race([
    queueAssessmentOperation('create', assessmentId, newAssessment),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Queue timeout')), 5000)
    ),
  ]);
} catch (e) {
  console.warn('[NewDailyAssessment] Queue operation failed/timed out:', e);
}
```

### Why This Fixes It

- The `withIndexedDBErrorBoundary` wrapper provides a 5-second timeout -- if IndexedDB hangs, the function resolves with `undefined` instead of blocking forever
- The circuit breaker prevents cascading failures after repeated timeouts
- The submit handler's `finally` block executes, resetting state and allowing navigation to proceed
- The data is still preserved by the earlier `saveDailyAssessmentOffline` call (which already has protection), so nothing is lost
- Background sync will pick up the data when IndexedDB recovers or the user reconnects

### What is NOT Changing

- No changes to the Dashboard or its data fetching logic
- No changes to the sync system or background sync architecture
- No changes to the `loadAssessment` function
- No database or backend changes

