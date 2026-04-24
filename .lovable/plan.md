

## Fix C2 — Stop silent zeroing in `getUnsyncedCounts`

### Problem

`getUnsyncedCounts` (`src/lib/offline-storage.ts:3281-3320`) wraps its work in `withIndexedDBErrorBoundary` with `{ inspections: [], trainings: [], assessments: [] }` as the silent fallback. On any IDB hiccup it returns "everything is synced", which:

1. Zeroes the unsynced badge (user thinks they're up to date).
2. Trips the "nothing to sync" early-exit in `useAutoSync.tsx:270-282`, so real pending edits never upload.

This is the exact failure mode commit `36b13d5e` hardened the three individual `getUnsynced*` reads against — but the batched variant on the hot polling path was missed.

### Approach — Option B (delete the batched read)

Option A patches the symptom; Option B removes the duplicated code path entirely. The three single-table reads already use `withIndexedDBReadBoundary` and return `IdbReadFailure` correctly (Phase S11). Calling them in parallel is `3× getAll()` either way — no perf cost — and there's only one hardened code path to maintain.

### Plan

#### 1. Delete `getUnsyncedCounts` — `src/lib/offline-storage.ts:3281-3320`

Remove the batched function. Keep `getUnsyncedInspections`, `getUnsyncedTrainings`, `getUnsyncedAssessments` (already status-aware via `withIndexedDBReadBoundary`).

#### 2. Rewrite `useAutoSync` consumer — `src/hooks/useAutoSync.tsx:273-282`

Replace the single `getUnsyncedCounts(...)` call with three parallel reads via `Promise.all`, each wrapped in its own `withIDBTimeout`. Aggregate `readSucceeded` flags: if **any** read failed, treat the cycle as "status unknown" and **preserve last-known counts** rather than zeroing — same pattern already in use at lines 663-699 for the individual reads.

Pseudocode:

```ts
const [insp, train, assess] = await Promise.all([
  withIDBTimeout('refreshUnsyncedInspections', 'heavy',
    () => getUnsyncedInspectionsWithStatus(freshUser.id),
    { items: [], readSucceeded: false }),
  withIDBTimeout('refreshUnsyncedTrainings', 'heavy',
    () => getUnsyncedTrainingsWithStatus(freshUser.id),
    { items: [], readSucceeded: false }),
  withIDBTimeout('refreshUnsyncedAssessments', 'heavy',
    () => getUnsyncedAssessmentsWithStatus(freshUser.id),
    { items: [], readSucceeded: false }),
]);

const allRead = insp.data.readSucceeded && train.data.readSucceeded && assess.data.readSucceeded;
const anyTimedOut = insp.timedOut || train.timedOut || assess.timedOut;

if (!allRead || anyTimedOut) {
  // Preserve last-known counts; do NOT take the "nothing to sync" early-exit.
  console.warn('[useAutoSync] Unsynced count read failed/timed out — preserving last-known state, skipping cycle');
  return; // or: keep previous freshCounts, do not call setUnsyncedCount(0)
}

const freshCounts = {
  inspections: insp.data.items,
  trainings: train.data.items,
  assessments: assess.data.items,
};
// existing "nothing to sync" branch is now safe — only entered when all three reads succeeded
```

The exact integration (whether to `return` early vs. retain previous `freshCounts`) follows the existing pattern at lines 663-699 — the goal is "never let a failed read look like an empty queue."

#### 3. Audit other call sites of `getUnsyncedCounts`

Grep the codebase for `getUnsyncedCounts(` — if any other caller exists (e.g. badge refresh in `usePWA`, dashboard counts), migrate them to the same parallel pattern or to whichever individual read they need. Most likely `useAutoSync` is the only consumer, but worth confirming before deletion.

#### 4. Verify the status-aware variants exist

The plan assumes `getUnsynced{Inspections,Trainings,Assessments}WithStatus` already exist (per Phase S11 / Priority 2 contract `{ items, readSucceeded }`). If only the non-`WithStatus` versions exist, this fix needs them added first — a small wrapper around the existing `withIndexedDBReadBoundary` calls. Will confirm during implementation and add if missing.

### Why this closes the gap

- The "silent zero" code path is **deleted**, not patched — no future regression possible via this function.
- Every read now reports its status; the consumer cannot mistake "read failed" for "queue empty".
- Matches the established Priority 2 / S11 pattern already in use elsewhere in `useAutoSync`.

### Out of scope

- Refactoring the rest of `useAutoSync`'s flow control. Only the count-refresh block changes.
- Touching `getUnsyncedPhotos` or other unsynced-X readers — different shape, different consumers, not on the hot polling path.
- Adding new tests beyond what S11 already covers; the existing `Priority 3` test in `sync-hardening.test.ts` already enforces the "timed-out count read = abort" contract and will continue to pass.

### Files touched

1. **`src/lib/offline-storage.ts`** — delete `getUnsyncedCounts` (lines 3281-3320). Confirm `getUnsynced{Inspections,Trainings,Assessments}WithStatus` exist; add thin wrappers if not.
2. **`src/hooks/useAutoSync.tsx`** — replace the single `getUnsyncedCounts` call (~lines 270-282) with three parallel `withIDBTimeout` reads + aggregated `readSucceeded` / `timedOut` gating that preserves last-known counts on any failure.
3. **Any other caller surfaced by the grep audit** — migrate to parallel individual reads.

