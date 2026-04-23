

## Guard sync cycle against unreliable unsynced counts

### What

In the auto-sync loop, wrap the unsynced-count read with `withIDBTimeout('refreshUnsyncedCounts', 'heavy', ...)` and abort the cycle if it times out, so sync never decides "nothing to do" based on a fallback-zero result.

### Files

**`src/hooks/useAutoSync.tsx`** (and/or `src/lib/atomic-sync-manager.ts` — whichever owns the pre-sync count read; will confirm during implementation)

1. Locate the call that fetches unsynced counts before deciding whether to run a sync pass (currently a direct `getUnsyncedCounts()` / equivalent aggregation across `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedAssessments`).

2. Replace with:
   ```ts
   const { data: freshCounts, timedOut } = await withIDBTimeout(
     'refreshUnsyncedCounts',
     'heavy',
     () => getUnsyncedCounts(),
     { inspections: 0, trainings: 0, assessments: 0 }
   );
   if (timedOut) {
     console.warn('[Sync] Could not get reliable unsynced counts — retrying next cycle');
     return { success: false, reason: 'unsynced_count_timeout' };
   }
   ```

3. If a single `getUnsyncedCounts()` aggregator does not yet exist, add a thin helper in `src/lib/offline-storage.ts` that returns `{ inspections, trainings, assessments }` by calling the three existing `getUnsynced*` helpers in parallel. Export it for the sync hook.

4. Ensure `withIDBTimeout` is imported into the sync hook from `@/lib/offline-storage`.

5. Caller of `performSync` (the interval tick + `forceSync`) already tolerates a falsy/early return — confirm and add a one-line log if the abort path is hit so the UI badge doesn't flip to "synced" prematurely.

### Out of scope

- Not changing the per-store `getUnsynced*` internals — they already route through `withIndexedDBErrorBoundary`'s tier-aware deadline. The `heavy` outer timeout here is the cycle-level guard.
- Not adding retry/backoff; the next interval tick is the retry.

### Risk

Low. On a healthy device the heavy tier (15s) is far above normal read time. On a stuck IDB the cycle now correctly skips rather than falsely marking the queue empty.

