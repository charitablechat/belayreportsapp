

## Add `withIDBTimeout` helper + adopt in per-read status helpers

### What

Add a new tier-aware timeout wrapper to `src/lib/offline-storage.ts` that returns `{ data, timedOut }` so callers can distinguish real empties from timeout fallbacks. Adopt it in the three `*WithStatus` helpers so `readSucceeded` reflects actual read outcome, not a heuristic.

### Files

**`src/lib/offline-storage.ts`**

1. **Insert `withIDBTimeout` helper** immediately after the `IDB_TIMEOUTS` / `TimeoutTier` block (added previously). Exact code as provided by the user.

2. **Refactor `getRelatedDataOfflineWithStatus`** to use `withIDBTimeout('getRelatedData', 'batch', ...)`. Set `readSucceeded = !timedOut && fn didn't throw` (the wrapper already collapses both into `timedOut: false` on success vs. `timedOut: true/false` on failure — explicitly use `!timedOut && data !== fallback-sentinel`). Simplest: `readSucceeded = !timedOut` AND the inner fn resolved (wrapper catches both, but only `timedOut` distinguishes timeout from other errors — for our purposes any failure means `readSucceeded = false`, so derive it from a local `ok` flag set inside the fn closure, or just treat `timedOut OR threw` as failure by checking `data === fallback`).

   Cleanest pattern:
   ```ts
   let ok = false;
   const { data, timedOut } = await withIDBTimeout(
     'getRelatedDataOfflineWithStatus',
     'batch',
     async () => { const d = await getRelatedDataOffline(...); ok = true; return d; },
     {} as any
   );
   return { data, readSucceeded: ok };
   ```

3. **Apply same pattern** to `getTrainingDataOfflineWithStatus` and `getAssessmentDataOfflineWithStatus`.

4. **Remove** the now-redundant local `Promise.race` + `READ_TIMEOUT_MS` block inside each of the three helpers.

### Out of scope

- Not refactoring every IDB call to use `withIDBTimeout` — only the per-read status helpers in this PR. Broader adoption can follow once the helper is proven.
- Not changing `withIndexedDBErrorBoundary` (already tier-aware from the previous turn).

### Risk

Low. Net behavior: `readSucceeded` becomes strictly accurate (true only when the specific read resolved without throwing or timing out), which is exactly what `reconcileChildTable`'s `expectedNonEmpty` guard needs.

