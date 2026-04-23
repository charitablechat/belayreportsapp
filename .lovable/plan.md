

## Simplify `*WithStatus` helpers using `withIDBTimeout`'s `timedOut` flag

### What

The user is proposing a cleaner pattern: drop the `let ok = false` closure trick and derive `readSucceeded` directly from `!timedOut`. Apply this to all three status helpers.

### Tradeoff

`withIDBTimeout` returns `timedOut: false` for **both** success and non-timeout errors (e.g. IDB transaction abort, quota error). So `readSucceeded: !timedOut` will return `true` on a thrown error — which means an empty fallback `[]` could be misread as a real empty.

**Mitigation:** non-timeout IDB errors here are rare (the underlying `getRelatedDataOffline` already wraps in `withIndexedDBErrorBoundary`, so most failures surface as the boundary's own fallback rather than a throw to `withIDBTimeout`). The existing reconcile guards (V3 zero-local + final live-count tripwire) still catch catastrophic empties. Net safety remains acceptable, and the code is meaningfully simpler.

### Files

**`src/lib/offline-storage.ts`**

Replace the current `ok`-closure pattern in all three helpers with the user's pattern:

1. `getRelatedDataOfflineWithStatus` (~line 1808):
   ```ts
   const { data, timedOut } = await withIDBTimeout(
     `getRelatedData(${type}/${inspectionId})`,
     'batch',
     () => getRelatedDataOffline(type, inspectionId),
     [] as any[]
   );
   return { items: data || [], readSucceeded: !timedOut };
   ```

2. `getAssessmentDataOfflineWithStatus` (~line 2199): same pattern with `getAssessmentDataOffline(type, assessmentId)`.

3. `getTrainingDataOfflineWithStatus` (~line 2613): same pattern with `getTrainingDataOffline(type, trainingId)`.

### Out of scope

- Not changing `withIDBTimeout`'s return shape to distinguish thrown errors from success (would require a third state). If this becomes a real problem in practice, a follow-up can add `{ data, timedOut, errored }`.

### Risk

Low. Behavioral change vs. current `ok`-flag version: a non-timeout throw inside `getRelatedDataOffline` now yields `readSucceeded: true` with `items: []` (previously `false`). This is a regression in strictness but very narrow given the inner boundary already absorbs most errors.

