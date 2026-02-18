

# Fix: Version Numbers Not Incrementing on Each Save

## Root Cause

The `appendVersion` function in `src/lib/report-version-manager.ts` determines the next version number by reading all existing versions from IndexedDB (`index.getAll(reportId)`) and finding the max. However, `appendVersion` is called as **fire-and-forget** (`.then().catch()`) in all three form pages. The `performSave` mutex releases in the `finally` block **before** `appendVersion` finishes its IndexedDB write.

This creates a classic read-before-write race:

```text
Save #1 starts  -->  reads maxVersion = 5  -->  writes version 6
Save #2 starts  -->  reads maxVersion = 5  -->  writes version 6  (DUPLICATE)
                     ^^ Save #1 hasn't written yet
```

The result: multiple saves produce the same version number instead of incrementing.

## Fix

Add an **in-memory monotonic counter** inside `report-version-manager.ts`, keyed by `reportId`. The counter increments synchronously on each call, eliminating the async read race. IndexedDB is only read once (to seed the counter on first call for a given report).

## Technical Changes

### File: `src/lib/report-version-manager.ts`

Add a module-level `Map<string, number>` that tracks the latest version number per report in memory:

```typescript
// In-memory monotonic counter per report — eliminates async read race
const versionCounters = new Map<string, number>();
```

Modify `appendVersion` to:
1. Check if `versionCounters` has an entry for this `reportId`
2. If yes, increment it synchronously (no IndexedDB read needed)
3. If no, read from IndexedDB to seed the counter (first call only), then increment
4. Use the counter value as `versionNumber`

This is a single-file change. No modifications needed in the form pages since they already call `appendVersion` correctly -- the bug is entirely inside the version manager.

### No other files need changes

The forms (`InspectionForm.tsx`, `TrainingForm.tsx`, `DailyAssessmentForm.tsx`) continue to call `appendVersion` as fire-and-forget. The fix is entirely internal to the version manager -- the counter ensures each call gets a unique, monotonically increasing version number regardless of IndexedDB write timing.

